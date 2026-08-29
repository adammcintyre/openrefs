/**
 * `keywords_data/*` — Google Ads keyword metrics.
 *
 * Shapes verified against https://docs.dataforseo.com/v3/keywords_data/
 * google_ads/search_volume/live/ (2026-08-29). Two things here are easy to get
 * wrong from memory and are called out where they bite:
 *
 *  - `competition` on this API is the bucket STRING ("HIGH"/"MEDIUM"/"LOW"),
 *    while the numeric 0–100 scale is `competition_index`. DataForSEO Labs
 *    uses the same key name for a 0–1 float. See ./schema.ts.
 *  - `result` is a flat array of keyword objects, with no `items` wrapper —
 *    unlike every Labs endpoint.
 */
import { z } from "zod";

import { ApiException } from "../http";
import type { DataForSeoClient } from "./client";
import type {
  CompetitionLevel,
  MonthlySearch,
  WrappedMeta,
} from "./schema";
import {
  competitionLevel,
  monthlySearches,
  nullableNumber,
  nullableString,
  toMonthlySearches,
} from "./schema";

export const GOOGLE_ADS_SEARCH_VOLUME_LIVE =
  "keywords_data/google_ads/search_volume/live";

/** Documented ceiling: "max 1000" keywords per task. */
export const SEARCH_VOLUME_MAX_KEYWORDS = 1000;

const paramsSchema = z.object({
  keywords: z.array(z.string().trim().min(1)).min(1).max(SEARCH_VOLUME_MAX_KEYWORDS),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  /** Bypass a cache hit but still refresh the entry. */
  fresh: z.boolean().optional(),
});

export type SearchVolumeParams = z.input<typeof paramsSchema>;

const itemSchema = z.object({
  keyword: z.string(),
  location_code: nullableNumber,
  language_code: nullableString,
  search_volume: nullableNumber,
  cpc: nullableNumber,
  /** Google Ads: the bucket string, not a number. */
  competition: competitionLevel,
  /** Google Ads: 0–100 integer. The numeric counterpart of `competition`. */
  competition_index: nullableNumber,
  low_top_of_page_bid: nullableNumber,
  high_top_of_page_bid: nullableNumber,
  monthly_searches: monthlySearches,
});

export interface SearchVolumeKeyword {
  keyword: string;
  locationCode: number | null;
  languageCode: string | null;
  searchVolume: number | null;
  cpc: number | null;
  competition: CompetitionLevel | null;
  /** 0–100. */
  competitionIndex: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  monthlySearches: MonthlySearch[];
  /**
   * The untouched DataForSEO item. Everything this wrapper does not model is
   * still here, so a new feature can read a new field without a client change.
   */
  raw: unknown;
}

export interface SearchVolumeResult extends WrappedMeta {
  keywords: SearchVolumeKeyword[];
}

export interface KeywordsDataApi {
  googleAdsSearchVolumeLive(
    params: SearchVolumeParams,
  ): Promise<SearchVolumeResult>;
}

export function createKeywordsDataApi(
  client: DataForSeoClient,
): KeywordsDataApi {
  return {
    async googleAdsSearchVolumeLive(params) {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        throw new ApiException(
          "validation_failed",
          `Invalid search volume request (max ${SEARCH_VOLUME_MAX_KEYWORDS} keywords).`,
          z.flattenError(parsed.error),
        );
      }
      const { keywords, locationCode, languageCode, fresh } = parsed.data;

      const response = await client.request<z.input<typeof itemSchema>>({
        endpoint: GOOGLE_ADS_SEARCH_VOLUME_LIVE,
        // The body is an array of task objects even for a single task.
        payload: [
          {
            keywords: normalizeKeywords(keywords),
            location_code: locationCode,
            language_code: languageCode,
          },
        ],
        // Search volume moves monthly at most; docs/ARCHITECTURE.md puts it in
        // the 30-day bucket.
        ttl: "long",
        fresh,
      });

      return {
        keywords: response.results.map(toKeyword),
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
      };
    },
  };
}

/**
 * Lowercased (the API requires it), de-duplicated and sorted.
 *
 * Sorting is what makes the cache key stable: the same set of keywords asked
 * for in a different order is the same question, and canonicalJson preserves
 * array order deliberately, so the normalisation has to happen here.
 */
export function normalizeKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
}

function toKeyword(raw: unknown): SearchVolumeKeyword {
  const item = itemSchema.parse(raw);
  return {
    keyword: item.keyword,
    locationCode: item.location_code,
    languageCode: item.language_code,
    searchVolume: item.search_volume,
    cpc: item.cpc,
    competition: item.competition,
    competitionIndex: item.competition_index,
    lowTopOfPageBid: item.low_top_of_page_bid,
    highTopOfPageBid: item.high_top_of_page_bid,
    monthlySearches: toMonthlySearches(item.monthly_searches),
    raw,
  };
}
