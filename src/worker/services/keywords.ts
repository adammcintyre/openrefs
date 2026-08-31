/**
 * Keyword Research, as functions rather than routes.
 *
 * This module holds what `routes/keywords.ts` used to do inline. It moved here
 * when the MCP server landed: `keyword_overview`, `keyword_ideas` and
 * `keyword_serp` are tools as well as endpoints, and an agent calling a tool
 * must get exactly what the SPA gets from the endpoint. Two copies of a
 * response mapper is precisely how that stops being true, so there is one.
 *
 * The split is drawn at authorisation. Everything here takes an already-proven
 * `Db` handle and a validated input object; nothing here reads a Hono context,
 * parses a query string, or checks membership. The route does that, the MCP
 * tool does that, and both then call the same function.
 */
import type { Db } from "../../db";
import type {
  KeywordListResponse,
  KeywordOverviewResponse,
  KeywordRow,
  KeywordSerpResponse,
} from "../../shared/keywords";
import { createDataForSeoApi } from "../dataforseo";
import type { LabsKeywordRow } from "../dataforseo";
import { containsFilter, toIsoMonth } from "../dataforseo";
import type { WrappedMeta } from "../dataforseo/schema";
import { fetchedAtIso } from "../dataforseo/schema";
import type { LabsFilter, LabsSort } from "../dataforseo/filters";
import { rangeFilters } from "../dataforseo/filters";

/** How many months of history the overview chart shows. */
const HISTORY_MONTHS = 12;

/** The market and workspace every keyword call needs. */
export interface KeywordQueryInput {
  workspace: string;
  keyword: string;
  location: number;
  language: string;
  /** Bypass the cache and buy a new answer. */
  fresh?: boolean;
  /**
   * Serve a cached answer even past its normal lifetime, spending nothing.
   * Named for the *client* option rather than the `stale` query parameter —
   * see `toFreshness` in lib/research.ts for why the two words differ.
   */
  allowStale?: boolean;
}

/** The filter set the three list endpoints share. */
export interface KeywordListInput extends KeywordQueryInput {
  limit: number;
  offset: number;
  minVolume?: number;
  maxVolume?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
  /** Substring the keyword must contain. */
  include?: string;
  /** Substring the keyword must not contain. */
  exclude?: string;
}

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

/** The list envelope, identical across the three keyword tabs. */
function listBody(
  query: { keyword: string; location: number; language: string; limit: number; offset: number },
  items: KeywordRow[],
  result: {
    totalCount: number | null;
    itemsCount: number | null;
  } & WrappedMeta,
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
    stale: result.stale ?? false,
    fetchedAt: fetchedAtIso(result),
  };
}

/**
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
export async function keywordOverview(
  env: Env,
  db: Db,
  input: KeywordQueryInput,
): Promise<KeywordOverviewResponse> {
  const dfs = await createDataForSeoApi(env, db, input.workspace);
  const keyword = input.keyword.toLowerCase();

  const overview = await dfs.labs.googleKeywordOverviewLive({
    keywords: [keyword],
    locationCode: input.location,
    languageCode: input.language,
    fresh: input.fresh,
    allowStale: input.allowStale,
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
    (a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.month ?? 0) - (b.month ?? 0),
  );
  const recent = monthly.slice(-HISTORY_MONTHS);

  return {
    keyword,
    locationCode: input.location,
    languageCode: input.language,
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
    stale: overview.stale ?? false,
    fetchedAt: fetchedAtIso(overview),
  };
}

export async function keywordIdeas(
  env: Env,
  db: Db,
  input: KeywordListInput,
): Promise<KeywordListResponse> {
  const dfs = await createDataForSeoApi(env, db, input.workspace);

  const result = await dfs.labs.googleKeywordIdeasLive({
    keyword: input.keyword,
    locationCode: input.location,
    languageCode: input.language,
    limit: input.limit,
    offset: input.offset,
    filters: flatRowFilters(input),
    sorts: VOLUME_DESC_FLAT,
    fresh: input.fresh,
    allowStale: input.allowStale,
  });

  return listBody(input, result.items.map(toKeywordRow), result);
}

export async function keywordSuggestions(
  env: Env,
  db: Db,
  input: KeywordListInput,
): Promise<KeywordListResponse> {
  const dfs = await createDataForSeoApi(env, db, input.workspace);

  const result = await dfs.labs.googleKeywordSuggestionsLive({
    keyword: input.keyword,
    locationCode: input.location,
    languageCode: input.language,
    limit: input.limit,
    offset: input.offset,
    filters: flatRowFilters(input),
    sorts: VOLUME_DESC_FLAT,
    fresh: input.fresh,
    allowStale: input.allowStale,
  });

  return listBody(input, result.items.map(toKeywordRow), result);
}

export async function keywordRelated(
  env: Env,
  db: Db,
  input: KeywordListInput & { depth?: number },
): Promise<KeywordListResponse> {
  const dfs = await createDataForSeoApi(env, db, input.workspace);

  const result = await dfs.labs.googleRelatedKeywordsLive({
    keyword: input.keyword,
    locationCode: input.location,
    languageCode: input.language,
    depth: input.depth,
    limit: input.limit,
    offset: input.offset,
    // `keyword_data.`-prefixed: this endpoint's rows are wrapped.
    filters: wrappedRowFilters(input),
    sorts: VOLUME_DESC_WRAPPED,
    fresh: input.fresh,
    allowStale: input.allowStale,
  });

  const items: KeywordRow[] = result.items.map((row) => ({
    ...toKeywordRow(row),
    depth: row.depth,
    relatedKeywords: row.relatedKeywords,
  }));

  return listBody(input, items, result);
}

export async function keywordSerp(
  env: Env,
  db: Db,
  input: KeywordQueryInput & { device?: "desktop" | "mobile" },
): Promise<KeywordSerpResponse> {
  const dfs = await createDataForSeoApi(env, db, input.workspace);

  const result = await dfs.serp.googleOrganicLiveAdvanced({
    keyword: input.keyword,
    locationCode: input.location,
    languageCode: input.language,
    device: input.device,
    fresh: input.fresh,
    allowStale: input.allowStale,
  });

  return {
    keyword: result.keyword,
    locationCode: input.location,
    languageCode: input.language,
    checkUrl: result.checkUrl,
    /*
     * The ONE `fetchedAt` in this API that is not our cache's clock: the SERP
     * endpoint reports the provider's own crawl time, which is a better answer
     * to "when was this page seen" than "when did we fetch it", and which the
     * provider may omit. Left exactly as it was when `ResultMeta.fetchedAt`
     * landed — see the field note in src/shared/api.ts.
     */
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
    stale: result.stale ?? false,
  };
}
