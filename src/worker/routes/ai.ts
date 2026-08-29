/**
 * AI Visibility — `/api/v1/projects/:id/ai/*`.
 *
 * Mounted on the `/projects` prefix from the registry rather than as a
 * sub-router of routes/projects.ts, so this module is one file with one owner.
 * Hono matches both routers under the same prefix; the paths below carry the
 * `:id/ai/` segment themselves.
 *
 * Roles follow docs/specs/PHASE6.md: a `member` reads prompts and results, an
 * `admin` creates, edits, deletes and runs — because everything in the second
 * group either spends money now or commits the workspace to spending it every
 * week.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../db";
import { aiPrompts, aiSnapshots, projects } from "../../db";
import type {
  AiCitation,
  AiEngineId,
  AiEngineStatus,
  AiEngineTimeline,
  AiPrompt,
  AiPromptDeletedResponse,
  AiPromptListResponse,
  AiPromptMutationResponse,
  AiRatePoint,
  AiResultsResponse,
  AiRunEnqueuedResponse,
  AiSnapshot,
  AiSnapshotDetail,
} from "../../shared/ai";
import {
  AI_PROMPTS_MAX_PER_PROJECT,
  AI_RESULTS_DEFAULT_DAYS,
  AI_RUN_WINDOW_SECONDS,
  aiResultsQuerySchema,
  createAiPromptSchema,
  estimateRunCostUsd,
  rate,
  readEngines,
  updateAiPromptSchema,
} from "../../shared/ai";
import { shiftIsoDate, toIsoDate } from "../../shared/tracking";
import { matchAnswer } from "../ai/matcher";
import { ApiException } from "../http";
import { enqueueJob, queuedPromptIds } from "../jobs";
import { authorizeWorkspace, workspaceParam } from "../lib/research";
import { readJson, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const aiRouter = new Hono<AppEnv>();

/**
 * Everything here is tenant data and the mutations spend money, so the 401
 * lands before validation — an anonymous caller never learns whether their
 * query was well-formed. Same rule as every other module.
 */
aiRouter.use("*", requireSession);

const workspaceQuerySchema = z.object({ workspace: workspaceParam });

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/projects/:id/ai/prompts
 *
 * The prompts manager in two queries: the prompts, and the newest snapshot per
 * prompt × engine. The second is a window function rather than a per-prompt
 * lookup, for the same reason the tracking table uses one.
 */
aiRouter.get("/:id/ai/prompts", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const projectId = requireProjectIdParam(c.req.param("id"));
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const project = await requireProject(db, workspace, projectId);
  const rows = await loadPrompts(db, projectId);
  const latest = await loadLatestByPromptEngine(db, projectId);
  const inFlight = await queuedPromptIds(db);

  const prompts = rows.map((row) => toPrompt(row, latest));

  const body: AiPromptListResponse = {
    projectId: project.id,
    domain: project.domain,
    prompts,
    runInProgress: rows.some((row) => inFlight.has(row.id)),
  };
  return c.json(body);
});

/**
 * POST /api/v1/projects/:id/ai/prompts
 *
 * Creating a prompt enqueues its first run, so a new prompt has data within
 * minutes rather than at next Monday's seed — the same bargain "add tracked
 * keywords" makes, and the reason a prompt is not born empty.
 *
 * It deliberately does **not** consume the run-now rate limit: that limiter
 * guards a button someone can hold down, whereas adding a prompt is already
 * bounded by `AI_PROMPTS_MAX_PER_PROJECT`.
 */
aiRouter.post("/:id/ai/prompts", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const projectId = requireProjectIdParam(c.req.param("id"));
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");
  const input = await readJson(c, createAiPromptSchema);

  await requireProject(db, workspace, projectId);

  const [{ total = 0 } = {}] = await db
    .select({ total: sql<number>`count(*)` })
    .from(aiPrompts)
    .where(eq(aiPrompts.projectId, projectId));

  if (Number(total) >= AI_PROMPTS_MAX_PER_PROJECT) {
    throw new ApiException(
      "conflict",
      `A project may track ${AI_PROMPTS_MAX_PER_PROJECT} prompts; remove one before adding another.`,
    );
  }

  const id = crypto.randomUUID();
  await db.insert(aiPrompts).values({
    id,
    projectId,
    prompt: input.prompt,
    enginesJson: input.engines,
  });

  await enqueueJob(db, {
    type: "ai_run",
    workspaceId: workspace,
    payload: { promptId: id, projectId },
  });

  const [row] = await loadPrompts(db, projectId, id);
  if (row === undefined) throw new ApiException("internal_error", "Prompt vanished.");

  const body: AiPromptMutationResponse = {
    prompt: toPrompt(row, new Map()),
    runEnqueued: true,
  };
  return c.json(body, 201);
});

/**
 * PATCH /api/v1/projects/:id/ai/prompts/:promptId
 *
 * Editing does not re-run: the existing snapshots stay, and the next scheduled
 * or manual run answers the new wording. Silently re-buying answers because
 * someone fixed a typo is not a surprise anyone wants on an invoice.
 */
aiRouter.patch("/:id/ai/prompts/:promptId", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const projectId = requireProjectIdParam(c.req.param("id"));
  const promptId = requireProjectIdParam(c.req.param("promptId"));
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");
  const input = await readJson(c, updateAiPromptSchema);

  await requireProject(db, workspace, projectId);
  await requirePrompt(db, projectId, promptId);

  await db
    .update(aiPrompts)
    .set({
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.engines === undefined ? {} : { enginesJson: input.engines }),
    })
    .where(eq(aiPrompts.id, promptId));

  const [row] = await loadPrompts(db, projectId, promptId);
  if (row === undefined) throw new ApiException("not_found", "No such prompt.");
  const latest = await loadLatestByPromptEngine(db, projectId);

  const body: AiPromptMutationResponse = {
    prompt: toPrompt(row, latest),
    runEnqueued: false,
  };
  return c.json(body);
});

/**
 * DELETE /api/v1/projects/:id/ai/prompts/:promptId
 *
 * Snapshots cascade with the row (FK), and their R2 archives are collected by
 * the workspace sweep — the prefix `ws:<id>/ai/` is inside `ws:<id>/`.
 */
aiRouter.delete("/:id/ai/prompts/:promptId", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const projectId = requireProjectIdParam(c.req.param("id"));
  const promptId = requireProjectIdParam(c.req.param("promptId"));
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");

  await requireProject(db, workspace, projectId);
  await requirePrompt(db, projectId, promptId);

  await db.delete(aiPrompts).where(eq(aiPrompts.id, promptId));

  const body: AiPromptDeletedResponse = { deleted: true, id: promptId };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Results                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/projects/:id/ai/results?from&to
 *
 * Everything the Results view renders, in one payload: a per-engine
 * mention/citation rate timeline over the window, plus the newest run per
 * prompt × engine with its excerpt and citations for the table and its
 * drill-down.
 *
 * The excerpt is why the drill-down needs no second request and no R2 read —
 * the full answer is in R2 for archival, but the part worth showing is already
 * in D1.
 */
aiRouter.get("/:id/ai/results", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { from, to } = readQuery(c, aiResultsQuerySchema);
  const projectId = requireProjectIdParam(c.req.param("id"));
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const project = await requireProject(db, workspace, projectId);

  const today = toIsoDate(new Date());
  const toDate = to ?? today;
  const fromDate = from ?? shiftIsoDate(toDate, -AI_RESULTS_DEFAULT_DAYS) ?? toDate;
  if (fromDate > toDate) {
    throw new ApiException("validation_failed", "`from` must not be after `to`.");
  }

  const promptRows = await loadPrompts(db, projectId);
  const promptIds = promptRows.map((row) => row.id);

  const timelines =
    promptIds.length === 0
      ? []
      : await loadTimelines(db, promptIds, fromDate, toDate);

  const latest =
    promptIds.length === 0
      ? []
      : await loadLatestDetail(db, projectId, project.domain, fromDate, toDate);

  const body: AiResultsResponse = {
    projectId: project.id,
    domain: project.domain,
    from: fromDate,
    to: toDate,
    timelines,
    latest,
    prompts: promptRows.map((row) => ({
      id: row.id,
      prompt: row.prompt,
      engines: readEngines(row.enginesJson),
    })),
  };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Run now                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/v1/projects/:id/ai/run
 *
 * Enqueues one `ai_run` per prompt and answers 202 with an estimate.
 *
 * **The estimate is an estimate**, and the response says so by carrying a
 * separate real figure once runs land. This family's price is DataForSEO's fee
 * plus whatever the LLM provider charged for tokens and web search, which is
 * not knowable until the answer exists — see src/shared/ai.ts. The number here
 * is good enough to stop someone spending dollars by accident, which is what a
 * cost hint is for.
 *
 * Rate-limited to one run per project per hour, in KV, keyed under
 * `ws:<workspaceId>:` so the deletion sweep reaches it. Eventually consistent,
 * so a deterrent rather than a lock — the same trade as check-now, and
 * acceptable for the same reason (no Durable Objects on the free plan).
 */
aiRouter.post("/:id/ai/run", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const projectId = requireProjectIdParam(c.req.param("id"));
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");

  await requireProject(db, workspace, projectId);

  const rows = await loadPrompts(db, projectId);
  if (rows.length === 0) {
    throw new ApiException(
      "conflict",
      "This project has no AI prompts to run. Add one first.",
    );
  }

  const key = aiRunKey(workspace, projectId);
  const existing = await c.env.CACHE.get(key);
  if (existing !== null) {
    const until = Number.parseInt(existing, 10);
    throw new ApiException(
      "rate_limited",
      "This project's prompts were run within the last hour. AI answers change slowly and each run costs money; try again later.",
      {
        nextAllowedAt: Number.isFinite(until)
          ? new Date(until).toISOString()
          : null,
      },
    );
  }

  const nextAllowedAt = new Date(Date.now() + AI_RUN_WINDOW_SECONDS * 1000);
  await c.env.CACHE.put(key, String(nextAllowedAt.getTime()), {
    expirationTtl: AI_RUN_WINDOW_SECONDS,
  });

  let callCount = 0;
  let estimatedCostUsd = 0;
  for (const row of rows) {
    const engines = readEngines(row.enginesJson);
    if (engines.length === 0) continue;
    callCount += engines.length;
    estimatedCostUsd += estimateRunCostUsd(engines);
    await enqueueJob(db, {
      type: "ai_run",
      workspaceId: workspace,
      payload: { promptId: row.id, projectId },
    });
  }

  const body: AiRunEnqueuedResponse = {
    enqueued: true,
    promptCount: rows.length,
    callCount,
    estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
    nextAllowedAt: nextAllowedAt.toISOString(),
  };
  return c.json(body, 202);
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * KV key for the run-now limiter.
 *
 * Prefixed `ws:<workspaceId>:` because CLAUDE.md hard rule #6 requires every KV
 * key holding workspace data to be reachable by the deletion sweep.
 */
export function aiRunKey(workspaceId: string, projectId: string): string {
  return `ws:${workspaceId}:rl:ai-run:${projectId}`;
}

interface PromptRow {
  id: string;
  prompt: string;
  enginesJson: unknown;
  createdAt: Date;
}

async function loadPrompts(
  db: Db,
  projectId: string,
  promptId?: string,
): Promise<PromptRow[]> {
  return db
    .select({
      id: aiPrompts.id,
      prompt: aiPrompts.prompt,
      enginesJson: aiPrompts.enginesJson,
      createdAt: aiPrompts.createdAt,
    })
    .from(aiPrompts)
    .where(
      promptId === undefined
        ? eq(aiPrompts.projectId, projectId)
        : and(eq(aiPrompts.projectId, projectId), eq(aiPrompts.id, promptId)),
    )
    .orderBy(aiPrompts.createdAt, aiPrompts.id);
}

/** The newest snapshot per prompt × engine, keyed `<promptId> <engine>`. */
type LatestMap = Map<string, AiSnapshot>;

function latestKey(promptId: string, engine: string): string {
  return `${promptId} ${engine}`;
}

async function loadLatestByPromptEngine(
  db: Db,
  projectId: string,
): Promise<LatestMap> {
  const rows = await db.all<SnapshotSqlRow>(sql`
    SELECT id, prompt_id, engine, date, mentioned, cited, citations_json,
           response_excerpt, model, cost_usd, created_at
      FROM (
        SELECT s.*,
               ROW_NUMBER() OVER (
                 PARTITION BY s.prompt_id, s.engine ORDER BY s.date DESC
               ) AS rn
          FROM ai_snapshots s
         WHERE s.prompt_id IN (
                 SELECT id FROM ai_prompts WHERE project_id = ${projectId}
               )
      )
     WHERE rn = 1
  `);

  const out: LatestMap = new Map();
  for (const row of rows) {
    const snapshot = toSnapshot(row);
    if (snapshot === null) continue;
    out.set(latestKey(row.prompt_id, row.engine), snapshot);
  }
  return out;
}

/**
 * The newest run per prompt × engine inside the window, with excerpts.
 *
 * `mentionTerms` is recomputed from the stored excerpt rather than persisted:
 * it is a presentation detail that follows the matcher, so a matcher
 * improvement should light up old rows rather than require a backfill.
 */
async function loadLatestDetail(
  db: Db,
  projectId: string,
  domain: string,
  from: string,
  to: string,
): Promise<AiSnapshotDetail[]> {
  const rows = await db.all<SnapshotSqlRow>(sql`
    SELECT id, prompt_id, engine, date, mentioned, cited, citations_json,
           response_excerpt, model, cost_usd, created_at
      FROM (
        SELECT s.*,
               ROW_NUMBER() OVER (
                 PARTITION BY s.prompt_id, s.engine ORDER BY s.date DESC
               ) AS rn
          FROM ai_snapshots s
         WHERE s.prompt_id IN (
                 SELECT id FROM ai_prompts WHERE project_id = ${projectId}
               )
           AND s.date >= ${from} AND s.date <= ${to}
      )
     WHERE rn = 1
     ORDER BY date DESC, prompt_id ASC, engine ASC
  `);

  const out: AiSnapshotDetail[] = [];
  for (const row of rows) {
    const snapshot = toSnapshot(row);
    if (snapshot === null) continue;
    const excerpt = row.response_excerpt ?? "";
    out.push({
      ...snapshot,
      responseExcerpt: excerpt,
      mentionTerms: matchAnswer({
        domain,
        answerText: excerpt,
        citationUrls: [],
      }).mentionTerms,
    });
  }
  return out;
}

/** Per-engine daily rates over the window, in one grouped query. */
async function loadTimelines(
  db: Db,
  promptIds: readonly string[],
  from: string,
  to: string,
): Promise<AiEngineTimeline[]> {
  const rows = await db
    .select({
      engine: aiSnapshots.engine,
      date: aiSnapshots.date,
      runs: sql<number>`count(*)`,
      mentions: sql<number>`sum(${aiSnapshots.mentioned})`,
      citations: sql<number>`sum(${aiSnapshots.cited})`,
    })
    .from(aiSnapshots)
    .where(
      and(
        inArray(aiSnapshots.promptId, [...promptIds]),
        gte(aiSnapshots.date, from),
        lte(aiSnapshots.date, to),
      ),
    )
    .groupBy(aiSnapshots.engine, aiSnapshots.date)
    .orderBy(aiSnapshots.engine, aiSnapshots.date);

  const byEngine = new Map<string, AiRatePoint[]>();
  const totals = new Map<string, { runs: number; mentions: number; cites: number }>();

  for (const row of rows) {
    const runs = Number(row.runs ?? 0);
    const mentions = Number(row.mentions ?? 0);
    const citations = Number(row.citations ?? 0);

    const points = byEngine.get(row.engine) ?? [];
    points.push({
      date: row.date,
      runs,
      mentions,
      citations,
      mentionRate: rate(mentions, runs),
      citationRate: rate(citations, runs),
    });
    byEngine.set(row.engine, points);

    const total = totals.get(row.engine) ?? { runs: 0, mentions: 0, cites: 0 };
    total.runs += runs;
    total.mentions += mentions;
    total.cites += citations;
    totals.set(row.engine, total);
  }

  const out: AiEngineTimeline[] = [];
  for (const [engine, points] of byEngine) {
    const total = totals.get(engine) ?? { runs: 0, mentions: 0, cites: 0 };
    out.push({
      engine: engine as AiEngineId,
      points,
      mentionRate: rate(total.mentions, total.runs),
      citationRate: rate(total.cites, total.runs),
    });
  }
  return out;
}

interface SnapshotSqlRow {
  id: string;
  prompt_id: string;
  engine: string;
  date: string;
  mentioned: number;
  cited: number;
  citations_json: string | null;
  response_excerpt: string | null;
  model: string | null;
  cost_usd: number | null;
  created_at: number;
}

/**
 * A raw row to the shared shape, or null when the engine is one we no longer
 * support.
 *
 * Dropping rather than rendering an unknown engine keeps a retired engine's
 * history from appearing as an unlabelled series in a chart; the rows stay in
 * D1, and re-adding the engine brings them back.
 */
function toSnapshot(row: SnapshotSqlRow): AiSnapshot | null {
  const [engine] = readEngines([row.engine]);
  if (engine === undefined) return null;

  const citations = parseCitations(row.citations_json);
  return {
    id: row.id,
    promptId: row.prompt_id,
    engine,
    date: row.date,
    mentioned: row.mentioned === 1,
    cited: row.cited === 1,
    citations,
    citedUrls: citations.filter((c) => c.ours).map((c) => c.url),
    model: row.model,
    costUsd: row.cost_usd ?? 0,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * `citations_json` comes back as text from a raw query (Drizzle's json mode
 * only applies to its own column mappings), so it is parsed here — defensively,
 * because a malformed value should cost one row its citation list rather than
 * the whole results page.
 */
function parseCitations(raw: string | null): AiCitation[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: AiCitation[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      if (typeof record["url"] !== "string") continue;
      out.push({
        url: record["url"],
        title: typeof record["title"] === "string" ? record["title"] : null,
        host: typeof record["host"] === "string" ? record["host"] : null,
        ours: record["ours"] === true,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function toPrompt(row: PromptRow, latest: LatestMap): AiPrompt {
  const engines = readEngines(row.enginesJson);

  const statuses: AiEngineStatus[] = engines.map((engine) => {
    const snapshot = latest.get(latestKey(row.id, engine));
    return {
      engine,
      lastRunDate: snapshot?.date ?? null,
      mentioned: snapshot?.mentioned ?? null,
      cited: snapshot?.cited ?? null,
      citationCount: snapshot?.citations.length ?? 0,
    };
  });

  const dates = statuses
    .map((status) => status.lastRunDate)
    .filter((date): date is string => date !== null)
    .sort();
  const lastRunDate = dates.at(-1) ?? null;

  return {
    id: row.id,
    prompt: row.prompt,
    engines,
    createdAt: row.createdAt.toISOString(),
    // A date widened to a timestamp at the boundary: snapshots are day-grained
    // by design, so this is that day at UTC midnight, not a fake wall clock.
    lastRunAt: lastRunDate === null ? null : `${lastRunDate}T00:00:00.000Z`,
    statuses,
  };
}

/** The project, scoped to the workspace. */
async function requireProject(
  db: Db,
  workspaceId: string,
  projectId: string,
): Promise<{ id: string; domain: string; locationCode: number }> {
  const [row] = await db
    .select({
      id: projects.id,
      domain: projects.domain,
      locationCode: projects.locationCode,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);

  if (row === undefined) throw new ApiException("not_found", "No such project.");
  return row;
}

/**
 * The prompt, proved to belong to this project.
 *
 * `ai_prompts` has no workspace column, so a prompt id alone says nothing
 * about who may touch it — filtering on `project_id`, after the project itself
 * has been scoped to the workspace, is what makes another tenant's prompt a
 * 404 rather than an edit.
 */
async function requirePrompt(
  db: Db,
  projectId: string,
  promptId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: aiPrompts.id })
    .from(aiPrompts)
    .where(and(eq(aiPrompts.id, promptId), eq(aiPrompts.projectId, projectId)))
    .limit(1);

  if (row === undefined) throw new ApiException("not_found", "No such prompt.");
}

/**
 * The `:id` path parameter, which this router does not own — it comes from the
 * mount point it shares with routes/projects.ts, so it is checked rather than
 * schema-validated, exactly as the audits sub-router does.
 */
function requireProjectIdParam(id: string | undefined): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new ApiException("not_found", "No such project.");
  }
  return id;
}

export default aiRouter;
