/**
 *   GET /api/v1/keywords/overview      volume + difficulty + intent, merged
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
 * Three upstream endpoints, because no single one carries all of it: Google
 * Ads has volume and CPC, Labs has difficulty, and intent is its own endpoint
 * again (and takes no location — it is language-only).
 *
 * They are fetched concurrently and settled independently: difficulty or
 * intent failing leaves those fields null rather than costing the user the
 * volume data they already paid for. A volume failure does throw — with no
 * volume there is no overview to show.
 */
keywords.get("/overview", async (c) => {
  const query = readQuery(c, keywordQuerySchema.extend({ fresh: booleanParam }));
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const keyword = query.keyword.toLowerCase();
  const market = { locationCode: query.location, languageCode: query.language };

  const [volume, difficulty, intent] = await Promise.all([
    dfs.keywordsData.googleAdsSearchVolumeLive({
      keywords: [keyword],
      ...market,
      fresh: query.fresh,
    }),
    settle(
      dfs.labs.googleBulkKeywordDifficultyLive({
        keywords: [keyword],
        ...market,
        fresh: query.fresh,
      }),
    ),
    settle(
      dfs.labs.googleSearchIntentLive({
        keywords: [keyword],
        // Deliberately no location: this endpoint does not accept one.
        languageCode: query.language,
        fresh: query.fresh,
      }),
    ),
  ]);

  const row = volume.keywords[0];
  const difficultyRow = difficulty?.items[0];
  const intentRow = intent?.items[0];

  // DataForSEO returns monthly volumes NEWEST-first despite its docs (observed
  // live, 2026-08). Sort ascending before slicing so "the last N months" takes
  // the most recent ones and the shared type's oldest-first contract holds
  // regardless of upstream order.
  const monthly = [...(row?.monthlySearches ?? [])].sort(
    (a, b) =>
      (a.year ?? 0) - (b.year ?? 0) || (a.month ?? 0) - (b.month ?? 0),
  );
  const recent = monthly.slice(-HISTORY_MONTHS);

  const body: KeywordOverviewResponse = {
    keyword,
    locationCode: query.location,
    languageCode: query.language,
    searchVolume: row?.searchVolume ?? null,
    cpc: row?.cpc ?? null,
    // Google Ads reports competition as a bucket string plus a 0–100 index;
    // the shared type wants the 0–1 float the rest of the app uses.
    competition: row?.competitionIndex === null || row?.competitionIndex === undefined
      ? null
      : row.competitionIndex / 100,
    competitionLevel: row?.competition ?? null,
    lowTopOfPageBid: row?.lowTopOfPageBid ?? null,
    highTopOfPageBid: row?.highTopOfPageBid ?? null,
    keywordDifficulty: difficultyRow?.keywordDifficulty ?? null,
    intent: intentRow?.intent ?? null,
    intentProbability: intentRow?.probability ?? null,
    secondaryIntents: intentRow?.secondary ?? [],
    monthlySearches: recent.map((point) => ({
      year: point.year,
      month: point.month,
      period: toIsoMonth(point.year, point.month),
      searchVolume: point.searchVolume,
    })),
    costUsd: sumCost(volume, difficulty, intent),
    // Only "cached" if every call that contributed was.
    cached:
      volume.cached &&
      (difficulty?.cached ?? true) &&
      (intent?.cached ?? true),
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

/**
 * Turns a rejection into `null`.
 *
 * Used only for the *supplementary* halves of the overview. The distinction
 * that matters: the caller has already been billed for whatever succeeded, so
 * discarding a good volume response because an intent lookup failed would be
 * charging someone for nothing.
 */
async function settle<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

function sumCost(...results: ({ costUsd: number } | null)[]): number {
  return results.reduce((total, result) => total + (result?.costUsd ?? 0), 0);
}

export default keywords;
