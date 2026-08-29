/**
 * The job handler registry.
 *
 * One file per job type, named for the type, so a row in `jobs` tells you
 * which file runs it without a lookup. Adding a type means adding the file,
 * adding the name to `JOB_TYPES` in queue.ts, and adding one line here — the
 * `Record<JobType, JobHandler>` annotation turns a forgotten line into a
 * compile error rather than a job that quietly never runs.
 */
import { rankCollect } from "./rank_collect";
import { rankPost } from "./rank_post";
import type { JobType } from "./queue";
import { seedDaily } from "./seed_daily";
import type { JobHandler } from "./types";

export * from "./queue";
export * from "./snapshot";
export type { JobContext, JobDetail, JobHandler, JobRecord } from "./types";
export { ensureDailySeedJob } from "./seed_daily";
export type { RankPostPayload } from "./rank_post";
export type { RankCollectPayload, RankCollectTask } from "./rank_collect";

export const JOB_HANDLERS: Record<JobType, JobHandler> = {
  seed_daily: seedDaily,
  rank_post: rankPost,
  rank_collect: rankCollect,
};

/**
 * The handler for a type read out of the database, or null.
 *
 * `jobs.type` is a free-text column, so a row can name a handler that no
 * longer exists — after a rollback, say. Returning null lets the sweeper fail
 * that one job with a clear message instead of throwing somewhere less
 * informative.
 */
export function findJobHandler(type: string): JobHandler | null {
  return Object.hasOwn(JOB_HANDLERS, type)
    ? JOB_HANDLERS[type as JobType]
    : null;
}
