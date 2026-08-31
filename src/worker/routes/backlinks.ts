/**
 *   GET  /api/v1/backlinks/summary            backlinks summary
 *   GET  /api/v1/backlinks/list               backlinks backlinks (paged)
 *   GET  /api/v1/backlinks/referring-domains  backlinks referring_domains
 *   GET  /api/v1/backlinks/anchors            backlinks anchors
 *   GET  /api/v1/backlinks/history            backlinks history (monthly)
 *   POST /api/v1/backlinks/scores             backlinks bulk_ranks
 *
 * Every route is workspace-scoped and proves membership before it spends, the
 * same guard as routes/keywords.ts. Responses are the shared types in
 * src/shared/backlinks.ts.
 *
 * **No location or language anywhere in this module.** A link profile is a
 * property of the web, not of a market, and none of these endpoints accepts a
 * `location_code`. That is why the queries here extend `workspaceParam`
 * directly rather than `marketQuerySchema`.
 *
 * Authority is published as Domain Score / Page Score (0–100). The provider's
 * 0–1000 rank is converted inside the wrapper and appears in exactly one place
 * outward-facing: as the `>=` bound of a min-score filter, built with
 * `fromScore`.
 */
import { Hono } from "hono";
import { z } from "zod";

import type {
  AnchorsResponse,
  BacklinksHistoryResponse,
  BacklinksListMode,
  BacklinksListResponse,
  BacklinksScoresResponse,
  ReferringDomainsResponse,
} from "../../shared/backlinks";
import {
  BACKLINKS_HISTORY_MIN_DATE,
  BACKLINKS_LIST_MODES,
  BACKLINKS_SCORES_MAX_TARGETS,
} from "../../shared/backlinks";
import { createDataForSeoApi } from "../dataforseo";
import {
  BACKLINKS_FIELDS,
  REFERRING_FIELDS,
  containsFilter,
  fromScore,
} from "../dataforseo";
import type { LabsFilter, LabsSort } from "../dataforseo/filters";
import { ApiException } from "../http";
import {
  authorizeWorkspace,
  booleanParam,
  pagingQuerySchema,
  workspaceParam,
} from "../lib/research";
import { readJson, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import { backlinksSummary } from "../services/backlinks";
import type { AppEnv } from "../types";

const backlinks = new Hono<AppEnv>();

backlinks.use("*", requireSession);

/**
 * A backlinks target: a bare domain, a subdomain, or an absolute page URL.
 *
 * Deliberately looser than `domainParam` in lib/research.ts, which flattens
 * everything to a hostname. These endpoints genuinely support page-level
 * queries ("who links to this one article"), so a URL must survive intact —
 * the wrapper's `normalizeBacklinksTarget` keeps a scheme when it sees one.
 */
const targetParam = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) =>
      /^https?:\/\/\S+$/i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(value),
    {
      message:
        "target must be a domain (example.com) or an absolute URL (https://example.com/page).",
    },
  );

const targetQuerySchema = z.object({
  workspace: workspaceParam,
  target: targetParam,
  fresh: booleanParam,
});

const listQuerySchema = targetQuerySchema
  .extend(pagingQuerySchema.shape)
  .extend({
    /** `one_per_domain` collapses a domain's links to one representative row. */
    mode: z.enum(BACKLINKS_LIST_MODES).optional().default("one_per_domain"),
    /** Only dofollow links. Absent means both. */
    dofollow: booleanParam,
    /** Substring the anchor text must contain. */
    anchor: z.string().trim().min(1).optional(),
    /** 0–100 Domain Score floor for the LINKING domain. */
    minDomainScore: z.coerce.number().min(0).max(100).optional(),
  });

const referringQuerySchema = targetQuerySchema
  .extend(pagingQuerySchema.shape)
  .extend({
    /** Substring the domain (or anchor) must contain. */
    include: z.string().trim().min(1).optional(),
    /** 0–100 Domain Score floor. */
    minDomainScore: z.coerce.number().min(0).max(100).optional(),
  });

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be yyyy-mm-dd.");

const historyQuerySchema = targetQuerySchema.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const scoresBodySchema = z.object({
  workspace: workspaceParam,
  targets: z
    .array(z.string().trim().min(1).max(2048))
    .min(1, "Give at least one target.")
    .max(
      BACKLINKS_SCORES_MAX_TARGETS,
      `At most ${BACKLINKS_SCORES_MAX_TARGETS} targets per request.`,
    ),
  fresh: z.boolean().optional(),
});

/** Sort orders. The provider documents no default, so we always send one. */
const BACKLINKS_BY_RANK: LabsSort[] = [
  { field: BACKLINKS_FIELDS.domainFromRank, direction: "desc" },
];
const REFERRING_BY_RANK: LabsSort[] = [
  { field: REFERRING_FIELDS.rank, direction: "desc" },
];
const ANCHORS_BY_BACKLINKS: LabsSort[] = [
  { field: REFERRING_FIELDS.backlinks, direction: "desc" },
];

/**
 * GET /api/v1/backlinks/summary
 *
 * The body lives in `../services/backlinks` because the MCP server exposes the
 * same thing as the `backlinks_summary` tool, and one mapper is what keeps the
 * two answers identical.
 */
backlinks.get("/summary", async (c) => {
  const query = readQuery(c, targetQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  return c.json(await backlinksSummary(c.env, db, query));
});

/**
 * GET /api/v1/backlinks/list
 *
 * Every filter here is server-side: the provider's filter syntax covers
 * `dofollow`, anchor text and the linking domain's rank, so a filtered table
 * costs one page of rows rather than a thousand rows narrowed locally.
 */
backlinks.get("/list", async (c) => {
  const query = readQuery(c, listQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const filters: LabsFilter[] = [];
  if (query.dofollow !== undefined) {
    filters.push({
      field: BACKLINKS_FIELDS.dofollow,
      operator: "=",
      value: query.dofollow,
    });
  }
  if (query.anchor) {
    filters.push(containsFilter(BACKLINKS_FIELDS.anchor, query.anchor));
  }
  if (query.minDomainScore !== undefined) {
    // The one place a raw rank leaves this codebase: the provider filters on
    // its own 0–1000 scale, so the user's 0–100 floor is converted here.
    filters.push({
      field: BACKLINKS_FIELDS.domainFromRank,
      operator: ">=",
      value: fromScore(query.minDomainScore),
    });
  }

  const result = await dfs.backlinks.backlinksLive({
    target: query.target,
    mode: query.mode,
    limit: query.limit,
    offset: query.offset,
    filters,
    sorts: BACKLINKS_BY_RANK,
    fresh: query.fresh,
  });

  const body: BacklinksListResponse = {
    target: result.target,
    // Echo what was asked for: the provider omits `mode` from some responses.
    mode: (result.mode as BacklinksListMode | null) ?? query.mode,
    items: result.items.map((row) => ({
      domainFrom: row.domainFrom,
      urlFrom: row.urlFrom,
      urlTo: row.urlTo,
      anchor: row.anchor,
      dofollow: row.dofollow,
      isBroken: row.isBroken,
      isNew: row.isNew,
      isLost: row.isLost,
      firstSeen: row.firstSeen,
      lastSeen: row.lastSeen,
      pageScore: row.pageScore,
      domainScore: row.domainScore,
      pageFromTitle: row.pageFromTitle,
      pageFromLanguage: row.pageFromLanguage,
      linksCount: row.linksCount,
      groupCount: row.groupCount,
      itemType: row.itemType,
      spamScore: row.spamScore,
    })),
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

backlinks.get("/referring-domains", async (c) => {
  const query = readQuery(c, referringQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const filters: LabsFilter[] = [];
  if (query.include) {
    filters.push(containsFilter(REFERRING_FIELDS.domain, query.include));
  }
  if (query.minDomainScore !== undefined) {
    filters.push({
      field: REFERRING_FIELDS.rank,
      operator: ">=",
      value: fromScore(query.minDomainScore),
    });
  }

  const result = await dfs.backlinks.referringDomainsLive({
    target: query.target,
    limit: query.limit,
    offset: query.offset,
    filters,
    sorts: REFERRING_BY_RANK,
    fresh: query.fresh,
  });

  const body: ReferringDomainsResponse = {
    target: result.target,
    items: result.items.map((row) => ({
      domain: row.domain,
      domainScore: row.domainScore,
      backlinks: row.backlinks,
      referringPages: row.referringPages,
      dofollow: row.dofollow,
      brokenBacklinks: row.brokenBacklinks,
      firstSeen: row.firstSeen,
      lostDate: row.lostDate,
      spamScore: row.spamScore,
    })),
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

backlinks.get("/anchors", async (c) => {
  const query = readQuery(c, referringQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const filters: LabsFilter[] = [];
  if (query.include) {
    filters.push(containsFilter(REFERRING_FIELDS.anchor, query.include));
  }
  if (query.minDomainScore !== undefined) {
    filters.push({
      field: REFERRING_FIELDS.rank,
      operator: ">=",
      value: fromScore(query.minDomainScore),
    });
  }

  const result = await dfs.backlinks.anchorsLive({
    target: query.target,
    limit: query.limit,
    offset: query.offset,
    filters,
    sorts: ANCHORS_BY_BACKLINKS,
    fresh: query.fresh,
  });

  const body: AnchorsResponse = {
    target: result.target,
    items: result.items.map((row) => ({
      anchor: row.anchor,
      score: row.score,
      backlinks: row.backlinks,
      referringDomains: row.referringDomains,
      referringPages: row.referringPages,
      dofollow: row.dofollow,
      brokenBacklinks: row.brokenBacklinks,
      firstSeen: row.firstSeen,
      lostDate: row.lostDate,
    })),
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

/**
 * The latest `to` DataForSEO accepts: yesterday, UTC.
 *
 * **Undocumented, found live (2026-08-29):** `date_to` must be *strictly
 * earlier than the present date*. Passing today — which is exactly what a
 * "last 12 months" range picker produces — fails the task with
 * `40501 Invalid Field: 'date_to - must be earlier than present date'`, after
 * being billed. Clamping is friendlier than refusing: the caller wants "up to
 * now", and the response echoes the range actually used.
 */
export function clampHistoryTo(
  to: string | undefined,
  now: Date,
): string | undefined {
  const latest = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  if (to === undefined) return undefined;
  return to > latest ? latest : to;
}

/**
 * GET /api/v1/backlinks/history?…&from&to
 *
 * A monthly series. `from` is validated against the provider's own index start
 * (2019-01-01) here rather than upstream, so an out-of-range date costs a 422
 * instead of a billed error; `to` is clamped for the same reason.
 */
backlinks.get("/history", async (c) => {
  const query = readQuery(c, historyQuerySchema);
  if (query.from && query.from < BACKLINKS_HISTORY_MIN_DATE) {
    throw new ApiException(
      "validation_failed",
      `Link history starts at ${BACKLINKS_HISTORY_MIN_DATE}.`,
    );
  }
  const dateTo = clampHistoryTo(query.to, new Date());
  if (query.from && dateTo && dateTo < query.from) {
    throw new ApiException("validation_failed", "`to` must not precede `from`.");
  }

  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.backlinks.historyLive({
    target: query.target,
    dateFrom: query.from,
    dateTo,
    fresh: query.fresh,
  });

  const body: BacklinksHistoryResponse = {
    target: result.target,
    dateFrom: result.dateFrom,
    dateTo: result.dateTo,
    // Oldest first, so the chart reads left to right. The provider does not
    // document an order, and a null period sorts last rather than crashing.
    items: [...result.items].sort((a, b) =>
      (a.period ?? "9999-99").localeCompare(b.period ?? "9999-99"),
    ),
    itemsCount: result.itemsCount,
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

/**
 * POST /api/v1/backlinks/scores  `{ workspace, targets: string[] }`
 *
 * POST rather than GET because a page of SERP domains does not fit in a query
 * string, and because the batch is the point: one call scores up to
 * `BACKLINKS_SCORES_MAX_TARGETS` domains for the SERP panel's Domain Score
 * column.
 */
backlinks.post("/scores", async (c) => {
  const body = await readJson(c, scoresBodySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), body.workspace);
  const dfs = await createDataForSeoApi(c.env, db, body.workspace);

  const result = await dfs.backlinks.bulkRanksLive({
    targets: body.targets,
    fresh: body.fresh,
  });

  const response: BacklinksScoresResponse = {
    // Order is the provider's, not the caller's — callers match by `target`.
    items: result.items.map((row) => ({
      target: row.target,
      domainScore: row.domainScore,
    })),
    itemsCount: result.itemsCount,
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(response);
});

export default backlinks;
