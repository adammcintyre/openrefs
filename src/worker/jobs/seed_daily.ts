/**
 * `seed_daily` — the job that starts every other job.
 *
 * Once a night it walks the projects that have tracked keywords and enqueues a
 * `rank_post` for each, then schedules tomorrow's copy of itself. It is the
 * only recurring job in the system; everything else is enqueued by a user
 * action or by this.
 *
 * Named for its `type`, like every file in this directory — given a row in
 * `jobs`, the handler is the file with the same name.
 */
import { eq } from "drizzle-orm";

import { projects, trackedKeywords } from "../../db";
import {
  enqueueJob,
  hasQueuedJob,
  nextDailySeedAt,
  queuedProjectIds,
} from "./queue";
import type { JobContext, JobDetail } from "./types";

/**
 * Spacing between the `rank_post` jobs one seed produces.
 *
 * Not throttling for its own sake: without it every project in a deployment
 * becomes due in the same second, and the sweeper's batch cap turns that into
 * a queue that drains ten-per-tick with every job's lease ticking. A gentle
 * stagger keeps each project's first attempt close to its scheduled time.
 */
export const SEED_STAGGER_MS = 30_000;

/** Ceiling on the stagger, so a large deployment still seeds within the hour. */
export const SEED_STAGGER_MAX_MS = 30 * 60_000;

export async function seedDaily(ctx: JobContext): Promise<JobDetail> {
  const { db, job, now } = ctx;

  /*
   * Projects worth checking: those with at least one tracked keyword. The
   * inner join is the filter — a project with no keywords would post an empty
   * batch and bill nothing, but it would still occupy a job slot every night.
   */
  const rows = await db
    .selectDistinct({
      projectId: projects.id,
      workspaceId: projects.workspaceId,
    })
    .from(projects)
    .innerJoin(trackedKeywords, eq(trackedKeywords.projectId, projects.id));

  // One query, not one per project: skip anything whose check from an earlier
  // run is still in flight, so a slow day does not stack two checks on one
  // project.
  const inFlight = await queuedProjectIds(db, ["rank_post", "rank_collect"]);

  let enqueued = 0;
  for (const row of rows) {
    if (inFlight.has(row.projectId)) continue;
    const delay = Math.min(enqueued * SEED_STAGGER_MS, SEED_STAGGER_MAX_MS);
    await enqueueJob(db, {
      type: "rank_post",
      workspaceId: row.workspaceId,
      payload: { projectId: row.projectId },
      runAt: new Date(now.getTime() + delay),
    });
    enqueued += 1;
  }

  /*
   * Tomorrow's seed, guarded against duplicates as the spec requires — and
   * excluding this job, which is `running` and would otherwise match its own
   * guard. The sweeper also re-creates a missing seed on every tick, so a seed
   * that exhausts its attempts does not end rank tracking permanently; this
   * re-enqueue is the normal path, that is the safety net.
   */
  const alreadyScheduled = await hasQueuedJob(db, "seed_daily", {
    excludeJobId: job.id,
  });

  let nextSeedAt: string | null = null;
  if (!alreadyScheduled) {
    const at = nextDailySeedAt(now);
    await enqueueJob(db, {
      type: "seed_daily",
      // No tenant: this job is deployment-wide housekeeping.
      workspaceId: null,
      runAt: at,
    });
    nextSeedAt = at.toISOString();
  }

  return {
    projectsConsidered: rows.length,
    skippedInFlight: rows.length - enqueued,
    rankPostsEnqueued: enqueued,
    nextSeedAt,
  };
}

/**
 * Ensures a `seed_daily` exists, creating one for the next 03:00 UTC if not.
 *
 * Called by the sweeper every tick. That makes the daily chain self-healing:
 * a fresh deployment has no seed job at all, and a seed that failed five times
 * has consumed the only one — both are the same missing-link problem, and this
 * fixes both without anyone noticing.
 */
export async function ensureDailySeedJob(
  ctx: Pick<JobContext, "db" | "now">,
): Promise<string | null> {
  if (await hasQueuedJob(ctx.db, "seed_daily")) return null;
  const at = nextDailySeedAt(ctx.now);
  await enqueueJob(ctx.db, {
    type: "seed_daily",
    workspaceId: null,
    runAt: at,
  });
  return at.toISOString();
}
