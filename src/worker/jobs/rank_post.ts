/**
 * `rank_post` — buys one SERP per tracked keyword from the standard queue.
 *
 * This is the only job in the system that spends money, which shapes it:
 *
 *  - It posts in batches of at most 100 (DataForSEO's documented ceiling) and
 *    refuses to silently drop the overflow — a keyword that vanishes from a
 *    batch is a hole in a chart nobody will notice for weeks.
 *  - It caps its own spend per run and spills the remainder into a successor
 *    job, so one enormous project cannot turn one sweep into one enormous bill
 *    or one enormous Worker invocation.
 *  - It hands the resulting task ids to exactly one `rank_collect`. If it
 *    posted tasks and then failed to record them, we would have paid for SERPs
 *    with no handle to collect them by — so recording happens before anything
 *    that can throw.
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import { projects, trackedKeywords } from "../../db";
import { createDataForSeoApi } from "../dataforseo";
import { SERP_TASK_POST_MAX_TASKS } from "../dataforseo/serp";
import { ApiException } from "../http";
import { toIsoDate } from "../../shared/tracking";
import type { RankCollectPayload, RankCollectTask } from "./rank_collect";
import { chunk, enqueueJob } from "./queue";
import type { JobContext, JobDetail } from "./types";

/**
 * Keywords one `rank_post` run will post before handing the rest to a
 * successor: five upstream calls, ~$3 at depth 100. Bounded so a single job
 * stays well inside the Workers CPU and subrequest budget, per the standing
 * rule in cron.ts that long work becomes many small jobs.
 */
export const RANK_POST_MAX_KEYWORDS_PER_JOB = 500;

/**
 * How long after posting the collector first looks.
 *
 * DataForSEO quote "around 5 minutes on average" for the standard queue with a
 * 45-minute target, so polling sooner mostly buys "Task In Queue." answers.
 * A minute is the compromise: short enough that a fast SERP is not left
 * sitting, long enough not to burn a subrequest for nothing every time.
 */
export const FIRST_COLLECT_DELAY_MS = 60_000;

export interface RankPostPayload {
  projectId: string;
  /** Omitted means "every keyword in the project" — the nightly check. */
  trackedKeywordIds?: string[];
}

export async function rankPost(ctx: JobContext): Promise<JobDetail> {
  const { env, db, job, now } = ctx;
  const payload = readPayload(job.payloadJson);

  const [project] = await db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      domain: projects.domain,
      locationCode: projects.locationCode,
      languageCode: projects.languageCode,
    })
    .from(projects)
    .where(eq(projects.id, payload.projectId))
    .limit(1);

  // The project was deleted between enqueue and run. Nothing to do, and
  // nothing wrong — succeed so the job stops rather than retrying five times.
  if (project === undefined) {
    return { skipped: "project_deleted", projectId: payload.projectId };
  }

  const wanted =
    payload.trackedKeywordIds === undefined
      ? undefined
      : payload.trackedKeywordIds;

  const keywords = await db
    .select({
      id: trackedKeywords.id,
      keyword: trackedKeywords.keyword,
      locationCode: trackedKeywords.locationCode,
      languageCode: trackedKeywords.languageCode,
      device: trackedKeywords.device,
    })
    .from(trackedKeywords)
    .where(
      wanted === undefined
        ? eq(trackedKeywords.projectId, project.id)
        : and(
            eq(trackedKeywords.projectId, project.id),
            inArray(trackedKeywords.id, wanted),
          ),
    )
    // Stable order so the spill boundary is deterministic across retries.
    .orderBy(asc(trackedKeywords.createdAt), asc(trackedKeywords.id));

  if (keywords.length === 0) {
    return { skipped: "no_keywords", projectId: project.id };
  }

  const posting = keywords.slice(0, RANK_POST_MAX_KEYWORDS_PER_JOB);
  const spill = keywords.slice(RANK_POST_MAX_KEYWORDS_PER_JOB);

  const dfs = await createDataForSeoApi(env, db, project.workspaceId);

  /*
   * The day this check belongs to, fixed at post time and carried through to
   * the collector. Using the collect time instead would file a check posted at
   * 23:58 under the following day, splitting one check across two rows and
   * making "yesterday's position" wrong for everyone in that window.
   */
  const date = toIsoDate(now);

  const collected: RankCollectTask[] = [];
  const rejected: { keyword: string; statusCode: number; message: string }[] =
    [];
  let costUsd = 0;

  for (const batch of chunk(posting, SERP_TASK_POST_MAX_TASKS)) {
    const result = await dfs.serp.googleOrganicTaskPost(
      batch.map((row) => ({
        keyword: row.keyword,
        locationCode: row.locationCode,
        languageCode: row.languageCode,
        device: row.device,
        // The tag is our correlation handle; the task id is theirs. Carrying
        // both means a mis-ordered or partially-rejected response can still be
        // mapped back to the right keyword.
        tag: row.id,
      })),
    );
    costUsd += result.costUsd;

    for (const task of result.accepted) {
      // Prefer the echoed tag, fall back to the submitted position: an
      // accepted task whose tag echo was lost is still a SERP we paid for, and
      // `tasks[]` comes back in the order it was sent.
      const row =
        (task.tag === null
          ? undefined
          : batch.find((candidate) => candidate.id === task.tag)) ??
        batch[task.index];
      if (row === undefined) continue;
      collected.push({
        taskId: task.id,
        trackedKeywordId: row.id,
        tag: row.id,
        keyword: row.keyword,
      });
    }

    for (const refusal of result.rejected) {
      const row = batch[refusal.index];
      rejected.push({
        keyword: row?.keyword ?? `#${refusal.index}`,
        statusCode: refusal.statusCode,
        message: refusal.statusMessage,
      });
    }
  }

  let collectJobId: string | null = null;
  if (collected.length > 0) {
    const collectPayload: RankCollectPayload = {
      projectId: project.id,
      date,
      postedAt: now.getTime(),
      tasks: collected,
      collected: [],
      polls: 0,
    };
    collectJobId = await enqueueJob(db, {
      type: "rank_collect",
      workspaceId: project.workspaceId,
      payload: { ...collectPayload },
      // The standard queue averages ~5 minutes; there is nothing to collect
      // before then, and a wasted poll is a wasted subrequest.
      runAt: new Date(now.getTime() + FIRST_COLLECT_DELAY_MS),
    });
  }

  let spillJobId: string | null = null;
  if (spill.length > 0) {
    spillJobId = await enqueueJob(db, {
      type: "rank_post",
      workspaceId: project.workspaceId,
      payload: {
        projectId: project.id,
        trackedKeywordIds: spill.map((row) => row.id),
      },
      runAt: now,
    });
  }

  return {
    projectId: project.id,
    posted: collected.length,
    rejected: rejected.length,
    rejections: rejected.slice(0, 5),
    costUsd,
    date,
    collectJobId,
    spillJobId,
    spilled: spill.length,
  };
}

function readPayload(raw: Record<string, unknown>): RankPostPayload {
  const projectId = raw["projectId"];
  if (typeof projectId !== "string" || projectId === "") {
    throw new ApiException(
      "internal_error",
      "rank_post job has no projectId in its payload.",
    );
  }

  const ids = raw["trackedKeywordIds"];
  if (ids === undefined || ids === null) return { projectId };
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new ApiException(
      "internal_error",
      "rank_post job has a malformed trackedKeywordIds payload.",
    );
  }
  return { projectId, trackedKeywordIds: ids as string[] };
}
