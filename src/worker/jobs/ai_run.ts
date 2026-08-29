/**
 * `ai_run` — asks one prompt of every engine it is configured for.
 *
 * One job per prompt, not per project: a prompt × engine pair is a live LLM
 * call documented at up to 120 seconds, so a project with ten prompts would
 * otherwise be one job holding a Worker open for twenty minutes. Per prompt,
 * the unit of work is bounded by the engine list — at most four calls — and a
 * failure retries one prompt rather than re-buying the whole project's answers.
 *
 * This job spends money on every run. That shapes two decisions:
 *
 *  - **Engines are attempted independently.** One engine returning an error
 *    must not discard the answers already bought from the others, so failures
 *    are collected and reported rather than thrown — unless *every* engine
 *    failed, which is a real failure worth retrying.
 *  - **The spend cap gates it the same way it gates everything**, inside the
 *    client, before the call. A capped workspace's run fails with
 *    `spend_cap_exceeded` having spent nothing.
 */
import { eq } from "drizzle-orm";

import { aiPrompts, projects } from "../../db";
import { readEngines, type AiEngineId } from "../../shared/ai";
import { toIsoDate } from "../../shared/tracking";
import { writeAiSnapshot, type AiSnapshotWrite } from "../ai/snapshot";
import { createDataForSeoApi } from "../dataforseo";
import { ApiException } from "../http";
import type { JobContext, JobDetail } from "./types";

export interface AiRunPayload {
  promptId: string;
  /** Narrows the run to a subset of the prompt's engines. Rare; for retries. */
  engines?: AiEngineId[];
}

/** One engine that did not answer, kept so the job log says which and why. */
interface EngineFailure {
  engine: AiEngineId;
  message: string;
}

export async function aiRun(ctx: JobContext): Promise<JobDetail> {
  const { env, db, job, now } = ctx;
  const payload = readPayload(job.payloadJson);

  const [row] = await db
    .select({
      promptId: aiPrompts.id,
      prompt: aiPrompts.prompt,
      enginesJson: aiPrompts.enginesJson,
      projectId: projects.id,
      workspaceId: projects.workspaceId,
      domain: projects.domain,
      locationCode: projects.locationCode,
    })
    .from(aiPrompts)
    .innerJoin(projects, eq(projects.id, aiPrompts.projectId))
    .where(eq(aiPrompts.id, payload.promptId))
    .limit(1);

  // Deleted between enqueue and run. Nothing to do and nothing wrong — succeed
  // so the job stops instead of retrying five times against a missing row.
  if (row === undefined) {
    return { skipped: "prompt_deleted", promptId: payload.promptId };
  }

  const configured = readEngines(row.enginesJson);
  const engines =
    payload.engines === undefined
      ? configured
      : configured.filter((engine) => payload.engines?.includes(engine));

  if (engines.length === 0) {
    return { skipped: "no_engines", promptId: row.promptId };
  }

  const dfs = await createDataForSeoApi(env, db, row.workspaceId);

  /*
   * The day this run belongs to, fixed once. Taking it per engine would file a
   * run that crosses midnight under two dates and split one comparison across
   * two rows of the trend.
   */
  const date = toIsoDate(now);

  const written: AiSnapshotWrite[] = [];
  const failures: EngineFailure[] = [];
  let costUsd = 0;

  for (const engine of engines) {
    try {
      const response = await dfs.ai.llmResponseLive({
        engine,
        prompt: row.prompt,
        countryIsoCode: countryForLocation(row.locationCode),
      });
      costUsd += response.costUsd;

      written.push(
        await writeAiSnapshot({
          db,
          bucket: env.BLOBS,
          workspaceId: row.workspaceId,
          promptId: row.promptId,
          prompt: row.prompt,
          domain: row.domain,
          date,
          now,
          response,
        }),
      );
    } catch (error) {
      /*
       * A cap breach is not one engine's problem — every remaining call would
       * hit the same wall, and retrying the job is the right response — so it
       * propagates instead of being collected.
       */
      if (error instanceof ApiException && error.code === "spend_cap_exceeded") {
        throw error;
      }
      failures.push({ engine, message: describe(error) });
    }
  }

  // Every engine failed: that is a failed run, and the sweeper's backoff is
  // the right answer. A partial success is reported and kept.
  if (written.length === 0 && failures.length > 0) {
    throw new ApiException(
      "upstream_error",
      `Every engine failed for this prompt: ${failures
        .map((f) => `${f.engine} (${f.message})`)
        .join("; ")}`,
    );
  }

  return {
    promptId: row.promptId,
    projectId: row.projectId,
    date,
    engines: engines.length,
    snapshots: written.length,
    mentioned: written.filter((w) => w.mentioned).length,
    cited: written.filter((w) => w.cited).length,
    citations: written.reduce((sum, w) => sum + w.citationCount, 0),
    costUsd,
    failures,
    results: written,
  };
}

/**
 * DataForSEO's `location_code` for our default markets, as the ISO country the
 * LLM engines want for `web_search_country_iso_code`.
 *
 * Deliberately a two-entry lookup rather than a locations-list round trip:
 * these are hints that make an answer more locally relevant, and an unmapped
 * market simply gets the engine's own default rather than a paid metadata call
 * on every run. 2826/2840 are the UK/US codes named in docs/ARCHITECTURE.md.
 */
export function countryForLocation(locationCode: number): string | undefined {
  switch (locationCode) {
    case 2826:
      return "GB";
    case 2840:
      return "US";
    default:
      return undefined;
  }
}

function describe(error: unknown): string {
  if (error instanceof ApiException) return error.message;
  return error instanceof Error ? error.message : "unknown error";
}

function readPayload(raw: Record<string, unknown>): AiRunPayload {
  const promptId = raw["promptId"];
  if (typeof promptId !== "string" || promptId === "") {
    throw new ApiException(
      "internal_error",
      "ai_run job has no promptId in its payload.",
    );
  }
  const engines = readEngines(raw["engines"]);
  return engines.length > 0 ? { promptId, engines } : { promptId };
}
