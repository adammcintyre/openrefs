/**
 * The `jobs` table as a queue: enqueueing, retry timing, and the small pure
 * calculations the sweeper is built out of.
 *
 * Nothing here dispatches or runs anything — that is cron.ts (the sweep) and
 * jobs/index.ts (the registry). Keeping the arithmetic in this file, free of
 * bindings, is what lets the retry schedule and the daily seed time be tested
 * without a database.
 */
import { and, eq, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";

import type { Db } from "../../db";
import { jobs } from "../../db";

/**
 * Every job type the registry knows. Adding one means adding a file named for
 * it under src/worker/jobs/ and an entry in the registry — see jobs/index.ts.
 */
export const JOB_TYPES = [
  "seed_daily",
  "rank_post",
  "rank_collect",
  "audit_poll",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/**
 * Jobs claimed per cron tick.
 *
 * Deliberately small. A tick has one Workers CPU budget and a subrequest
 * allowance to share between everything it claims, so the way to get more work
 * done is more ticks, not a bigger batch — the cron fires every five minutes
 * and an unfinished backlog simply carries.
 */
export const SWEEP_BATCH_SIZE = 5;

/**
 * How long a claimed job is assumed to be running before another sweep may
 * take it back.
 *
 * `run_at` doubles as the lease: claiming pushes it this far out, so a job
 * whose Worker died mid-run becomes due again on its own rather than sitting
 * in `running` forever. Long enough that a slow-but-alive job is not run twice,
 * short enough that a crash costs one lease, not a day.
 */
export const JOB_LEASE_MS = 15 * 60_000;

/** Attempts before a job stops retrying and is marked `failed`. */
export const JOB_MAX_ATTEMPTS = 5;

/** The `5min` in `5min * 2^attempts`. */
export const JOB_BASE_BACKOFF_MS = 5 * 60_000;

/** Hour (UTC) the daily seed runs. Quiet everywhere, cheap everywhere. */
export const DAILY_SEED_HOUR_UTC = 3;

/**
 * Retry delay after a failure: `5min * 2^attempts`, with `attempts` the value
 * *after* the claim incremented it. So a first failure waits 10 minutes, then
 * 20, 40, 80 — and the fifth attempt does not wait, because `JOB_MAX_ATTEMPTS`
 * has been reached and the job is failed instead.
 *
 * The ceiling is therefore bounded by `JOB_MAX_ATTEMPTS`, not by a clamp: at 5
 * attempts the longest wait this can produce is 80 minutes. Raising the
 * attempt limit without adding a clamp would grow it exponentially.
 */
export function backoffMs(attempts: number): number {
  const safe = Math.max(0, Math.floor(attempts));
  return JOB_BASE_BACKOFF_MS * 2 ** safe;
}

/** When a failed job should next be tried. */
export function nextRunAfterFailure(now: Date, attempts: number): Date {
  return new Date(now.getTime() + backoffMs(attempts));
}

/** True once a job has used up its attempts and should be failed, not retried. */
export function isExhausted(attempts: number): boolean {
  return attempts >= JOB_MAX_ATTEMPTS;
}

/**
 * The next 03:00 UTC strictly after `now`.
 *
 * Strictly: a seed job that runs at exactly 03:00 must schedule tomorrow's,
 * not re-schedule its own slot and run again immediately. `setUTCDate` past
 * the end of the month rolls the month (and the year) over for us.
 */
export function nextDailySeedAt(now: Date): Date {
  const at = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      DAILY_SEED_HOUR_UTC,
      0,
      0,
      0,
    ),
  );
  if (at.getTime() <= now.getTime()) {
    at.setUTCDate(at.getUTCDate() + 1);
  }
  return at;
}

/**
 * Splits a list into runs of at most `size`.
 *
 * Used for both upstream batching (DataForSEO takes 100 tasks per call) and
 * keeping a single job's work bounded. A non-positive size would loop forever,
 * so it is clamped rather than trusted.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Retention                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * `jobs` is a queue, not a history. Nothing reads a finished row — the sweep
 * claims by `status IN ('pending','running')`, and the dev endpoint reports
 * what a sweep just did — so without pruning the table grows forever, one row
 * per keyword per night, until D1's storage limit becomes a self-hoster's
 * problem. These two windows are the compromise between that and the one thing
 * a finished row is genuinely good for: answering "what happened last night?"
 */

/**
 * How long a `done` job is kept. A week covers "did last night's check run?"
 * and every weekly-cadence question anyone asks of a job log; past that the row
 * is landfill, because the work it describes is visible in `rank_snapshots`
 * and `audits` instead.
 */
export const JOB_RETENTION_DONE_MS = 7 * 24 * 60 * 60_000;

/**
 * How long a `failed` job is kept — deliberately far longer than a success.
 *
 * A failure carries `last_error`, which is the only surviving record of *why*
 * something did not happen, and failures are noticed late (a chart with a hole
 * in it is what prompts the look). Thirty days means a monthly review still
 * finds the evidence.
 */
export const JOB_RETENTION_FAILED_MS = 30 * 24 * 60 * 60_000;

/**
 * Rows one prune may delete.
 *
 * The prune shares its tick with real work, so it is bounded for the same
 * reason `SWEEP_BATCH_SIZE` is: a deployment coming back from a month of
 * downtime must not turn the first cron into one enormous statement. Anything
 * over the bound simply goes on the next tick, five minutes later — and since
 * the backlog only shrinks, the table converges.
 */
export const JOB_PRUNE_LIMIT = 200;

export interface JobRetentionCutoffs {
  /** `done` rows last touched before this are prunable. */
  done: Date;
  /** `failed` rows last touched before this are prunable. */
  failed: Date;
}

/**
 * The two cutoff instants, as pure arithmetic so the policy can be tested
 * without a database.
 */
export function jobRetentionCutoffs(now: Date): JobRetentionCutoffs {
  return {
    done: new Date(now.getTime() - JOB_RETENTION_DONE_MS),
    failed: new Date(now.getTime() - JOB_RETENTION_FAILED_MS),
  };
}

/**
 * Which rows a prune at `now` may delete.
 *
 * Split out so the test can render it to SQL and assert on the policy itself —
 * that only `done` and `failed` appear, and that each gets its own cutoff.
 * A bug that let this match `pending` would silently delete queued work, which
 * is the failure this predicate is most worth pinning against.
 *
 * **`run_at`, not `created_at`.** For a finished job `run_at` is when the sweep
 * last touched it (the claim pushes it out by one `JOB_LEASE_MS`), so it means
 * "finished around then" — which is what retention is actually about — whereas
 * `created_at` means "enqueued then" and would prune a long-queued job early.
 * It is also the indexed column: `jobs_status_run_at_idx` is `(status, run_at)`,
 * exactly this predicate's shape. The 15-minute lease skew is immaterial
 * against a 7-day window.
 */
export function jobPrunePredicate(now: Date): SQL {
  const cutoff = jobRetentionCutoffs(now);
  const predicate = or(
    and(eq(jobs.status, "done"), lt(jobs.runAt, cutoff.done)),
    and(eq(jobs.status, "failed"), lt(jobs.runAt, cutoff.failed)),
  );
  // `or()` is only undefined for an empty argument list; both arms are static.
  if (predicate === undefined) {
    throw new Error("jobPrunePredicate built an empty predicate.");
  }
  return predicate;
}

/**
 * Deletes up to `JOB_PRUNE_LIMIT` expired rows in **one** statement.
 *
 * `DELETE ... WHERE id IN (SELECT id ... LIMIT n)` rather than `DELETE ...
 * LIMIT n`, because `DELETE`'s own `LIMIT` is a compile-time SQLite option that
 * D1 does not guarantee. The subquery form is portable and bounds the statement
 * just as well.
 *
 * Returns how many rows went, for the sweep log.
 */
export async function pruneJobs(db: Db, now: Date): Promise<number> {
  const expired = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(jobPrunePredicate(now))
    .orderBy(jobs.runAt)
    .limit(JOB_PRUNE_LIMIT);

  const deleted = await db
    .delete(jobs)
    .where(inArray(jobs.id, expired))
    .returning({ id: jobs.id });

  return deleted.length;
}

/* -------------------------------------------------------------------------- */
/* Enqueueing                                                                  */
/* -------------------------------------------------------------------------- */

export interface EnqueueJobInput {
  type: JobType;
  /**
   * Required for anything touching tenant data — the FK cascade is what stops
   * a deleted workspace leaving queued work behind (CLAUDE.md hard rule #6).
   * Null only for housekeeping with no tenant, like the daily seed.
   */
  workspaceId: string | null;
  payload?: Record<string, unknown>;
  /** Defaults to now, i.e. the next sweep. */
  runAt?: Date;
}

/** Inserts one job and returns its id. */
export async function enqueueJob(
  db: Db,
  input: EnqueueJobInput,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(jobs).values({
    id,
    type: input.type,
    workspaceId: input.workspaceId,
    payloadJson: input.payload ?? {},
    runAt: input.runAt ?? new Date(),
    status: "pending",
  });
  return id;
}

/** Statuses that mean "this work is already queued or under way". */
const LIVE_STATUSES = ["pending", "running"] as const;

/**
 * Whether a job of this type is already queued or running, optionally narrowed
 * to one workspace.
 *
 * The duplicate guard for the daily seed, and for `check-now`'s "a check is
 * already in flight" answer. It is advisory, not a lock: two sweeps could both
 * read "no" before either inserts. That is acceptable for every current caller
 * — a duplicated seed enqueues rank_post jobs that the unique-index upsert
 * makes idempotent anyway — and it is the reason nothing here pretends to be a
 * mutex.
 */
export async function hasQueuedJob(
  db: Db,
  type: JobType,
  options: { workspaceId?: string; excludeJobId?: string } = {},
): Promise<boolean> {
  const predicates = [
    eq(jobs.type, type),
    inArray(jobs.status, [...LIVE_STATUSES]),
  ];
  if (options.workspaceId !== undefined) {
    predicates.push(eq(jobs.workspaceId, options.workspaceId));
  }
  // A running job asking "is one of me already queued?" would otherwise always
  // answer yes — it is itself, in `running`.
  if (options.excludeJobId !== undefined) {
    predicates.push(ne(jobs.id, options.excludeJobId));
  }

  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(jobs)
    .where(and(...predicates));

  return Number(row?.total ?? 0) > 0;
}

/**
 * Live jobs of a type whose payload names this project.
 *
 * `payload_json ->> '$.projectId'` is SQLite's JSON operator, which D1
 * supports; it avoids a `projects`-shaped column on `jobs` for what is really
 * one feature's bookkeeping.
 */
export async function hasQueuedJobForProject(
  db: Db,
  types: readonly JobType[],
  projectId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(jobs)
    .where(
      and(
        inArray(jobs.type, [...types]),
        inArray(jobs.status, [...LIVE_STATUSES]),
        sql`json_extract(${jobs.payloadJson}, '$.projectId') = ${projectId}`,
      ),
    );

  return Number(row?.total ?? 0) > 0;
}

/**
 * Every project id named by a live job of these types, in one query.
 *
 * The bulk form of the check above, for the daily seed: asking per project
 * would be one query per project per night, which is exactly the N+1 the seed
 * exists to avoid.
 */
export async function queuedProjectIds(
  db: Db,
  types: readonly JobType[],
): Promise<Set<string>> {
  const rows = await db
    .select({
      projectId: sql<
        string | null
      >`json_extract(${jobs.payloadJson}, '$.projectId')`,
    })
    .from(jobs)
    .where(
      and(
        inArray(jobs.type, [...types]),
        inArray(jobs.status, [...LIVE_STATUSES]),
      ),
    );

  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.projectId === "string" && row.projectId !== "") {
      ids.add(row.projectId);
    }
  }
  return ids;
}
