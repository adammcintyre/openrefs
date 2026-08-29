/**
 *   GET /api/v1/dashboard?workspace=<id>   the home-screen rollup
 *
 * Five queries for six numbers, all against tables we already own — no
 * DataForSEO call, so the first screen after login costs nothing and works for
 * a workspace that has not configured credentials yet.
 *
 * "Five for six" is deliberate: the average position and the top-10 count are
 * two readings of the same set (the latest snapshot of every tracked keyword),
 * so they come out of one window query rather than running that window twice.
 * Everything else is one aggregate apiece.
 */
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../db";
import { audits, collections, projects, trackedKeywords } from "../../db";
import type { DashboardRollup } from "../../shared/dashboard";
import { sumMonthCostUsd } from "../dataforseo/metering";
import { authorizeWorkspace, workspaceParam } from "../lib/research";
import { readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const dashboardRouter = new Hono<AppEnv>();

dashboardRouter.use("*", requireSession);

const querySchema = z.object({ workspace: workspaceParam });

/** The best position that still counts as "top 10". */
export const TOP_10_MAX_POSITION = 10;

dashboardRouter.get("/", async (c) => {
  const { workspace } = readQuery(c, querySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  // Independent reads against different tables — issued together rather than
  // in sequence, since the round trips dominate and nothing here depends on
  // anything else here.
  const [keywordCount, ranks, collectionCount, monthSpendUsd, auditScore] =
    await Promise.all([
      countTrackedKeywords(db, workspace),
      rankRollup(db, workspace),
      countCollections(db, workspace),
      sumMonthCostUsd(db, workspace, new Date()),
      latestAuditScore(db, workspace),
    ]);

  const body: DashboardRollup = {
    trackedKeywords: keywordCount,
    avgPosition: ranks.avgPosition,
    top10Count: ranks.top10Count,
    collections: collectionCount,
    // Six places, matching the usage report: DataForSEO bills in fractions of
    // a cent and a float sum of many of them drifts.
    monthSpendUsd: Math.round(monthSpendUsd * 1_000_000) / 1_000_000,
    latestAuditScore: auditScore,
  };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Tracked keywords across the workspace.
 *
 * Joined through `projects` rather than counted per project: `tracked_keywords`
 * has no workspace column of its own — a project is what binds a keyword to a
 * tenant — and the join is what keeps another workspace's keywords out of the
 * count.
 */
async function countTrackedKeywords(
  db: Db,
  workspaceId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(trackedKeywords)
    .innerJoin(projects, eq(projects.id, trackedKeywords.projectId))
    .where(eq(projects.workspaceId, workspaceId));
  return Number(row?.total ?? 0);
}

async function countCollections(
  db: Db,
  workspaceId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(collections)
    .where(eq(collections.workspaceId, workspaceId));
  return Number(row?.total ?? 0);
}

interface RankRollup {
  avgPosition: number | null;
  top10Count: number;
}

/**
 * Average position and top-10 count, from **one** pass over the latest
 * snapshot of every tracked keyword in the workspace.
 *
 *     ROW_NUMBER() OVER (PARTITION BY tracked_keyword_id ORDER BY date DESC)
 *
 * keeping `rn = 1` — the same idiom the tracking table uses, for the same
 * reason: the alternative is a correlated `MAX(date)` subquery per keyword,
 * which is the N+1 this route exists to avoid.
 *
 * `WHERE position IS NOT NULL` is doing real work in both aggregates. A null
 * position means "checked, and not in the top 100"; counting it as 100 would
 * invent a measurement, and `AVG` in SQL skips nulls anyway, so the filter
 * makes the count agree with the average rather than the two disagreeing about
 * which keywords they describe.
 */
async function rankRollup(db: Db, workspaceId: string): Promise<RankRollup> {
  const rows = await db.all<{
    avg_position: number | null;
    top10: number | null;
  }>(sql`
    SELECT AVG(position)                                       AS avg_position,
           SUM(CASE WHEN position <= ${TOP_10_MAX_POSITION}
                    THEN 1 ELSE 0 END)                         AS top10
      FROM (
        SELECT s.position,
               ROW_NUMBER() OVER (
                 PARTITION BY s.tracked_keyword_id ORDER BY s.date DESC
               ) AS rn
          FROM rank_snapshots s
          JOIN tracked_keywords k ON k.id = s.tracked_keyword_id
          JOIN projects p        ON p.id = k.project_id
         WHERE p.workspace_id = ${workspaceId}
      )
     WHERE rn = 1 AND position IS NOT NULL
  `);

  const row = rows[0];
  const avg = row?.avg_position;
  return {
    // Null, not 0, when nothing ranks: there is no average of an empty set,
    // and 0 would read as "ranking first" on a metric card.
    avgPosition:
      typeof avg === "number" && Number.isFinite(avg)
        ? Math.round(avg * 10) / 10
        : null,
    top10Count: Number(row?.top10 ?? 0),
  };
}

/**
 * The OnPage score of the newest finished audit anywhere in the workspace.
 *
 * `status = 'done'` is the filter that matters: a `running` audit's
 * `summary_json` is `{}` until the poller ingests, and a `failed` one may hold
 * a partial rollup — either would put a misleading number on the dashboard.
 *
 * The score is read with `json_extract` rather than by hydrating the whole
 * rollup, because that document carries every category count and the issue
 * index; pulling all of it across to read one number would make the cheapest
 * card on the page the most expensive query behind it.
 *
 * The path is `$.summary.score`, not `$.score` — `summary_json` is an envelope
 * holding the published rollup alongside the poller's operational state. See
 * src/worker/audit/record.ts.
 */
async function latestAuditScore(
  db: Db,
  workspaceId: string,
): Promise<number | null> {
  const [row] = await db
    .select({
      score: sql<
        number | null
      >`json_extract(${audits.summaryJson}, '$.summary.score')`,
    })
    .from(audits)
    .innerJoin(projects, eq(projects.id, audits.projectId))
    .where(and(eq(projects.workspaceId, workspaceId), eq(audits.status, "done")))
    .orderBy(sql`${audits.createdAt} desc`)
    .limit(1);

  const score = row?.score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

export default dashboardRouter;
