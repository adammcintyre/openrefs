/**
 * Domain Overview, as functions rather than routes.
 *
 * Only the two views the MCP server exposes as tools live here —
 * `domain_overview` and `domain_keywords`. The rest of `routes/domains.ts`
 * (history, pages, competitors, countries) has one caller and stays there;
 * moving it for symmetry alone would be churn.
 *
 * `toRankMetrics` is the exception: it is shared by every one of those routes,
 * so it is exported from here and imported back rather than living in two
 * places. See `services/keywords.ts` for why the split is drawn at
 * authorisation.
 */
import type { Db } from "../../db";
import type {
  DomainKeywordsResponse,
  DomainOverviewResponse,
  RankMetrics,
} from "../../shared/domains";
import { createDataForSeoApi } from "../dataforseo";
import type { LabsRankMetrics } from "../dataforseo";
import { RANKED_KEYWORDS_FIELDS, containsFilter } from "../dataforseo";
import { fetchedAtIso } from "../dataforseo/schema";
import type { LabsFilter } from "../dataforseo/filters";
import { rangeFilters } from "../dataforseo/filters";

/** Upstream metrics to the shared shape. Renames `etv` to what it means. */
export function toRankMetrics(metrics: LabsRankMetrics): RankMetrics {
  return {
    keywordCount: metrics.count,
    traffic: metrics.etv,
    trafficValueUsd: metrics.estimatedPaidTrafficCostUsd,
    positions: metrics.positions,
    isNew: metrics.isNew,
    isUp: metrics.isUp,
    isDown: metrics.isDown,
    isLost: metrics.isLost,
  };
}

export interface DomainQueryInput {
  workspace: string;
  /** Already normalised by `domainParam` / `normalizeDomain`. */
  domain: string;
  location: number;
  language: string;
  /** Bypass the cache and buy a new answer. */
  fresh?: boolean;
  /** Serve a cached answer past its normal lifetime, spending nothing. */
  allowStale?: boolean;
}

export interface DomainKeywordsInput extends DomainQueryInput {
  limit: number;
  offset: number;
  /** Fetches the paid side instead of the organic one. See the note below. */
  paid?: boolean;
  minVolume?: number;
  maxVolume?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
  minPosition?: number;
  maxPosition?: number;
  include?: string;
  exclude?: string;
}

export async function domainOverview(
  env: Env,
  db: Db,
  input: DomainQueryInput,
): Promise<DomainOverviewResponse> {
  const dfs = await createDataForSeoApi(env, db, input.workspace);

  const result = await dfs.labs.googleDomainRankOverviewLive({
    target: input.domain,
    locationCode: input.location,
    languageCode: input.language,
    fresh: input.fresh,
    allowStale: input.allowStale,
  });

  return {
    domain: input.domain,
    locationCode: input.location,
    languageCode: input.language,
    organic: toRankMetrics(result.organic),
    paid: toRankMetrics(result.paid),
    costUsd: result.costUsd,
    cached: result.cached,
    stale: result.stale ?? false,
    fetchedAt: fetchedAtIso(result),
  };
}

/**
 * `paid=true` is not a client-side filter over a shared result set: it changes
 * `item_types` upstream. DataForSEO refuses to sort or filter by a result type
 * that was not requested, so asking for the default and filtering for paid
 * would return nothing. The two views are separate queries, separately cached.
 */
export async function domainKeywords(
  env: Env,
  db: Db,
  input: DomainKeywordsInput,
): Promise<DomainKeywordsResponse> {
  const dfs = await createDataForSeoApi(env, db, input.workspace);

  const paid = input.paid === true;
  const filters: LabsFilter[] = [
    ...rangeFilters(
      RANKED_KEYWORDS_FIELDS.searchVolume,
      input.minVolume,
      input.maxVolume,
    ),
    ...rangeFilters(
      RANKED_KEYWORDS_FIELDS.keywordDifficulty,
      input.minDifficulty,
      input.maxDifficulty,
    ),
    ...rangeFilters(
      RANKED_KEYWORDS_FIELDS.position,
      input.minPosition,
      input.maxPosition,
    ),
    ...(input.include
      ? [containsFilter(RANKED_KEYWORDS_FIELDS.keyword, input.include)]
      : []),
    ...(input.exclude
      ? [containsFilter(RANKED_KEYWORDS_FIELDS.keyword, input.exclude, true)]
      : []),
  ];

  const result = await dfs.labs.googleRankedKeywordsLive({
    target: input.domain,
    locationCode: input.location,
    languageCode: input.language,
    limit: input.limit,
    offset: input.offset,
    itemTypes: [paid ? "paid" : "organic"],
    filters,
    sorts: [{ field: RANKED_KEYWORDS_FIELDS.position, direction: "asc" }],
    fresh: input.fresh,
    allowStale: input.allowStale,
  });

  return {
    domain: input.domain,
    locationCode: input.location,
    languageCode: input.language,
    paid,
    items: result.items.map((item) => ({
      keyword: item.keyword,
      searchVolume: item.metrics.searchVolume,
      cpc: item.metrics.cpc,
      competition: item.metrics.competition,
      competitionLevel: item.metrics.competitionLevel,
      keywordDifficulty: item.keywordDifficulty,
      position: item.position,
      positionAbsolute: item.positionAbsolute,
      url: item.url,
      title: item.title,
      serpItemType: item.serpItemType,
      traffic: item.etv,
    })),
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: input.limit,
    offset: input.offset,
    costUsd: result.costUsd,
    cached: result.cached,
    stale: result.stale ?? false,
    fetchedAt: fetchedAtIso(result),
  };
}
