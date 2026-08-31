/**
 * Projects and rank tracking, as functions rather than routes.
 *
 * Pure D1 — nothing here calls DataForSEO, so nothing here spends. The two
 * read paths the MCP server exposes as tools (`list_projects`,
 * `tracked_keywords`) live here, together with the row loaders every other
 * handler in `routes/projects.ts` shares, so there is one definition of what a
 * `Project` row is and one place the workspace predicate is applied.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "../../db";
import { projects, rankSnapshots, trackedKeywords } from "../../db";
import type { Project, ProjectListResponse } from "../../shared/projects";
import type {
  RankPoint,
  RankSummaryResponse,
  TrackedKeywordRow,
  TrackedKeywordsResponse,
} from "../../shared/tracking";
import {
  RANK_SERIES_DAYS,
  hasAiOverview,
  positionChange,
  shiftIsoDate,
  toIsoDate,
} from "../../shared/tracking";
import { ApiException } from "../http";
import { hasQueuedJobForProject } from "../jobs";

export const projectColumns = {
  id: projects.id,
  name: projects.name,
  domain: projects.domain,
  locationCode: projects.locationCode,
  languageCode: projects.languageCode,
  createdAt: projects.createdAt,
};

export type ProjectRow = {
  id: string;
  name: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  createdAt: Date;
};

export function toProject(
  row: ProjectRow,
  keywordCount: number,
  lastCheckedDate: string | null,
): Project {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    locationCode: row.locationCode,
    languageCode: row.languageCode,
    createdAt: row.createdAt.toISOString(),
    keywordCount,
    lastCheckedAt:
      lastCheckedDate === null ? null : `${lastCheckedDate}T00:00:00.000Z`,
  };
}

/**
 * Loads a project, scoped to the workspace.
 *
 * The workspace predicate is what makes a valid id from another tenant a 404
 * rather than a read. Every route that touches a project goes through here
 * before it does anything else.
 */
export async function requireProject(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<ProjectRow> {
  const [row] = await db
    .select(projectColumns)
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspaceId)))
    .limit(1);

  if (row === undefined) {
    throw new ApiException("not_found", "No such project.");
  }
  return row;
}

export async function countKeywords(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(trackedKeywords)
    .where(eq(trackedKeywords.projectId, projectId));
  return Number(row?.total ?? 0);
}

/** Keyword counts for many projects, in one grouped query. */
export async function keywordCounts(
  db: Db,
  projectIds: readonly string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({
      projectId: trackedKeywords.projectId,
      total: sql<number>`count(*)`,
    })
    .from(trackedKeywords)
    .where(inArray(trackedKeywords.projectId, [...projectIds]))
    .groupBy(trackedKeywords.projectId);

  return new Map(rows.map((row) => [row.projectId, Number(row.total ?? 0)]));
}

/** Newest snapshot date per project, in one grouped query. */
export async function lastCheckedAtByProject(
  db: Db,
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({
      projectId: trackedKeywords.projectId,
      latest: sql<string | null>`max(${rankSnapshots.date})`,
    })
    .from(trackedKeywords)
    .innerJoin(
      rankSnapshots,
      eq(rankSnapshots.trackedKeywordId, trackedKeywords.id),
    )
    .where(inArray(trackedKeywords.projectId, [...projectIds]))
    .groupBy(trackedKeywords.projectId);

  const out = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.latest === "string") out.set(row.projectId, row.latest);
  }
  return out;
}

/** All-time best position per keyword, in one grouped query. */
async function bestPositions(
  db: Db,
  projectId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      trackedKeywordId: rankSnapshots.trackedKeywordId,
      best: sql<number | null>`min(${rankSnapshots.position})`,
    })
    .from(rankSnapshots)
    .innerJoin(
      trackedKeywords,
      eq(trackedKeywords.id, rankSnapshots.trackedKeywordId),
    )
    .where(eq(trackedKeywords.projectId, projectId))
    .groupBy(rankSnapshots.trackedKeywordId);

  const out = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.best === "number") out.set(row.trackedKeywordId, row.best);
  }
  return out;
}

interface SnapshotRow {
  date: string;
  position: number | null;
  url: string | null;
  serpFeatures: string[];
}

/**
 * Every snapshot the tracking table needs, for every keyword in the project,
 * in **one** query.
 *
 * Two requirements pull in opposite directions: the sparkline wants the last
 * 30 days, and the deltas want the latest two observations *however old they
 * are* — a project checked once, two months ago, must still show a position.
 * A window function satisfies both at once:
 *
 *     ROW_NUMBER() OVER (PARTITION BY tracked_keyword_id ORDER BY date DESC)
 *
 * keeping rows where `rn <= 2 OR date >= since`. The alternative — 30-day
 * window plus a per-keyword "latest two" lookup — is the N+1 this route exists
 * to avoid.
 *
 * The keyword set is expressed as a subquery on `project_id` rather than a
 * bound list of ids, so the statement carries two parameters no matter how
 * many keywords the project tracks.
 */
async function loadSnapshots(
  db: Db,
  projectId: string,
  since: string,
): Promise<Map<string, SnapshotRow[]>> {
  const rows = await db.all<{
    tracked_keyword_id: string;
    date: string;
    position: number | null;
    url: string | null;
    serp_features_json: string | null;
  }>(sql`
    SELECT tracked_keyword_id, date, position, url, serp_features_json
      FROM (
        SELECT s.tracked_keyword_id,
               s.date,
               s.position,
               s.url,
               s.serp_features_json,
               ROW_NUMBER() OVER (
                 PARTITION BY s.tracked_keyword_id ORDER BY s.date DESC
               ) AS rn
          FROM rank_snapshots s
         WHERE s.tracked_keyword_id IN (
                 SELECT id FROM tracked_keywords WHERE project_id = ${projectId}
               )
      )
     WHERE rn <= 2 OR date >= ${since}
     ORDER BY tracked_keyword_id ASC, date ASC
  `);

  const out = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const list = out.get(row.tracked_keyword_id) ?? [];
    list.push({
      date: row.date,
      position: row.position,
      url: row.url,
      serpFeatures: parseFeatures(row.serp_features_json),
    });
    out.set(row.tracked_keyword_id, list);
  }
  return out;
}

/**
 * `serp_features_json` comes back as text from a raw query (Drizzle's json
 * mode only applies to its own column mappings), so it is parsed here.
 * Defensively: a malformed value costs one row its feature chips, not the
 * whole table.
 */
function parseFeatures(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Rank summary                                                                */
/* -------------------------------------------------------------------------- */

/** Days the summary window may cover. Clamped, never refused. */
export const RANK_SUMMARY_MIN_DAYS = 7;
export const RANK_SUMMARY_MAX_DAYS = 180;
export const RANK_SUMMARY_DEFAULT_DAYS = 30;

/** `days`, clamped to what the rollup will actually serve. */
export function clampSummaryDays(days: number | undefined): number {
  const wanted = days ?? RANK_SUMMARY_DEFAULT_DAYS;
  if (!Number.isFinite(wanted)) return RANK_SUMMARY_DEFAULT_DAYS;
  return Math.min(
    RANK_SUMMARY_MAX_DAYS,
    Math.max(RANK_SUMMARY_MIN_DAYS, Math.trunc(wanted)),
  );
}

/**
 * The window's inclusive start date, `YYYY-MM-DD` UTC.
 *
 * **A date cutoff from today, not "the newest N distinct dates."** The two
 * differ for a project that stopped being checked: the cutoff shows the gap —
 * a chart that trails off, which is true and worth seeing — while "newest N
 * dates" would quietly stretch three months of stale checks across a 30-day
 * axis and make an abandoned project look current. `days` counts back
 * inclusively, so `days=7` covers today and the six days before it.
 */
export function rankSummarySince(days: number, now: Date): string {
  return shiftIsoDate(toIsoDate(now), -(days - 1)) ?? toIsoDate(now);
}

/** One decimal place, or null. Positions are 1–100; more precision is noise. */
function roundPosition(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

/**
 * GET /api/v1/projects/:id/rank/summary
 *
 * One grouped query over `rank_snapshots`, joined to `tracked_keywords` for the
 * project. Free: pure D1, no provider call, no `ResultMeta` — which is what
 * lets the overview chart render on every visit.
 *
 * Days with no check are **absent** rather than zero-filled. A project first
 * checked on a Tuesday has no Monday row, and inventing one would draw a line
 * to zero tracked keywords — a cliff that never happened. The shared type says
 * so too: plot by `date`, never by index.
 */
export async function rankSummary(
  db: Db,
  workspaceId: string,
  projectId: string,
  days: number,
  now: Date = new Date(),
): Promise<RankSummaryResponse> {
  await requireProject(db, workspaceId, projectId);

  const since = rankSummarySince(days, now);

  const rows = await db.all<{
    date: string;
    tracked: number;
    ranked: number;
    total_position: number | null;
    top3: number;
    top10: number;
    top100: number;
  }>(sql`
    SELECT s.date AS date,
           COUNT(*) AS tracked,
           COUNT(s.position) AS ranked,
           SUM(s.position) AS total_position,
           SUM(CASE WHEN s.position <= 3 THEN 1 ELSE 0 END) AS top3,
           SUM(CASE WHEN s.position <= 10 THEN 1 ELSE 0 END) AS top10,
           SUM(CASE WHEN s.position <= 100 THEN 1 ELSE 0 END) AS top100
      FROM rank_snapshots s
     WHERE s.date >= ${since}
       AND s.tracked_keyword_id IN (
             SELECT id FROM tracked_keywords WHERE project_id = ${projectId}
           )
     GROUP BY s.date
     ORDER BY s.date ASC
  `);

  return {
    days,
    points: rows.map((row) => {
      const ranked = Number(row.ranked ?? 0);
      return {
        date: row.date,
        /*
         * AVG over the positions that ranked, computed from SUM/COUNT rather
         * than SQL's AVG so the null case is explicit: a day where nothing
         * ranked has no average, and reporting 0 would put that day at the top
         * of a chart where lower is better — the best day the project ever had,
         * drawn from an absence.
         */
        avgPosition:
          ranked === 0
            ? null
            : roundPosition(Number(row.total_position ?? 0) / ranked),
        top3: Number(row.top3 ?? 0),
        top10: Number(row.top10 ?? 0),
        top100: Number(row.top100 ?? 0),
        // Every snapshot that day, ranked or not — the denominator the bands
        // are read against.
        tracked: Number(row.tracked ?? 0),
      };
    }),
  };
}

/** GET /api/v1/projects — newest first, with counts and last-checked. */
export async function listProjects(
  db: Db,
  workspaceId: string,
): Promise<ProjectListResponse> {
  const rows = await db
    .select(projectColumns)
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(desc(projects.createdAt));

  // Counts and last-checked for every project in two grouped queries rather
  // than two per project.
  const ids = rows.map((row) => row.id);
  const [counts, lastChecked] = await Promise.all([
    keywordCounts(db, ids),
    lastCheckedAtByProject(db, ids),
  ]);

  return {
    projects: rows.map((row) =>
      toProject(row, counts.get(row.id) ?? 0, lastChecked.get(row.id) ?? null),
    ),
  };
}

/**
 * GET /api/v1/projects/:id/keywords
 *
 * The whole tracking table in three queries, regardless of how many keywords
 * the project has: the keywords, their snapshots, and their all-time best.
 * The snapshot query is the interesting one — see `loadSnapshots`.
 */
export async function trackedKeywordsForProject(
  db: Db,
  workspaceId: string,
  projectId: string,
): Promise<TrackedKeywordsResponse> {
  const project = await requireProject(db, workspaceId, projectId);

  const rows = await db
    .select({
      id: trackedKeywords.id,
      keyword: trackedKeywords.keyword,
      device: trackedKeywords.device,
      locationCode: trackedKeywords.locationCode,
      languageCode: trackedKeywords.languageCode,
      createdAt: trackedKeywords.createdAt,
    })
    .from(trackedKeywords)
    .where(eq(trackedKeywords.projectId, projectId))
    .orderBy(trackedKeywords.createdAt);

  const since = shiftIsoDate(toIsoDate(new Date()), -RANK_SERIES_DAYS) ?? "";
  const [snapshots, best, checkInProgress] = await Promise.all([
    loadSnapshots(db, projectId, since),
    bestPositions(db, projectId),
    hasQueuedJobForProject(db, ["rank_post", "rank_collect"], projectId),
  ]);

  let lastCheckedAt: string | null = null;
  const keywords: TrackedKeywordRow[] = rows.map((row) => {
    const history = snapshots.get(row.id) ?? [];
    const latest = history.at(-1) ?? null;
    const previous = history.at(-2) ?? null;

    if (latest !== null && (lastCheckedAt === null || latest.date > lastCheckedAt)) {
      lastCheckedAt = latest.date;
    }

    // The sparkline window, which may be shorter than the history we loaded:
    // the latest two rows come back regardless of age so the deltas have
    // something to compare against even on a project nobody has checked in
    // months.
    const series: RankPoint[] = history
      .filter((point) => point.date >= since)
      .map((point) => ({ date: point.date, position: point.position }));

    return {
      id: row.id,
      keyword: row.keyword,
      device: row.device,
      locationCode: row.locationCode,
      languageCode: row.languageCode,
      createdAt: row.createdAt.toISOString(),
      latest:
        latest === null
          ? null
          : {
              date: latest.date,
              position: latest.position,
              url: latest.url,
              serpFeatures: latest.serpFeatures,
            },
      previous:
        previous === null
          ? null
          : { date: previous.date, position: previous.position },
      change1d: positionChange(history, 1),
      change7d: positionChange(history, 7),
      change30d: positionChange(history, 30),
      bestPosition: best.get(row.id) ?? null,
      // Phase 6 retrofit, free from data already loaded: the latest snapshot's
      // SERP features tell us whether Google is answering this query itself.
      aiOverview: hasAiOverview(latest?.serpFeatures ?? []),
      series,
    };
  });

  return {
    projectId: project.id,
    domain: project.domain,
    keywords,
    // A date, widened to a timestamp at the boundary: snapshots are day-grained
    // by design (one row per keyword per day), so this is that day at UTC
    // midnight rather than a fake wall-clock time.
    lastCheckedAt:
      lastCheckedAt === null ? null : `${lastCheckedAt as string}T00:00:00.000Z`,
    checkInProgress,
  };
}
