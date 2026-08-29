/**
 * `seed_ai_weekly` — the AI Visibility half of the recurring schedule.
 *
 * Structurally `seed_daily`'s twin: a singleton that walks the projects with
 * work to do, enqueues one job per unit of work, and schedules its own
 * successor. Two things differ, and both come from what an LLM answer costs.
 *
 *  - **Weekly, not daily.** A rank check is a fraction of a cent and positions
 *    move overnight; an LLM answer is cents and does not change day to day.
 *    Daily runs would multiply the bill by seven to redraw the same line.
 *  - **One job per prompt, not per project.** See ai_run.ts — a prompt is the
 *    bounded unit, because each of its engines is a call that may take two
 *    minutes.
 */
import { eq } from "drizzle-orm";

import { aiPrompts, projects } from "../../db";
import {
  enqueueJob,
  hasQueuedJob,
  nextWeeklySeedAt,
  queuedPromptIds,
} from "./queue";
import type { JobContext, JobDetail } from "./types";

/**
 * Spacing between the `ai_run` jobs one seed produces.
 *
 * Wider than the rank seed's 30 seconds because the work behind each of these
 * is longer and DataForSEO caps concurrent live LLM tasks at 30 per account
 * per platform. Two minutes per prompt keeps a deployment comfortably under
 * that without anyone tuning anything.
 */
export const AI_SEED_STAGGER_MS = 120_000;

/** Ceiling on the stagger, so a large deployment still seeds within a day. */
export const AI_SEED_STAGGER_MAX_MS = 12 * 60 * 60_000;

export async function seedAiWeekly(ctx: JobContext): Promise<JobDetail> {
  const { db, job, now } = ctx;

  /*
   * Every prompt of every project that has any — the inner join is the filter,
   * exactly as in seed_daily. A project with no prompts contributes no rows and
   * costs nothing.
   */
  const rows = await db
    .select({
      promptId: aiPrompts.id,
      projectId: projects.id,
      workspaceId: projects.workspaceId,
    })
    .from(aiPrompts)
    .innerJoin(projects, eq(projects.id, aiPrompts.projectId))
    .orderBy(aiPrompts.createdAt, aiPrompts.id);

  /*
   * Prompts whose run from an earlier seed is still queued or in flight, so a
   * slow week does not stack two runs — and two runs' worth of spend — on one
   * prompt. Cheaper than seed_daily's per-project check because the payload key
   * is the prompt id itself.
   */
  const inFlight = await queuedPromptIds(db);

  let enqueued = 0;
  for (const row of rows) {
    if (inFlight.has(row.promptId)) continue;
    const delay = Math.min(enqueued * AI_SEED_STAGGER_MS, AI_SEED_STAGGER_MAX_MS);
    await enqueueJob(db, {
      type: "ai_run",
      workspaceId: row.workspaceId,
      payload: { promptId: row.promptId, projectId: row.projectId },
      runAt: new Date(now.getTime() + delay),
    });
    enqueued += 1;
  }

  // Next week's seed, guarded against duplicates and excluding this job, which
  // is `running` and would otherwise match its own guard.
  const alreadyScheduled = await hasQueuedJob(db, "seed_ai_weekly", {
    excludeJobId: job.id,
  });

  let nextSeedAt: string | null = null;
  if (!alreadyScheduled) {
    const at = nextWeeklySeedAt(now);
    await enqueueJob(db, {
      type: "seed_ai_weekly",
      // Deployment-wide housekeeping, no tenant.
      workspaceId: null,
      runAt: at,
    });
    nextSeedAt = at.toISOString();
  }

  return {
    promptsConsidered: rows.length,
    skippedInFlight: rows.length - enqueued,
    aiRunsEnqueued: enqueued,
    nextSeedAt,
  };
}

/**
 * Ensures a `seed_ai_weekly` exists, creating one for the next Monday 04:00 UTC
 * if not.
 *
 * Called by the sweeper every tick, for the same reason `ensureDailySeedJob` is:
 * a fresh deployment has no seed at all and a seed that exhausted its attempts
 * has consumed the only one. Both are the same broken chain, and this quietly
 * repairs it.
 */
export async function ensureWeeklyAiSeedJob(
  ctx: Pick<JobContext, "db" | "now">,
): Promise<string | null> {
  if (await hasQueuedJob(ctx.db, "seed_ai_weekly")) return null;
  const at = nextWeeklySeedAt(ctx.now);
  await enqueueJob(ctx.db, {
    type: "seed_ai_weekly",
    workspaceId: null,
    runAt: at,
  });
  return at.toISOString();
}
