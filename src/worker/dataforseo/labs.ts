/**
 * `dataforseo_labs/google/*` — DataForSEO's own keyword and ranking database.
 *
 * Shapes verified against https://docs.dataforseo.com/v3/dataforseo_labs/
 * google/keyword_ideas/live/ and .../ranked_keywords/live/ (2026-08-29).
 * Three things here are not guessable and are commented where they matter:
 *
 *  - Both endpoints return `result` as an array holding ONE wrapper object;
 *    the rows are in its `items`.
 *  - keyword_ideas takes `keywords` (an ARRAY) as its seed, even for one seed.
 *  - `serp_item.position` is the SERP column ("left"/"right"), NOT the rank.
 *    Rank is `rank_group` / `rank_absolute`.
 */
import { z } from "zod";

import { ApiException } from "../http";
import type { DataForSeoClient } from "./client";
import type { LabsKeywordMetrics, WrappedMeta } from "./schema";
import {
  keywordPropertiesSchema,
  labsKeywordInfoSchema,
  labsWrapperSchema,
  nullableNumber,
  nullableString,
  searchIntentInfoSchema,
  toLabsKeywordMetrics,
} from "./schema";

export const GOOGLE_KEYWORD_IDEAS_LIVE =
  "dataforseo_labs/google/keyword_ideas/live";
export const GOOGLE_RANKED_KEYWORDS_LIVE =
  "dataforseo_labs/google/ranked_keywords/live";

/** Documented ceiling on `limit` for both endpoints. */
export const LABS_MAX_LIMIT = 1000;

/* -------------------------------------------------------------------------- */
/* Keyword ideas                                                               */
/* -------------------------------------------------------------------------- */

const keywordIdeasParamsSchema = z.object({
  keyword: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  fresh: z.boolean().optional(),
});

export type KeywordIdeasParams = z.input<typeof keywordIdeasParamsSchema>;

const keywordIdeaItemSchema = z.object({
  keyword: z.string(),
  location_code: nullableNumber,
  language_code: nullableString,
  keyword_info: labsKeywordInfoSchema.nullish(),
  keyword_properties: keywordPropertiesSchema.nullish(),
  search_intent_info: searchIntentInfoSchema.nullish(),
});

export interface KeywordIdea {
  keyword: string;
  locationCode: number | null;
  languageCode: string | null;
  metrics: LabsKeywordMetrics;
  /** 0–100, from `keyword_properties.keyword_difficulty`. */
  keywordDifficulty: number | null;
  /** "informational" | "navigational" | "commercial" | "transactional". */
  mainIntent: string | null;
  raw: unknown;
}

export interface KeywordIdeasResult extends WrappedMeta {
  items: KeywordIdea[];
  /** How many ideas exist in total, not how many were returned. */
  totalCount: number | null;
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Ranked keywords                                                             */
/* -------------------------------------------------------------------------- */

const rankedKeywordsParamsSchema = z.object({
  /**
   * A bare domain ("example.com"). Including a scheme or `www.` silently
   * turns this into a page-level query that returns far fewer keywords, so
   * the wrapper strips both rather than trusting the caller.
   */
  target: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  fresh: z.boolean().optional(),
});

export type RankedKeywordsParams = z.input<typeof rankedKeywordsParamsSchema>;

const serpItemSchema = z.object({
  type: nullableString,
  /** The ranking. `position` is the SERP column and is deliberately unused. */
  rank_group: nullableNumber,
  rank_absolute: nullableNumber,
  url: nullableString,
  title: nullableString,
  domain: nullableString,
  description: nullableString,
  etv: nullableNumber,
});

const rankedKeywordItemSchema = z.object({
  keyword_data: z
    .object({
      keyword: z.string(),
      location_code: nullableNumber,
      language_code: nullableString,
      keyword_info: labsKeywordInfoSchema.nullish(),
      keyword_properties: keywordPropertiesSchema.nullish(),
    })
    .nullish(),
  ranked_serp_element: z
    .object({
      serp_item: serpItemSchema.nullish(),
      /** Mirrored here as well as under keyword_properties. */
      keyword_difficulty: nullableNumber,
      is_lost: z.boolean().nullish().transform((v) => v ?? null),
    })
    .nullish(),
});

export interface RankedKeyword {
  keyword: string | null;
  metrics: LabsKeywordMetrics;
  keywordDifficulty: number | null;
  /** `rank_group` — ties share a group. Null when the item carried no rank. */
  position: number | null;
  /** `rank_absolute` — every SERP element counted individually. */
  positionAbsolute: number | null;
  url: string | null;
  title: string | null;
  domain: string | null;
  /** "organic" | "paid" | "featured_snippet" | ... */
  serpItemType: string | null;
  /** DataForSEO's estimated traffic value for this ranking. */
  etv: number | null;
  raw: unknown;
}

export interface RankedKeywordsResult extends WrappedMeta {
  items: RankedKeyword[];
  totalCount: number | null;
  itemsCount: number | null;
}

export interface LabsApi {
  googleKeywordIdeasLive(params: KeywordIdeasParams): Promise<KeywordIdeasResult>;
  googleRankedKeywordsLive(
    params: RankedKeywordsParams,
  ): Promise<RankedKeywordsResult>;
}

const keywordIdeasResultSchema = labsWrapperSchema(z.unknown());

export function createLabsApi(client: DataForSeoClient): LabsApi {
  return {
    async googleKeywordIdeasLive(params) {
      const parsed = keywordIdeasParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new ApiException(
          "validation_failed",
          `Invalid keyword ideas request (limit must be 1–${LABS_MAX_LIMIT}).`,
          z.flattenError(parsed.error),
        );
      }
      const { keyword, locationCode, languageCode, limit, fresh } = parsed.data;

      const response = await client.request<unknown>({
        endpoint: GOOGLE_KEYWORD_IDEAS_LIVE,
        payload: [
          {
            // Plural and an array on the wire, even for our single seed. The
            // response echoes it back as `seed_keywords`.
            keywords: [keyword.toLowerCase()],
            location_code: locationCode,
            language_code: languageCode,
            limit,
          },
        ],
        // Ideas are derived from search volume and move on the same clock.
        ttl: "long",
        fresh,
      });

      const wrapper = parseWrapper(response.results[0], GOOGLE_KEYWORD_IDEAS_LIVE);
      return {
        items: wrapper.items.map(toKeywordIdea),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
      };
    },

    async googleRankedKeywordsLive(params) {
      const parsed = rankedKeywordsParamsSchema.safeParse(params);
      if (!parsed.success) {
        throw new ApiException(
          "validation_failed",
          `Invalid ranked keywords request (limit must be 1–${LABS_MAX_LIMIT}).`,
          z.flattenError(parsed.error),
        );
      }
      const { target, locationCode, languageCode, limit, fresh } = parsed.data;

      const response = await client.request<unknown>({
        endpoint: GOOGLE_RANKED_KEYWORDS_LIVE,
        payload: [
          {
            target: normalizeTarget(target),
            location_code: locationCode,
            language_code: languageCode,
            limit,
          },
        ],
        // Rankings move daily, but a 7-day window is what ARCHITECTURE.md
        // budgets for Labs SERP data; live refreshes are a separate endpoint.
        ttl: "short",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_RANKED_KEYWORDS_LIVE,
      );
      return {
        items: wrapper.items.map(toRankedKeyword),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
      };
    },
  };
}

/**
 * A bare hostname, which is what "give me everything this domain ranks for"
 * requires. `https://example.com/page` is a legitimate page-level query on
 * this endpoint, but our wrapper only exposes the domain form, so a scheme or
 * `www.` reaching here is a caller mistake rather than an intent.
 */
export function normalizeTarget(target: string): string {
  return target
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

function parseWrapper(
  result: unknown,
  endpoint: string,
): z.infer<typeof keywordIdeasResultSchema> {
  const parsed = keywordIdeasResultSchema.safeParse(result);
  if (!parsed.success) {
    // The call succeeded and was billed, so this is a shape change on their
    // side rather than a request error — worth surfacing loudly.
    throw new ApiException(
      "upstream_error",
      `DataForSEO ${endpoint} returned an unrecognised result shape.`,
    );
  }
  return parsed.data;
}

function toKeywordIdea(raw: unknown): KeywordIdea {
  const item = keywordIdeaItemSchema.parse(raw);
  return {
    keyword: item.keyword,
    locationCode: item.location_code,
    languageCode: item.language_code,
    metrics: toLabsKeywordMetrics(item.keyword_info),
    keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
    mainIntent: item.search_intent_info?.main_intent ?? null,
    raw,
  };
}

function toRankedKeyword(raw: unknown): RankedKeyword {
  const item = rankedKeywordItemSchema.parse(raw);
  const serpItem = item.ranked_serp_element?.serp_item;
  return {
    keyword: item.keyword_data?.keyword ?? null,
    metrics: toLabsKeywordMetrics(item.keyword_data?.keyword_info),
    keywordDifficulty:
      item.keyword_data?.keyword_properties?.keyword_difficulty ??
      item.ranked_serp_element?.keyword_difficulty ??
      null,
    position: serpItem?.rank_group ?? null,
    positionAbsolute: serpItem?.rank_absolute ?? null,
    url: serpItem?.url ?? null,
    title: serpItem?.title ?? null,
    domain: serpItem?.domain ?? null,
    serpItemType: serpItem?.type ?? null,
    etv: serpItem?.etv ?? null,
    raw,
  };
}
