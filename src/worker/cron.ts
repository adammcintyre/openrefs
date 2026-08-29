// Background work runs here. No Queues and no Durable Objects — both are
// paid-plan primitives and self-hosting must stay on the Cloudflare free plan
// — so the `jobs` table in D1 is the queue and the five-minute cron trigger in
// wrangler.jsonc is the worker loop.

/** What one sweep did, returned so the scheduled handler can log it. */
export interface SweepResult {
  claimed: number;
  succeeded: number;
  failed: number;
}

/**
 * Stub. Owned by the Phase 3 (rank tracking) agent, which hardens this.
 *
 * Intended shape:
 *  1. `SELECT ... FROM jobs WHERE status = 'pending' AND run_at <= now
 *     ORDER BY run_at LIMIT n` — served by the jobs_status_run_at_idx index.
 *  2. Claim each row by flipping it to 'running' with a conditional UPDATE, so
 *     two overlapping cron invocations cannot take the same job.
 *  3. Dispatch on `jobs.type` to a handler registry.
 *  4. On failure: increment `attempts`, record `last_error`, and either push
 *     `run_at` out for a retry or mark it 'failed'.
 *
 * Keep every unit of work well inside the Workers CPU limit: long crawls
 * belong in many small jobs, not one big one.
 */
export async function sweepJobs(_env: Env): Promise<SweepResult> {
  // TODO(jobs): implement claim + dispatch. A zeroed result keeps the
  // scheduled handler honest until then.
  return { claimed: 0, succeeded: 0, failed: 0 };
}
