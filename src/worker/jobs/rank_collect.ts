/**
 * `rank_collect` — waits for the SERPs `rank_post` bought, then writes them
 * down as `rank_snapshots`.
 *
 * Collection is free, so the cost of this job is patience and subrequests, not
 * money. Its shape follows from that:
 *
 *  - It polls `tasks_ready` (one free call) to learn which of the account's
 *    tasks have finished, then fetches only those. Listing a task does not
 *    consume it — only `task_get` does — so two collectors running side by
 *    side cannot steal each other's results.
 *  - It caps the fetches per run and re-enqueues itself for the rest, because
 *    a hundred `task_get` calls in one invocation would blow the free plan's
 *    subrequest allowance.
 *  - It gives up after 24 hours **without writing anything** for the tasks it
 *    never got. A missing snapshot is honest; a null one would claim we looked
 *    and the site was not in the top 100.
 */
import { eq, sql } from "drizzle-orm";

import { projects, rankSnapshots } from "../../db";
import { createDataForSeoApi } from "../dataforseo";
import { ApiException } from "../http";
import { enqueueJob } from "./queue";
import { bestPositionFor } from "./snapshot";
import type { JobContext, JobDetail } from "./types";

/** One posted task, and the row it was posted for. */
export interface RankCollectTask {
  /** DataForSEO's opaque task id. */
  taskId: string;
  trackedKeywordId: string;
  /** What we put in `tag` — equal to `trackedKeywordId`, kept explicit so a
   * change of tagging scheme does not silently break correlation. */
  tag: string;
  keyword: string;
}

export interface RankCollectPayload {
  projectId: string;
  /** `YYYY-MM-DD` the snapshots belong to. Fixed by `rank_post`. */
  date: string;
  /** Epoch ms the tasks were posted — the clock the 24h ceiling runs on. */
  postedAt: number;
  tasks: RankCollectTask[];
  /** Task ids already resolved (written, or known never to arrive). */
  collected: string[];
  /** Polls so far. Drives the backoff. */
  polls: number;
}

/**
 * How long to keep trying before accepting the SERPs are not coming.
 *
 * DataForSEO's target turnaround for the standard queue is 45 minutes and
 * unretrieved tasks stay listed for three days, so 24 hours is generous
 * without being unbounded — and it is one rank-tracking day, after which the
 * next nightly check supersedes this one anyway.
 */
export const COLLECT_WINDOW_MS = 24 * 60 * 60_000;

/**
 * `task_get` calls per run.
 *
 * The binding constraint is the Workers free plan's 50-subrequest budget per
 * invocation, shared with every other job the same sweep claims. Twenty leaves
 * room for the `tasks_ready` call and for neighbours; a bigger batch simply
 * becomes the next run's, one minute later.
 */
export const MAX_TASK_GETS_PER_RUN = 20;

/**
 * Polls after which the collector stops trusting `tasks_ready` alone and asks
 * `task_get` about outstanding tasks directly.
 *
 * `tasks_ready` is a convenience, not the source of truth: a task that
 * completed while the list was being read, or one that aged off the three-day
 * window, is invisible there but still retrievable for 30 days. Since
 * `task_get` is free and answers "Task In Queue." for work still running,
 * asking directly costs nothing but a subrequest and closes that gap.
 */
export const DIRECT_GET_AFTER_POLLS = 2;

/** Backoff between polls: 30s doubling to a 10-minute ceiling. */
export function collectDelayMs(polls: number): number {
  const safe = Math.max(0, Math.floor(polls));
  return Math.min(30_000 * 2 ** safe, 10 * 60_000);
}

export async function rankCollect(ctx: JobContext): Promise<JobDetail> {
  const { env, db, job, now } = ctx;
  const payload = readPayload(job.payloadJson);

  const [project] = await db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      domain: projects.domain,
    })
    .from(projects)
    .where(eq(projects.id, payload.projectId))
    .limit(1);

  if (project === undefined) {
    return { skipped: "project_deleted", projectId: payload.projectId };
  }

  const done = new Set(payload.collected);
  const outstanding = payload.tasks.filter((task) => !done.has(task.taskId));

  if (outstanding.length === 0) {
    return { projectId: project.id, collected: done.size, outstanding: 0 };
  }

  const age = now.getTime() - payload.postedAt;
  if (age > COLLECT_WINDOW_MS) {
    /*
     * Out of time. Nothing is written for the tasks that never arrived: a null
     * position means "checked, not in the top 100", and claiming that about a
     * SERP we never saw would put a fabricated data point in a chart people
     * make decisions from.
     */
    return {
      projectId: project.id,
      gaveUp: true,
      ageHours: Math.round(age / 3_600_000),
      collected: done.size,
      abandoned: outstanding.length,
    };
  }

  const dfs = await createDataForSeoApi(env, db, project.workspaceId);

  // One free call tells us which of the account's tasks are finished.
  const ready = await dfs.serp.googleOrganicTasksReady();
  const readyIds = new Set(ready.tasks.map((task) => task.id));

  const direct = payload.polls >= DIRECT_GET_AFTER_POLLS;
  const fetching = outstanding
    .filter((task) => direct || readyIds.has(task.taskId))
    .slice(0, MAX_TASK_GETS_PER_RUN);

  const rows: {
    trackedKeywordId: string;
    date: string;
    position: number | null;
    url: string | null;
    serpFeaturesJson: string[];
  }[] = [];
  const resolved: string[] = [];
  let pending = 0;
  let gone = 0;

  for (const task of fetching) {
    let outcome;
    try {
      outcome = await dfs.serp.googleOrganicTaskGet(task.taskId);
    } catch (err) {
      /*
       * A transient upstream failure on one task must not lose the other 99.
       * Leaving it outstanding costs one free retry next poll, and the 24h
       * window is what stops that going on forever.
       */
      if (err instanceof ApiException) {
        pending += 1;
        continue;
      }
      throw err;
    }

    if (outcome.state === "pending") {
      pending += 1;
      continue;
    }
    if (outcome.state === "gone") {
      // "Task Not Found" / "Results Expired" — no amount of waiting helps.
      gone += 1;
      resolved.push(task.taskId);
      continue;
    }

    const best = bestPositionFor(outcome.serp.items, project.domain);
    rows.push({
      trackedKeywordId: task.trackedKeywordId,
      date: payload.date,
      position: best.position,
      url: best.url,
      serpFeaturesJson: outcome.serp.serpFeatures,
    });
    resolved.push(task.taskId);
  }

  if (rows.length > 0) {
    await writeSnapshots(db, rows);
  }

  const stillOutstanding = outstanding.length - resolved.length;
  let nextJobId: string | null = null;

  if (stillOutstanding > 0) {
    const next: RankCollectPayload = {
      ...payload,
      collected: [...payload.collected, ...resolved],
      polls: payload.polls + 1,
    };
    nextJobId = await enqueueJob(db, {
      type: "rank_collect",
      workspaceId: project.workspaceId,
      payload: { ...next },
      runAt: new Date(now.getTime() + collectDelayMs(payload.polls)),
    });
  }

  return {
    projectId: project.id,
    date: payload.date,
    polls: payload.polls,
    readyListed: ready.tasks.length,
    fetched: fetching.length,
    written: rows.length,
    pending,
    gone,
    outstanding: stillOutstanding,
    nextJobId,
  };
}

/**
 * The upsert the Phase 3 migration exists for.
 *
 * `ON CONFLICT (tracked_keyword_id, date) DO UPDATE` is what makes a re-run of
 * the same day's check idempotent: check-now twice in an afternoon and the
 * second result replaces the first rather than adding a second row that would
 * make every "previous position" delta read as zero.
 *
 * The last write wins deliberately — a later check is a fresher measurement of
 * the same day.
 */
async function writeSnapshots(
  db: JobContext["db"],
  rows: readonly {
    trackedKeywordId: string;
    date: string;
    position: number | null;
    url: string | null;
    serpFeaturesJson: string[];
  }[],
): Promise<void> {
  await db
    .insert(rankSnapshots)
    .values([...rows])
    .onConflictDoUpdate({
      target: [rankSnapshots.trackedKeywordId, rankSnapshots.date],
      set: {
        position: sql`excluded.position`,
        url: sql`excluded.url`,
        serpFeaturesJson: sql`excluded.serp_features_json`,
        createdAt: sql`excluded.created_at`,
      },
    });
}

function readPayload(raw: Record<string, unknown>): RankCollectPayload {
  const projectId = raw["projectId"];
  const date = raw["date"];
  const postedAt = raw["postedAt"];
  const tasks = raw["tasks"];

  if (
    typeof projectId !== "string" ||
    typeof date !== "string" ||
    typeof postedAt !== "number" ||
    !Array.isArray(tasks)
  ) {
    throw new ApiException(
      "internal_error",
      "rank_collect job has a malformed payload.",
    );
  }

  const parsed: RankCollectTask[] = [];
  for (const entry of tasks) {
    if (typeof entry !== "object" || entry === null) continue;
    const task = entry as Record<string, unknown>;
    if (
      typeof task["taskId"] !== "string" ||
      typeof task["trackedKeywordId"] !== "string"
    ) {
      continue;
    }
    parsed.push({
      taskId: task["taskId"],
      trackedKeywordId: task["trackedKeywordId"],
      tag: typeof task["tag"] === "string" ? task["tag"] : task["trackedKeywordId"],
      keyword: typeof task["keyword"] === "string" ? task["keyword"] : "",
    });
  }

  const collectedRaw = raw["collected"];
  const collected = Array.isArray(collectedRaw)
    ? collectedRaw.filter((id): id is string => typeof id === "string")
    : [];

  const pollsRaw = raw["polls"];
  const polls = typeof pollsRaw === "number" ? pollsRaw : 0;

  return { projectId, date, postedAt, tasks: parsed, collected, polls };
}
