/**
 *   GET /api/v1/gap/keywords             labs domain_intersection (fanned out)
 *   GET /api/v1/gap/keywords/export.csv  the same query, as an attachment
 *   GET /api/v1/gap/pages                labs page_intersection
 *
 * Workspace-scoped with the same guard as routes/keywords.ts. Responses are
 * the shared types in src/shared/gap.ts.
 *
 * The handlers are deliberately thin. What `/gap/keywords` *does* — the
 * pairwise fan-out, the merge, the mode filter, and the notes explaining all
 * three — lives in `../services/gap`, because it is an MCP tool as well as an
 * endpoint and both callers must produce identical bodies. This file owns the
 * query schemas, the session guard, the workspace proof and the CSV shape.
 */
import { Hono } from "hono";
import { z } from "zod";

import type {
  GapKeywordRow,
  GapPageRow,
  GapPagesResponse,
} from "../../shared/gap";
import {
  GAP_MAX_COMPETITORS,
  GAP_MAX_PAGES,
  GAP_MODES,
} from "../../shared/gap";
import { PAGE_INTERSECTION_MODES, createDataForSeoApi } from "../dataforseo";
import { fetchedAtIso } from "../dataforseo/schema";
import { attachmentHeader, slugify, toCsv } from "../lib/csv";
import {
  authorizeWorkspace,
  domainParam,
  freshnessShape,
  marketQuerySchema,
  normalizeDomain,
  pagingQuerySchema,
  rangeQuerySchema,
  toFreshness,
  withFreshness,
} from "../lib/research";
import { readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import { historyContext, recordSearch } from "../services/history";
import {
  BY_VOLUME_DESC,
  ORGANIC_ONLY,
  fetchGapKeywords,
  gapKeywordFilters,
  gapKeywords,
  toGapPosition,
} from "../services/gap";
import type { AppEnv } from "../types";

/*
 * Re-exported, not redefined: `/gap/pages` and the CSV export share these with
 * `/gap/keywords`, and the tests reach for them here. There is exactly one
 * definition of each, in ../services/gap.
 */
export {
  competitorOutranksFilter,
  gapKeywordFilters,
  matchesGapMode,
  mergeGapRows,
  upstreamQueriesForMode,
} from "../services/gap";
export type { GapFetch } from "../services/gap";

const gap = new Hono<AppEnv>();

gap.use("*", requireSession);

/**
 * How many rows one CSV export may contain.
 *
 * The export makes exactly the same upstream calls as the table — one window
 * per competitor, at this limit — so clicking Export costs the same as loading
 * one page, never a runaway multiple of it. 1000 is DataForSEO's own per-call
 * ceiling and comfortably more than a spreadsheet needs.
 */
export const GAP_CSV_MAX_ROWS = 1000;

/** `?competitors=a.com,b.com` → normalised, de-duplicated hostnames. */
const competitorsParam = z
  .string()
  .trim()
  .min(1, "Give at least one competitor domain.")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => normalizeDomain(entry))
      .filter((entry) => entry.length > 0),
  )
  .refine((list) => list.length > 0, "Give at least one competitor domain.")
  .refine(
    (list) => list.length <= GAP_MAX_COMPETITORS,
    `At most ${GAP_MAX_COMPETITORS} competitors per request.`,
  )
  .refine(
    (list) => list.every((entry) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(entry)),
    "Each competitor must be a hostname, e.g. 'example.com'.",
  );

const gapKeywordsQuerySchema = marketQuerySchema
  .extend({
    target: domainParam,
    competitors: competitorsParam,
    mode: z.enum(GAP_MODES).optional().default("missing"),
  })
  .extend(freshnessShape)
  .extend(pagingQuerySchema.shape)
  .extend(rangeQuerySchema.shape)
  .extend({
    include: z.string().trim().min(1).optional(),
    exclude: z.string().trim().min(1).optional(),
  });

const gapPagesQuerySchema = marketQuerySchema
  .extend({
    /** Absolute URLs, comma-separated. Wildcards (`/*`) are passed through. */
    pages: z
      .string()
      .trim()
      .min(1)
      .transform((value) =>
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      )
      .refine((list) => list.length > 0, "Give at least one page URL.")
      .refine(
        (list) => list.length <= GAP_MAX_PAGES,
        `At most ${GAP_MAX_PAGES} pages per request.`,
      ),
    excludePages: z
      .string()
      .trim()
      .optional()
      .transform((value) =>
        value === undefined
          ? undefined
          : value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
      ),
    intersectionMode: z.enum(PAGE_INTERSECTION_MODES).optional(),
  })
  .extend(freshnessShape)
  .extend(pagingQuerySchema.shape)
  .extend(rangeQuerySchema.shape)
  .extend({
    include: z.string().trim().min(1).optional(),
    exclude: z.string().trim().min(1).optional(),
  });

/**
 * GET /api/v1/gap/keywords
 *
 * Records history; `/gap/pages` deliberately does not. Pages compares a list of
 * URLs rather than a target against competitors — different inputs, a different
 * question, and nothing a keyword-gap trail row could re-run.
 */
gap.get("/keywords", async (c) => {
  const query = readQuery(c, withFreshness(gapKeywordsQuerySchema));
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const body = await gapKeywords(c.env, db, query);

  recordSearch(
    historyContext(c, db),
    query.workspace,
    "gap",
    {
      target: query.target,
      // The service's list, not the caller's: de-duplicated and with the
      // target itself removed, which is the comparison that actually ran and
      // the column order the row must reproduce.
      competitors: body.competitors,
      location: query.location,
      language: query.language,
      // `mode` is excluded on purpose — see GapHistoryParams. It selects a view
      // over rows this query already covers, so switching modes is not a new
      // search and must not be a second trail row.
    },
    {
      // Before the mode filter, which is what makes the number comparable
      // between a row saved in `missing` and the same search seen in `all`.
      keywordCount: (body.itemsCount ?? body.items.length) + body.filteredOut,
      competitorCount: body.competitors.length,
    },
  );

  return c.json(body);
});

/**
 * GET /api/v1/gap/keywords/export.csv
 *
 * Same query parameters as `/gap/keywords`, so a table's current filter and
 * mode export exactly what is on screen — except `limit`, which is raised to
 * `GAP_CSV_MAX_ROWS` because a spreadsheet is not paged.
 */
gap.get("/keywords/export.csv", async (c) => {
  const query = readQuery(c, withFreshness(gapKeywordsQuerySchema));
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  // The same fan-out `/gap/keywords` runs, one level below the response
  // envelope: the rows are all this needs, and the page size is its own.
  const result = await fetchGapKeywords(c.env, db, query, GAP_CSV_MAX_ROWS);

  const csv = toCsv(
    gapCsvHeader(result.competitors),
    result.rows.map((row) => gapCsvRow(row)),
  );

  const filename = `${slugify(`${query.target}-gap-${query.mode}`, "gap")}.csv`;
  return c.body(csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": attachmentHeader(filename),
    // An export is a point-in-time snapshot; a cached one is a wrong one.
    "cache-control": "no-store",
  });
});

/** Column order for the CSV, with one position column per competitor. */
export function gapCsvHeader(competitors: readonly string[]): string[] {
  return [
    "keyword",
    "search_volume",
    "keyword_difficulty",
    "cpc",
    "intent",
    "your_position",
    ...competitors.map((domain) => `${domain}_position`),
    "best_competitor_traffic",
  ];
}

/**
 * One CSV row. A domain that does not rank exports as an empty cell rather
 * than a 0 — the same distinction the table draws with a dash, and the one
 * that would otherwise turn "absent" into "position zero" in a spreadsheet.
 */
export function gapCsvRow(row: GapKeywordRow): unknown[] {
  return [
    row.keyword,
    row.searchVolume,
    row.keywordDifficulty,
    row.cpc,
    row.intent,
    row.target.position,
    ...row.competitors.map((competitor) => competitor.position),
    row.bestCompetitorTraffic,
  ];
}

/**
 * GET /api/v1/gap/pages
 *
 * page_intersection compares up to 20 **URLs** rather than domains, and has no
 * "you" — every page is one of the compared set — so it carries no mode.
 */
gap.get("/pages", async (c) => {
  const query = readQuery(c, withFreshness(gapPagesQuerySchema));
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.labs.googlePageIntersectionLive({
    pages: query.pages,
    excludePages: query.excludePages,
    intersectionMode: query.intersectionMode,
    locationCode: query.location,
    languageCode: query.language,
    itemTypes: [...ORGANIC_ONLY],
    limit: query.limit,
    offset: query.offset,
    filters: gapKeywordFilters(query),
    sorts: BY_VOLUME_DESC,
    ...toFreshness(query),
  });

  const items: GapPageRow[] = result.items.map((row) => ({
    keyword: row.keyword?.keyword ?? "",
    searchVolume: row.keyword?.metrics.searchVolume ?? null,
    cpc: row.keyword?.metrics.cpc ?? null,
    competition: row.keyword?.metrics.competition ?? null,
    competitionLevel: row.keyword?.metrics.competitionLevel ?? null,
    keywordDifficulty: row.keyword?.keywordDifficulty ?? null,
    intent: row.keyword?.mainIntent ?? null,
    // Positioned like the `pages` that were requested, so column N is page N.
    pages: row.pages.map((element, index) =>
      toGapPosition(query.pages[index] ?? "", element),
    ),
  }));

  const body: GapPagesResponse = {
    pages: query.pages,
    locationCode: query.location,
    languageCode: query.language,
    items,
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
    stale: result.stale ?? false,
    fetchedAt: fetchedAtIso(result),
  };
  return c.json(body);
});

export default gap;
