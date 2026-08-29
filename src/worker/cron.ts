// Background work runs here. No Queues and no Durable Objects — both are
// paid-plan primitives and self-hosting must stay on the Cloudflare free plan
// — so the `jobs` table in D1 is the queue and the five-minute cron trigger in
// wrangler.jsonc is the worker loop.

import { inArray, lte, and, sql } from "drizzle-orm";

import type { Db } from "../db";
import { getDb, jobs } from "../db";
import {
  ensureDailySeedJob,
  findJobHandler,
  isExhausted,
  JOB_LEASE_MS,
  nextRunAfterFailure,
  pruneJobs,
  SWEEP_BATCH_SIZE,
} from "./jobs";
import type { JobRecord } from "./jobs";

/** What one job did, for the sweep log and the dev endpoint. */
export interface SweepEntry {
  id: string;
  type: string;
  attempts: number;
  outcome: "done" | "retry" | "failed";
  /** Whatever the handler returned. Diagnostics only. */
  detail?: Record<string, unknown>;
  error?: string;
  /** ISO 8601, present when the job will be tried again. */
  nextRunAt?: string;
}

/** What one sweep did, returned so the scheduled handler can log it. */
export interface SweepResult {
  claimed: number;
  succeeded: number;
  /** Failed this time, but will be tried again. */
  retried: number;
  /** Out of attempts. Will not run again without intervention. */
  failed: number;
  /** Expired finished rows deleted by this tick's retention pass. */
  pruned: number;
  entries: SweepEntry[];
}

/**
 * Claims a batch of due jobs and runs them.
 *
 * **Re-entrancy is the whole design.** Cron invocations can overlap, a manual
 * run can land on top of a scheduled one, and a Worker can die mid-job. All
 * three are handled by one atomic statement:
 *
 *     UPDATE jobs
 *        SET status = 'running', run_at = now + lease, attempts = attempts + 1
 *      WHERE id IN (SELECT id FROM jobs
 *                    WHERE status IN ('pending','running') AND run_at <= now
 *                    ORDER BY run_at LIMIT n)
 *  RETURNING *
 *
 * Because the claim *moves* `run_at` into the future in the same statement
 * that flips the status, a second sweeper's `run_at <= now` predicate can no
 * longer see the row — SQLite serialises the two writes, so exactly one of
 * them gets each job. And because `running` rows with a lapsed `run_at` are
 * claimable, `run_at` doubles as a lease: a job whose Worker was killed
 * becomes due again by itself after `JOB_LEASE_MS` instead of being stuck in
 * `running` forever. That is why the predicate covers both statuses, and why
 * there is no separate `locked_until` column.
 */
export async function sweepJobs(env: Env): Promise<SweepResult> {
  const db = getDb(env.DB);
  const now = new Date();

  // Self-healing: a deployment that has never run, or whose seed job exhausted
  // its attempts, gets a new one here rather than silently never checking
  // ranks again.
  await ensureDailySeedJob({ db, now });

  const claimed = await claimDueJobs(db, now);

  const entries: SweepEntry[] = [];
  let succeeded = 0;
  let retried = 0;
  let failed = 0;

  for (const job of claimed) {
    const entry = await runOne(env, db, job, now);
    entries.push(entry);
    if (entry.outcome === "done") succeeded += 1;
    else if (entry.outcome === "retry") retried += 1;
    else failed += 1;
  }

  /*
   * Retention runs last, and deliberately after the handlers rather than
   * before: a job this very tick moved to `done` is far newer than any cutoff,
   * so ordering cannot affect what is deleted — but running last means a prune
   * that throws (a locked table, say) cannot cost us the work the tick already
   * did, because that work is already committed.
   *
   * It is not wrapped in a try/catch for the same reason nothing else here is:
   * a failing prune is a real fault and should surface in the cron log rather
   * than accumulate silently for months.
   */
  const pruned = await pruneJobs(db, now);

  return {
    claimed: claimed.length,
    succeeded,
    retried,
    failed,
    pruned,
    entries,
  };
}

/**
 * The atomic claim. See `sweepJobs` for why this shape and not a select
 * followed by an update.
 *
 * D1 supports `RETURNING`, so the claimed rows come back from the same
 * statement that claimed them — there is no window in which a row is claimed
 * but unknown to the claimer.
 */
async function claimDueJobs(db: Db, now: Date): Promise<JobRecord[]> {
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        // 'running' is included on purpose: such a row is only visible here
        // once its lease has lapsed, which means the run that claimed it died.
        inArray(jobs.status, ["pending", "running"]),
        lte(jobs.runAt, now),
      ),
    )
    .orderBy(jobs.runAt)
    .limit(SWEEP_BATCH_SIZE);

  const rows = await db
    .update(jobs)
    .set({
      status: "running",
      runAt: new Date(now.getTime() + JOB_LEASE_MS),
      attempts: sql`${jobs.attempts} + 1`,
    })
    .where(inArray(jobs.id, due))
    .returning();

  return rows.map(toJobRecord);
}

/** Runs one claimed job and records the outcome. */
async function runOne(
  env: Env,
  db: Db,
  job: JobRecord,
  now: Date,
): Promise<SweepEntry> {
  const handler = findJobHandler(job.type);
  if (handler === null) {
    // An unknown type will never become known by waiting, so it fails now
    // rather than burning five attempts to reach the same conclusion.
    await db
      .update(jobs)
      .set({ status: "failed", lastError: `No handler for job type "${job.type}".` })
      .where(eqId(job.id));
    return {
      id: job.id,
      type: job.type,
      attempts: job.attempts,
      outcome: "failed",
      error: `No handler for job type "${job.type}".`,
    };
  }

  try {
    const detail = await handler({ env, db, job, now });
    await db
      .update(jobs)
      .set({ status: "done", lastError: null })
      .where(eqId(job.id));
    return {
      id: job.id,
      type: job.type,
      attempts: job.attempts,
      outcome: "done",
      ...(detail ? { detail } : {}),
    };
  } catch (err) {
    const message = errorMessage(err);

    if (isExhausted(job.attempts)) {
      await db
        .update(jobs)
        .set({ status: "failed", lastError: message })
        .where(eqId(job.id));
      return {
        id: job.id,
        type: job.type,
        attempts: job.attempts,
        outcome: "failed",
        error: message,
      };
    }

    const nextRunAt = nextRunAfterFailure(now, job.attempts);
    await db
      .update(jobs)
      .set({ status: "pending", lastError: message, runAt: nextRunAt })
      .where(eqId(job.id));
    return {
      id: job.id,
      type: job.type,
      attempts: job.attempts,
      outcome: "retry",
      error: message,
      nextRunAt: nextRunAt.toISOString(),
    };
  }
}

function eqId(id: string) {
  return sql`${jobs.id} = ${id}`;
}

/**
 * Error text safe to persist in `last_error`.
 *
 * Truncated because this column is read by humans in a dashboard, and an
 * upstream stack trace would push everything useful off the screen.
 */
const MAX_ERROR_LENGTH = 500;

function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > MAX_ERROR_LENGTH
    ? `${raw.slice(0, MAX_ERROR_LENGTH)}…`
    : raw;
}

/** The claimed row, with `payload_json` narrowed to the shape handlers expect. */
function toJobRecord(row: typeof jobs.$inferSelect): JobRecord {
  const payload = row.payloadJson;
  return {
    id: row.id,
    type: row.type,
    workspaceId: row.workspaceId,
    payloadJson:
      typeof payload === "object" && payload !== null && !Array.isArray(payload)
        ? payload
        : {},
    runAt: row.runAt,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}
