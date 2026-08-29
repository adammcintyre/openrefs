/**
 *   GET    /api/v1/projects                          list for a workspace
 *   POST   /api/v1/projects                          create            (admin)
 *   PATCH  /api/v1/projects/:id                      update            (admin)
 *   DELETE /api/v1/projects/:id                      delete            (admin)
 *   GET    /api/v1/projects/:id/keywords             tracking table
 *   POST   /api/v1/projects/:id/keywords             bulk add + check now
 *   DELETE /api/v1/projects/:id/keywords             bulk remove
 *   POST   /api/v1/projects/:id/keywords/check-now   re-check           (admin)
 *
 * Projects and tracked keywords are pure D1 — nothing here calls DataForSEO.
 * The two routes that cause spending (`POST /keywords`, `check-now`) do it by
 * enqueueing a `rank_post` job; the money is spent later, by the sweeper,
 * where the spend cap gates it like any other call.
 *
 * Every route is workspace-scoped and every query is filtered by workspace id,
 * so a project id from another tenant reads as "not found" rather than leaking
 * its existence. Reading needs `member`; creating, changing and deleting a
 * project need `admin`, as does forcing a re-check.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../db";
import { projects, rankSnapshots, trackedKeywords } from "../../db";
import type {
  Project,
  ProjectDeletedResponse,
  ProjectListResponse,
  ProjectMutationResponse,
} from "../../shared/projects";
import {
  createProjectSchema,
  updateProjectSchema,
} from "../../shared/projects";
import type {
  RankCheckEnqueuedResponse,
  RankPoint,
  TrackedKeywordRow,
  TrackedKeywordsAddedResponse,
  TrackedKeywordsRemovedResponse,
  TrackedKeywordsResponse,
} from "../../shared/tracking";
import {
  addTrackedKeywordsSchema,
  positionChange,
  RANK_CHECK_COST_PER_KEYWORD_USD,
  RANK_SERIES_DAYS,
  removeTrackedKeywordsSchema,
  shiftIsoDate,
  toIsoDate,
} from "../../shared/tracking";
import { ApiException } from "../http";
import { enqueueJob, hasQueuedJobForProject } from "../jobs";
import { authorizeWorkspace, normalizeDomain, workspaceParam } from "../lib/research";
import { readJson, readParams, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const projectsRouter = new Hono<AppEnv>();

projectsRouter.use("*", requireSession);

const workspaceQuerySchema = z.object({ workspace: workspaceParam });
const idParamSchema = z.object({ id: z.string().trim().min(1) });

/** One check per hour per project. */
export const CHECK_NOW_WINDOW_SECONDS = 60 * 60;

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

projectsRouter.get("/", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const rows = await db
    .select(projectColumns)
    .from(projects)
    .where(eq(projects.workspaceId, workspace))
    .orderBy(desc(projects.createdAt));

  // Counts and last-checked for every project in two grouped queries rather
  // than two per project.
  const ids = rows.map((row) => row.id);
  const [counts, lastChecked] = await Promise.all([
    keywordCounts(db, ids),
    lastCheckedAtByProject(db, ids),
  ]);

  const body: ProjectListResponse = {
    projects: rows.map((row) =>
      toProject(row, counts.get(row.id) ?? 0, lastChecked.get(row.id) ?? null),
    ),
  };
  return c.json(body);
});

projectsRouter.post("/", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");
  const input = await readJson(c, createProjectSchema);

  const domain = normalizeDomain(input.domain);
  assertHostname(domain);

  const [created] = await db
    .insert(projects)
    .values({
      workspaceId: workspace,
      name: input.name,
      domain,
      // Undefined lets the column defaults (UK / English) apply.
      ...(input.locationCode === undefined
        ? {}
        : { locationCode: input.locationCode }),
      ...(input.languageCode === undefined
        ? {}
        : { languageCode: input.languageCode }),
    })
    .returning(projectColumns);

  if (created === undefined) {
    throw new ApiException("internal_error", "Could not create the project.");
  }

  const body: ProjectMutationResponse = { project: toProject(created, 0, null) };
  return c.json(body, 201);
});

projectsRouter.patch("/:id", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");
  const patch = await readJson(c, updateProjectSchema);

  await requireProject(db, workspace, id);

  const domain =
    patch.domain === undefined ? undefined : normalizeDomain(patch.domain);
  if (domain !== undefined) assertHostname(domain);

  // The workspace predicate is repeated on the write, not just the read:
  // authorising and mutating on separate rows is how a scoping bug gets in.
  const [updated] = await db
    .update(projects)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(domain === undefined ? {} : { domain }),
      ...(patch.locationCode === undefined
        ? {}
        : { locationCode: patch.locationCode }),
      ...(patch.languageCode === undefined
        ? {}
        : { languageCode: patch.languageCode }),
    })
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace)))
    .returning(projectColumns);

  if (updated === undefined) {
    throw new ApiException("not_found", "No such project.");
  }

  const [counts, lastChecked] = await Promise.all([
    keywordCounts(db, [id]),
    lastCheckedAtByProject(db, [id]),
  ]);

  const body: ProjectMutationResponse = {
    project: toProject(
      updated,
      counts.get(id) ?? 0,
      lastChecked.get(id) ?? null,
    ),
  };
  return c.json(body);
});

projectsRouter.delete("/:id", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");

  await requireProject(db, workspace, id);

  // tracked_keywords → rank_snapshots, audits and ai_prompts all cascade from
  // this FK (see db/schema.ts), so the children go with it. Queued jobs carry
  // `workspace_id` and cascade from the workspace, not the project, so a
  // rank_post for a deleted project can still be claimed — both rank handlers
  // treat a missing project as "nothing to do" rather than an error.
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, workspace)));

  const body: ProjectDeletedResponse = { deleted: true, id };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Tracked keywords                                                            */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/projects/:id/keywords
 *
 * The whole tracking table in three queries, regardless of how many keywords
 * the project has: the keywords, their snapshots, and their all-time best.
 * The snapshot query is the interesting one — see `loadSnapshots`.
 */
projectsRouter.get("/:id/keywords", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const project = await requireProject(db, workspace, id);

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
    .where(eq(trackedKeywords.projectId, id))
    .orderBy(trackedKeywords.createdAt);

  const since = shiftIsoDate(toIsoDate(new Date()), -RANK_SERIES_DAYS) ?? "";
  const [snapshots, best, checkInProgress] = await Promise.all([
    loadSnapshots(db, id, since),
    bestPositions(db, id),
    hasQueuedJobForProject(db, ["rank_post", "rank_collect"], id),
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
      series,
    };
  });

  const body: TrackedKeywordsResponse = {
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
  return c.json(body);
});

/**
 * POST /api/v1/projects/:id/keywords
 *
 * Bulk add, idempotent against the (project, keyword, location, language,
 * device) unique index, then an immediate `rank_post` for whatever was
 * actually new — so the first data lands in minutes rather than at 03:00
 * tomorrow.
 */
projectsRouter.post("/:id/keywords", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  const input = await readJson(c, addTrackedKeywordsSchema);

  const project = await requireProject(db, workspace, id);

  const device = input.device ?? "desktop";
  const locationCode = input.locationCode ?? project.locationCode;
  const languageCode = input.languageCode ?? project.languageCode;

  const wanted = dedupeKeywords(input.keywords);
  if (wanted.length === 0) {
    throw new ApiException("validation_failed", "No usable keywords supplied.");
  }

  /*
   * De-duplicated before it reaches SQLite, not merely tidied: SQLite rejects
   * an INSERT whose own VALUES list repeats a unique key, and ON CONFLICT DO
   * NOTHING does not save it — the conflict is within the statement. A pasted
   * list containing "photo booth" twice would otherwise fail entirely.
   */
  const inserted = await db
    .insert(trackedKeywords)
    .values(
      wanted.map((keyword) => ({
        projectId: id,
        keyword,
        locationCode,
        languageCode,
        device,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: trackedKeywords.id });

  let checkEnqueued = false;
  if (inserted.length > 0) {
    await enqueueJob(db, {
      type: "rank_post",
      workspaceId: workspace,
      payload: {
        projectId: id,
        trackedKeywordIds: inserted.map((row) => row.id),
      },
    });
    checkEnqueued = true;
  }

  const body: TrackedKeywordsAddedResponse = {
    added: inserted.length,
    skipped: wanted.length - inserted.length,
    submitted: wanted.length,
    keywordCount: await countKeywords(db, id),
    checkEnqueued,
  };
  return c.json(body);
});

projectsRouter.delete("/:id/keywords", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  const { ids } = await readJson(c, removeTrackedKeywordsSchema);

  await requireProject(db, workspace, id);

  const targets = [...new Set(ids)];
  const before = await countKeywords(db, id);

  if (targets.length > 0) {
    // The project predicate is what stops an id from another project — or
    // another tenant — being deleted through this path.
    await db
      .delete(trackedKeywords)
      .where(
        and(
          eq(trackedKeywords.projectId, id),
          inArray(trackedKeywords.id, targets),
        ),
      );
  }

  const after = await countKeywords(db, id);
  const body: TrackedKeywordsRemovedResponse = {
    removed: before - after,
    keywordCount: after,
  };
  return c.json(body);
});

/**
 * POST /api/v1/projects/:id/keywords/check-now
 *
 * Rate-limited to once an hour per project, in KV.
 *
 * The limit is about money, not load: each press buys one SERP per keyword,
 * and rank positions do not move fast enough for a second check within the
 * hour to tell anyone anything. KV is eventually consistent, so this is a
 * deterrent rather than a hard limit — the same trade as the login throttle,
 * and acceptable for the same reason (the alternative is a Durable Object,
 * which the free plan does not have).
 */
projectsRouter.post("/:id/keywords/check-now", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");

  await requireProject(db, workspace, id);

  const keywordCount = await countKeywords(db, id);
  if (keywordCount === 0) {
    throw new ApiException(
      "conflict",
      "This project has no tracked keywords to check.",
    );
  }

  const key = checkNowKey(workspace, id);
  const existing = await c.env.CACHE.get(key);
  if (existing !== null) {
    const until = Number.parseInt(existing, 10);
    throw new ApiException(
      "rate_limited",
      "This project was checked within the last hour. Rank positions are updated daily; try again later.",
      {
        nextAllowedAt: Number.isFinite(until)
          ? new Date(until).toISOString()
          : null,
      },
    );
  }

  const nextAllowedAt = new Date(
    Date.now() + CHECK_NOW_WINDOW_SECONDS * 1000,
  );
  await c.env.CACHE.put(key, String(nextAllowedAt.getTime()), {
    expirationTtl: CHECK_NOW_WINDOW_SECONDS,
  });

  // No keyword ids: this is "check the whole project", so the job resolves the
  // list at run time and picks up anything added since.
  await enqueueJob(db, {
    type: "rank_post",
    workspaceId: workspace,
    payload: { projectId: id },
  });

  const body: RankCheckEnqueuedResponse = {
    enqueued: true,
    keywordCount,
    estimatedCostUsd: keywordCount * RANK_CHECK_COST_PER_KEYWORD_USD,
    nextAllowedAt: nextAllowedAt.toISOString(),
  };
  return c.json(body, 202);
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * KV key for the check-now limiter.
 *
 * Prefixed `ws:<workspaceId>:` because CLAUDE.md hard rule #6 requires every
 * KV key holding workspace data to be reachable by the deletion sweep.
 */
export function checkNowKey(workspaceId: string, projectId: string): string {
  return `ws:${workspaceId}:rl:check-now:${projectId}`;
}

const projectColumns = {
  id: projects.id,
  name: projects.name,
  domain: projects.domain,
  locationCode: projects.locationCode,
  languageCode: projects.languageCode,
  createdAt: projects.createdAt,
};

type ProjectRow = {
  id: string;
  name: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  createdAt: Date;
};

function toProject(
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
async function requireProject(
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

async function countKeywords(db: Db, projectId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(trackedKeywords)
    .where(eq(trackedKeywords.projectId, projectId));
  return Number(row?.total ?? 0);
}

/** Keyword counts for many projects, in one grouped query. */
async function keywordCounts(
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
async function lastCheckedAtByProject(
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

/** Trimmed, lowercased, first occurrence wins — the form the index dedupes on. */
export function dedupeKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of keywords) {
    const keyword = raw.trim().toLowerCase();
    if (keyword === "") continue;
    seen.add(keyword);
  }
  return [...seen];
}

/**
 * Rejects anything that survived `normalizeDomain` without looking like a
 * hostname — the same check `domainParam` applies to the research routes,
 * applied here because this domain arrives in a JSON body rather than a query.
 */
function assertHostname(domain: string): void {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new ApiException(
      "validation_failed",
      "domain must be a hostname, e.g. 'example.com'.",
    );
  }
}

export default projectsRouter;
