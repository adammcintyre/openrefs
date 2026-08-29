/**
 *   GET /api/v1/keywords/overview      labs keyword_overview (one call)
 *   GET /api/v1/keywords/ideas         labs keyword_ideas
 *   GET /api/v1/keywords/suggestions   labs keyword_suggestions
 *   GET /api/v1/keywords/related       labs related_keywords
 *   GET /api/v1/keywords/serp          serp google organic live advanced
 *
 * Every route is workspace-scoped and proves membership before it spends.
 * Responses are the shared types in src/shared/keywords.ts.
 */
import { Hono } from "hono";
import { z } from "zod";

import type {
  KeywordListResponse,
  KeywordOverviewResponse,
  KeywordRow,
  KeywordSerpResponse,
} from "../../shared/keywords";
import { createDataForSeoApi } from "../dataforseo";
import type { LabsKeywordRow } from "../dataforseo";
import {
  containsFilter,
  RELATED_KEYWORDS_MAX_DEPTH,
  toIsoMonth,
} from "../dataforseo";
import type { LabsFilter, LabsSort } from "../dataforseo/filters";
import { rangeFilters } from "../dataforseo/filters";
import { readQuery } from "../lib/validate";
import {
  authorizeWorkspace,
  booleanParam,
  marketQuerySchema,
  pagingQuerySchema,
  rangeQuerySchema,
} from "../lib/research";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const keywords = new Hono<AppEnv>();

keywords.use("*", requireSession);

/** How many months of history the overview chart shows. */
const HISTORY_MONTHS = 12;

const keywordQuerySchema = marketQuerySchema.extend({
  keyword: z.string().trim().min(1).max(700),
});

const listQuerySchema = keywordQuerySchema
  .extend({ fresh: booleanParam })
  .extend(pagingQuerySchema.shape)
  .extend(rangeQuerySchema.shape)
  .extend({
    /** Substring the keyword must contain / must not contain. */
    include: z.string().trim().min(1).optional(),
    exclude: z.string().trim().min(1).optional(),
  });

/**
 * Filters for the flat-row endpoints (ideas, suggestions). Field paths carry
 * no prefix here — related_keywords needs `keyword_data.` and gets its own set
 * below. Building them server-side is what stops the UI from fetching 1000
 * rows to display 50.
 */
function flatRowFilters(query: {
  minVolume?: number;
  maxVolume?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
  include?: string;
  exclude?: string;
}): LabsFilter[] {
  return [
    ...rangeFilters("keyword_info.search_volume", query.minVolume, query.maxVolume),
    ...rangeFilters(
      "keyword_properties.keyword_difficulty",
      query.minDifficulty,
      query.maxDifficulty,
    ),
    ...(query.include ? [containsFilter("keyword", query.include)] : []),
    ...(query.exclude ? [containsFilter("keyword", query.exclude, true)] : []),
  ];
}

/** The same set, prefixed for related_keywords' `keyword_data` nesting. */
function wrappedRowFilters(query: Parameters<typeof flatRowFilters>[0]): LabsFilter[] {
  return flatRowFilters(query).map((filter) => ({
    ...filter,
    field: `keyword_data.${filter.field}`,
  }));
}

const VOLUME_DESC_FLAT: LabsSort[] = [
  { field: "keyword_info.search_volume", direction: "desc" },
];
const VOLUME_DESC_WRAPPED: LabsSort[] = [
  { field: "keyword_data.keyword_info.search_volume", direction: "desc" },
];

/** One upstream row to one table row. */
function toKeywordRow(row: LabsKeywordRow): KeywordRow {
  return {
    keyword: row.keyword,
    searchVolume: row.metrics.searchVolume,
    cpc: row.metrics.cpc,
    competition: row.metrics.competition,
    competitionLevel: row.metrics.competitionLevel,
    keywordDifficulty: row.keywordDifficulty,
    intent: row.mainIntent,
  };
}

/**
 * GET /api/v1/keywords/overview
 *
 * ONE upstream call: `dataforseo_labs/google/keyword_overview/live` carries
 * volume, CPC, competition, the bid range, difficulty and intent together.
 *
 * It replaced a three-call composition (google_ads/search_volume +
 * bulk_keyword_difficulty + search_intent) that cost ≈ $0.114 a lookup and
 * whose search_volume leg was observed in production stalling past the
 * client's 60s timeout. The single call is ≈ $0.012 — roughly a tenth — and
 * has one failure mode instead of three, so nothing here needs the
 * partial-failure handling the fan-out did.
 *
 * The response contract is unchanged; two fields are honestly narrower:
 *
 *  - `intentProbability` is always null. This endpoint reports
 *    `search_intent_info.main_intent` as a bare label with no confidence
 *    figure — only `search_intent/live` carries one, and buying a second call
 *    for one decimal is not the trade the UI needs.
 *  - `secondaryIntents[].probability` is null for the same reason:
 *    `foreign_intent` is an array of plain label strings here.
 */
keywords.get("/overview", async (c) => {
  const query = readQuery(c, keywordQuerySchema.extend({ fresh: booleanParam }));
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const keyword = query.keyword.toLowerCase();

  const overview = await dfs.labs.googleKeywordOverviewLive({
    keywords: [keyword],
    locationCode: query.location,
    languageCode: query.language,
    fresh: query.fresh,
  });

  // A keyword their database does not know is OMITTED from `items` rather than
  // returned with null metrics, so `items` can be empty for a valid request.
  // Matching by keyword (not by index) is what keeps this correct if the
  // endpoint ever returns more than it was asked for.
  const row =
    overview.items.find((item) => item.keyword.toLowerCase() === keyword) ??
    overview.items[0] ??
    null;

  // DataForSEO returns monthly volumes NEWEST-first despite its docs (observed
  // live, 2026-08; the keyword_overview docs state no ordering at all). Sort
  // ascending before slicing so "the last N months" takes the most recent ones
  // and the shared type's oldest-first contract holds regardless of upstream
  // order.
  const monthly = [...(row?.metrics.monthlySearches ?? [])].sort(
    (a, b) =>
      (a.year ?? 0) - (b.year ?? 0) || (a.month ?? 0) - (b.month ?? 0),
  );
  const recent = monthly.slice(-HISTORY_MONTHS);

  const body: KeywordOverviewResponse = {
    keyword,
    locationCode: query.location,
    languageCode: query.language,
    searchVolume: row?.metrics.searchVolume ?? null,
    cpc: row?.metrics.cpc ?? null,
    // Already a 0–1 float on Labs — the /100 this used to do was for Google
    // Ads' `competition_index`, which is a different field on a different API.
    competition: row?.metrics.competition ?? null,
    competitionLevel: row?.metrics.competitionLevel ?? null,
    lowTopOfPageBid: row?.metrics.lowTopOfPageBid ?? null,
    highTopOfPageBid: row?.metrics.highTopOfPageBid ?? null,
    keywordDifficulty: row?.keywordDifficulty ?? null,
    intent: row?.mainIntent ?? null,
    // See the note above: this endpoint carries no confidence figure.
    intentProbability: null,
    secondaryIntents: (row?.secondaryIntents ?? []).map((intent) => ({
      intent,
      probability: null,
    })),
    monthlySearches: recent.map((point) => ({
      year: point.year,
      month: point.month,
      period: toIsoMonth(point.year, point.month),
      searchVolume: point.searchVolume,
    })),
    costUsd: overview.costUsd,
    cached: overview.cached,
  };
  return c.json(body);
});

keywords.get("/ideas", async (c) => {
  const query = readQuery(c, listQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.labs.googleKeywordIdeasLive({
    keyword: query.keyword,
    locationCode: query.location,
    languageCode: query.language,
    limit: query.limit,
    offset: query.offset,
    filters: flatRowFilters(query),
    sorts: VOLUME_DESC_FLAT,
    fresh: query.fresh,
  });

  return c.json(listBody(query, result.items.map(toKeywordRow), result));
});

keywords.get("/suggestions", async (c) => {
  const query = readQuery(c, listQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.labs.googleKeywordSuggestionsLive({
    keyword: query.keyword,
    locationCode: query.location,
    languageCode: query.language,
    limit: query.limit,
    offset: query.offset,
    filters: flatRowFilters(query),
    sorts: VOLUME_DESC_FLAT,
    fresh: query.fresh,
  });

  return c.json(listBody(query, result.items.map(toKeywordRow), result));
});

keywords.get("/related", async (c) => {
  const query = readQuery(
    c,
    listQuerySchema.extend({
      depth: z.coerce
        .number()
        .int()
        .min(0)
        .max(RELATED_KEYWORDS_MAX_DEPTH)
        .optional(),
    }),
  );
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.labs.googleRelatedKeywordsLive({
    keyword: query.keyword,
    locationCode: query.location,
    languageCode: query.language,
    depth: query.depth,
    limit: query.limit,
    offset: query.offset,
    // `keyword_data.`-prefixed: this endpoint's rows are wrapped.
    filters: wrappedRowFilters(query),
    sorts: VOLUME_DESC_WRAPPED,
    fresh: query.fresh,
  });

  const items: KeywordRow[] = result.items.map((row) => ({
    ...toKeywordRow(row),
    depth: row.depth,
    relatedKeywords: row.relatedKeywords,
  }));

  return c.json(listBody(query, items, result));
});

keywords.get("/serp", async (c) => {
  const query = readQuery(
    c,
    keywordQuerySchema.extend({
      fresh: booleanParam,
      device: z.enum(["desktop", "mobile"]).optional(),
    }),
  );
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.serp.googleOrganicLiveAdvanced({
    keyword: query.keyword,
    locationCode: query.location,
    languageCode: query.language,
    device: query.device,
    fresh: query.fresh,
  });

  const body: KeywordSerpResponse = {
    keyword: result.keyword,
    locationCode: query.location,
    languageCode: query.language,
    checkUrl: result.checkUrl,
    fetchedAt: result.fetchedAt,
    serpFeatures: result.serpFeatures,
    totalResults: result.totalResults,
    items: result.items.map((item) => ({
      position: item.position,
      positionAbsolute: item.positionAbsolute,
      title: item.title,
      url: item.url,
      domain: item.domain,
      description: item.description,
      breadcrumb: item.breadcrumb,
    })),
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

/** The list envelope, identical across the three keyword tabs. */
function listBody(
  query: { keyword: string; location: number; language: string; limit: number; offset: number },
  items: KeywordRow[],
  result: { totalCount: number | null; itemsCount: number | null; costUsd: number; cached: boolean },
): KeywordListResponse {
  return {
    keyword: query.keyword.toLowerCase(),
    locationCode: query.location,
    languageCode: query.language,
    items,
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
  };
}

export default keywords;
