/**
 *   GET    /api/v1/projects                          list for a workspace
 *   POST   /api/v1/projects                          create            (admin)
 *   PATCH  /api/v1/projects/:id                      update            (admin)
 *   DELETE /api/v1/projects/:id                      delete            (admin)
 *   GET    /api/v1/projects/:id/keywords             tracking table
 *   POST   /api/v1/projects/:id/keywords             bulk add + check now
 *   DELETE /api/v1/projects/:id/keywords             bulk remove
 *   POST   /api/v1/projects/:id/keywords/check-now   re-check           (admin)
 *   .../:id/audits                                   mounted from audits.ts
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
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { projects, trackedKeywords } from "../../db";
import type {
  ProjectDeletedResponse,
  ProjectMutationResponse,
} from "../../shared/projects";
import {
  createProjectSchema,
  updateProjectSchema,
} from "../../shared/projects";
import type {
  RankCheckEnqueuedResponse,
  TrackedKeywordsAddedResponse,
  TrackedKeywordsRemovedResponse,
} from "../../shared/tracking";
import {
  addTrackedKeywordsSchema,
  RANK_CHECK_COST_PER_KEYWORD_USD,
  removeTrackedKeywordsSchema,
} from "../../shared/tracking";
import { ApiException } from "../http";
import { enqueueJob } from "../jobs";
import { deleteProjectEverywhere } from "../lib/deletion";
import { projectAuditsRouter } from "./audits";
import { authorizeWorkspace, normalizeDomain, workspaceParam } from "../lib/research";
import { readJson, readParams, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import {
  countKeywords,
  keywordCounts,
  lastCheckedAtByProject,
  listProjects,
  projectColumns,
  requireProject,
  toProject,
  trackedKeywordsForProject,
} from "../services/projects";
import type { AppEnv } from "../types";

const projectsRouter = new Hono<AppEnv>();

projectsRouter.use("*", requireSession);

/**
 * Site Audit's project-scoped half — `GET`/`POST /projects/:id/audits`.
 *
 * Mounted rather than defined here so every audit route lives in one file, and
 * mounted *before* the `/:id`-shaped routes below because Hono matches in
 * registration order: a bare `/:id` pattern registered first would swallow
 * `/:id/audits`. The sub-router reads the `:id` this pattern captures.
 */
projectsRouter.route("/:id/audits", projectAuditsRouter);

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
  return c.json(await listProjects(db, workspace));
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

  // tracked_keywords → rank_snapshots, audits, ai_prompts and gsc_connections
  // all cascade from this FK (see db/schema.ts), so the children go with it.
  // Queued jobs carry `workspace_id` and cascade from the workspace, not the
  // project, so a rank_post for a deleted project can still be claimed — both
  // rank handlers treat a missing project as "nothing to do" rather than an
  // error.
  //
  // What the cascade cannot reach is the Google OAuth grant behind
  // `gsc_connections`, the project's KV keys, and every audit's crawl blobs in
  // R2 — which is why this goes through the deletion module rather than
  // deleting the row here. Dropping the row first would destroy the only copy
  // of the refresh token that could revoke the grant, and the audit ids that
  // name the blobs. All three cleanups are best-effort and none can block the
  // delete.
  await deleteProjectEverywhere(
    { db, kv: c.env.CACHE, r2: c.env.BLOBS, masterKey: c.env.APP_MASTER_KEY },
    workspace,
    id,
  );

  const body: ProjectDeletedResponse = { deleted: true, id };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Tracked keywords                                                            */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/projects/:id/keywords
 *
 * The body lives in `../services/projects` because `tracked_keywords` is also
 * an MCP tool and both callers must produce the same table.
 */
projectsRouter.get("/:id/keywords", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  return c.json(await trackedKeywordsForProject(db, workspace, id));
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
    estimatedCostUsd: roundUsd(keywordCount * RANK_CHECK_COST_PER_KEYWORD_USD),
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

/**
 * Six decimal places — enough for a single keyword at a fraction of a cent,
 * and enough to stop binary floating point putting `0.018000000000000002` in
 * an API response. 3 × $0.006 should read as $0.018.
 */
function roundUsd(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
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
