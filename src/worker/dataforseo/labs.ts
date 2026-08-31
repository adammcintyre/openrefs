/**
 * `dataforseo_labs/google/*` — DataForSEO's own keyword and ranking database.
 *
 * Shapes verified against https://docs.dataforseo.com/v3/dataforseo_labs/
 * google/<endpoint>/live/ (2026-08-29). The things here that are not guessable
 * are commented where they matter; the big ones:
 *
 *  - Every Labs endpoint returns `result` as an array holding ONE wrapper
 *    object; the rows are in its `items`.
 *  - keyword_ideas takes `keywords` (an ARRAY) as its seed, even for one seed,
 *    while keyword_suggestions and related_keywords take `keyword` (SINGULAR).
 *  - **Three different row shapes for what is morally one row.**
 *    keyword_ideas / keyword_suggestions are flat (`items[].keyword_info`);
 *    related_keywords wraps everything in `items[].keyword_data` and adds
 *    `depth`; ranked_keywords wraps in `keyword_data` + `ranked_serp_element`.
 *    Filter and sort paths have to follow the same prefixes — see FILTERS.
 *  - `serp_item.position` is the SERP column ("left"/"right"), NOT the rank.
 *    Rank is `rank_group` / `rank_absolute`.
 *  - search_intent takes NO location — it is language-only — and names its
 *    intent field `keyword_intent.label`, not `search_intent_info.main_intent`.
 *  - keyword_overview returns volume, difficulty AND intent in one call, and
 *    its three gotchas are all documented: `keyword_info.competition` is
 *    already a **0–1 float** (Google Ads' `competition_index` is the 0–100 one
 *    — do not divide); a keyword their database does not know is **omitted
 *    from `items`** rather than returned with nulls, so `items` can be shorter
 *    than `keywords` and callers must match by the `keyword` field; and
 *    `result[0]` carries no `total_count` and no `offset`.
 */
import { z } from "zod";

import { ApiException } from "../http";
import type { DataForSeoClient } from "./client";
import type { LabsFilter, LabsSort } from "./filters";
import { toLabsFilters, toLabsOrderBy } from "./filters";
import type {
  LabsKeywordMetrics,
  LabsMetricsBlock,
  LabsRankMetrics,
  WrappedMeta,
} from "./schema";
import {
  keywordPropertiesSchema,
  labsKeywordInfoSchema,
  labsMetricsBlockSchema,
  labsWrapperSchema,
  nullableNumber,
  nullableString,
  searchIntentInfoSchema,
  toLabsKeywordMetrics,
  toLabsMetricsBlock,
} from "./schema";

export const GOOGLE_KEYWORD_OVERVIEW_LIVE =
  "dataforseo_labs/google/keyword_overview/live";
export const GOOGLE_KEYWORD_IDEAS_LIVE =
  "dataforseo_labs/google/keyword_ideas/live";
export const GOOGLE_KEYWORD_SUGGESTIONS_LIVE =
  "dataforseo_labs/google/keyword_suggestions/live";
export const GOOGLE_RELATED_KEYWORDS_LIVE =
  "dataforseo_labs/google/related_keywords/live";
export const GOOGLE_BULK_KEYWORD_DIFFICULTY_LIVE =
  "dataforseo_labs/google/bulk_keyword_difficulty/live";
export const GOOGLE_SEARCH_INTENT_LIVE =
  "dataforseo_labs/google/search_intent/live";
export const GOOGLE_RANKED_KEYWORDS_LIVE =
  "dataforseo_labs/google/ranked_keywords/live";
export const GOOGLE_DOMAIN_RANK_OVERVIEW_LIVE =
  "dataforseo_labs/google/domain_rank_overview/live";
export const GOOGLE_HISTORICAL_RANK_OVERVIEW_LIVE =
  "dataforseo_labs/google/historical_rank_overview/live";
export const GOOGLE_RELEVANT_PAGES_LIVE =
  "dataforseo_labs/google/relevant_pages/live";
export const GOOGLE_COMPETITORS_DOMAIN_LIVE =
  "dataforseo_labs/google/competitors_domain/live";
export const GOOGLE_DOMAIN_INTERSECTION_LIVE =
  "dataforseo_labs/google/domain_intersection/live";
export const GOOGLE_PAGE_INTERSECTION_LIVE =
  "dataforseo_labs/google/page_intersection/live";
export const GOOGLE_BULK_TRAFFIC_ESTIMATION_LIVE =
  "dataforseo_labs/google/bulk_traffic_estimation/live";

/** Documented ceiling on `limit` across the paged Labs endpoints. */
export const LABS_MAX_LIMIT = 1000;

/**
 * Documented ceiling on `keywords` for the bulk endpoints
 * (bulk_keyword_difficulty, search_intent).
 */
export const LABS_MAX_BULK_KEYWORDS = 1000;

/**
 * related_keywords' `depth` is not a page size — it is how many hops out from
 * the seed to walk, and the row count explodes: 0→1, 1→8, 2→72, 3→584, 4→4680.
 * Depth 2 is the useful default for a UI list; anything higher is a bulk job.
 */
export const RELATED_KEYWORDS_MAX_DEPTH = 4;

/**
 * Documented ceiling on `targets` for bulk_traffic_estimation: "you can set up
 * to 1000 domains, subdomains or webpages".
 *
 * Worth batching *to* rather than merely under: the endpoint bills $0.012 per
 * task plus $0.00012 per returned item, so the flat fee dominates every small
 * call. 1000 targets cost $0.132; ten calls of 100 cost $0.24 for the same
 * data.
 */
export const BULK_TRAFFIC_ESTIMATION_MAX_TARGETS = 1000;

/** Flat price of one bulk_traffic_estimation call, USD, before the per-item rate. */
export const BULK_TRAFFIC_ESTIMATION_PRICE_PER_TASK_USD = 0.012;

/** Per returned item (one target), USD. */
export const BULK_TRAFFIC_ESTIMATION_PRICE_PER_ITEM_USD = 0.00012;

/**
 * Where those two figures came from, so the next person re-checks rather than
 * trusts them: https://dataforseo.com/pricing/dataforseo-labs/
 * dataforseo-google-api — bulk_traffic_estimation is not listed by name and
 * falls under the "all other endpoints" row ($0.012 / $0.00012). The worked
 * example on their page ($132 per 1M items) reconciles exactly.
 *
 * **Not to be confused with Historical Bulk Traffic Estimation**, a different
 * endpoint at ten times the price.
 *
 * The `"cost": 0.0103` in the endpoint docs' own response sample is stale — it
 * is stamped version 0.1.20210917 and reflects the old $0.01/$0.0001 rates.
 */
export const BULK_TRAFFIC_ESTIMATION_PRICE_SOURCE =
  "https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api";

/** What estimating `targetCount` targets costs, in one call per 1000. */
export function estimateTrafficEstimationCostUsd(targetCount: number): number {
  const calls = Math.ceil(
    Math.max(0, targetCount) / BULK_TRAFFIC_ESTIMATION_MAX_TARGETS,
  );
  const usd =
    calls * BULK_TRAFFIC_ESTIMATION_PRICE_PER_TASK_USD +
    Math.max(0, targetCount) * BULK_TRAFFIC_ESTIMATION_PRICE_PER_ITEM_USD;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * keyword_overview's documented ceilings: 700 keywords per task, each at most
 * 80 characters and 10 words.
 */
export const KEYWORD_OVERVIEW_MAX_KEYWORDS = 700;
export const KEYWORD_OVERVIEW_MAX_KEYWORD_LENGTH = 80;

/* -------------------------------------------------------------------------- */
/* Keyword overview                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One call that carries what /keywords/overview used to assemble from three:
 * volume + CPC + competition (keyword_info), difficulty (keyword_properties)
 * and intent (search_intent_info).
 *
 * No `limit`, `offset`, `filters` or `order_by` — the endpoint documents none
 * of them, so this is a bulk lookup, not a paged list.
 */
const keywordOverviewParamsSchema = z.object({
  keywords: z
    .array(z.string().trim().min(1).max(KEYWORD_OVERVIEW_MAX_KEYWORD_LENGTH))
    .min(1)
    .max(KEYWORD_OVERVIEW_MAX_KEYWORDS),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  fresh: z.boolean().optional(),
});

export type KeywordOverviewParams = z.input<typeof keywordOverviewParamsSchema>;

/**
 * Rows come back in the flat shape — `keyword_info` at the top level, exactly
 * like keyword_ideas — so `labsKeywordRowSchema` parses them unchanged.
 *
 * `result[0]` on this endpoint carries only `se_type`, `location_code`,
 * `language_code`, `items_count` and `items`: there is **no `total_count` and
 * no `offset`**, which the shared wrapper schema tolerates because every one of
 * its fields is nullish.
 */
export interface KeywordOverviewResult extends WrappedMeta {
  items: LabsKeywordRow[];
  /** How many keywords came back. See the omission rule on the wrapper. */
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Keyword ideas                                                               */
/* -------------------------------------------------------------------------- */

const keywordIdeasParamsSchema = z.object({
  keyword: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  /** Rows are flat here, so field paths carry no `keyword_data.` prefix. */
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type KeywordIdeasParams = z.input<typeof keywordIdeasParamsSchema>;

/**
 * The flat row shape. keyword_ideas and keyword_suggestions both return this
 * directly under `items[]`; related_keywords returns the same object one level
 * down, under `items[].keyword_data`.
 */
const labsKeywordRowSchema = z.object({
  keyword: z.string(),
  location_code: nullableNumber,
  language_code: nullableString,
  keyword_info: labsKeywordInfoSchema.nullish(),
  keyword_properties: keywordPropertiesSchema.nullish(),
  search_intent_info: searchIntentInfoSchema.nullish(),
});

export interface LabsKeywordRow {
  keyword: string;
  locationCode: number | null;
  languageCode: string | null;
  metrics: LabsKeywordMetrics;
  /** 0–100, from `keyword_properties.keyword_difficulty`. */
  keywordDifficulty: number | null;
  /** "informational" | "navigational" | "commercial" | "transactional". */
  mainIntent: string | null;
  /**
   * Supplementary intents, from `search_intent_info.foreign_intent`.
   *
   * Doc surprise worth stating twice: these are **plain strings with no
   * probability**, unlike the `search_intent/live` endpoint's
   * `secondary_keyword_intents`, which are objects carrying one. Same concept,
   * two shapes, two endpoints — see the header note on search_intent.
   */
  secondaryIntents: string[];
  raw: unknown;
}

/** keyword_ideas' row. Structurally identical to a suggestions row. */
export type KeywordIdea = LabsKeywordRow;

export interface KeywordIdeasResult extends WrappedMeta {
  items: KeywordIdea[];
  /** How many ideas exist in total, not how many were returned. */
  totalCount: number | null;
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Keyword suggestions                                                         */
/* -------------------------------------------------------------------------- */

const keywordSuggestionsParamsSchema = z.object({
  /** SINGULAR string here — unlike keyword_ideas, which takes an array. */
  keyword: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type KeywordSuggestionsParams = z.input<
  typeof keywordSuggestionsParamsSchema
>;

/** Same row as an idea; the endpoints differ in how they pick, not in shape. */
export type KeywordSuggestion = LabsKeywordRow;

export interface KeywordSuggestionsResult extends WrappedMeta {
  items: KeywordSuggestion[];
  totalCount: number | null;
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Related keywords                                                            */
/* -------------------------------------------------------------------------- */

const relatedKeywordsParamsSchema = z.object({
  keyword: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  /** See RELATED_KEYWORDS_MAX_DEPTH — this multiplies the row count, fast. */
  depth: z.number().int().min(0).max(RELATED_KEYWORDS_MAX_DEPTH).optional(),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type RelatedKeywordsParams = z.input<typeof relatedKeywordsParamsSchema>;

/**
 * The doc surprise this endpoint is known for: the row is NOT flat. Everything
 * a keyword_suggestions row holds at the top level sits under `keyword_data`
 * here, and the item adds two fields of its own.
 */
const relatedKeywordItemSchema = z.object({
  keyword_data: labsKeywordRowSchema,
  depth: nullableNumber,
  /** Plain strings, not objects — the neighbours of this node in the graph. */
  related_keywords: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});

export interface RelatedKeyword extends LabsKeywordRow {
  /** How many hops from the seed this keyword was found at. */
  depth: number | null;
  /** Sibling keywords, as plain strings. Useful for "expand this branch". */
  relatedKeywords: string[];
}

export interface RelatedKeywordsResult extends WrappedMeta {
  items: RelatedKeyword[];
  totalCount: number | null;
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Bulk keyword difficulty                                                     */
/* -------------------------------------------------------------------------- */

const bulkKeywordDifficultyParamsSchema = z.object({
  keywords: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(LABS_MAX_BULK_KEYWORDS),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  fresh: z.boolean().optional(),
});

export type BulkKeywordDifficultyParams = z.input<
  typeof bulkKeywordDifficultyParamsSchema
>;

/** Exactly three keys on the wire. No volume, no CPC — difficulty only. */
const bulkKeywordDifficultyItemSchema = z.object({
  keyword: z.string(),
  keyword_difficulty: nullableNumber,
});

export interface KeywordDifficulty {
  keyword: string;
  /** 0–100. */
  keywordDifficulty: number | null;
}

export interface BulkKeywordDifficultyResult extends WrappedMeta {
  items: KeywordDifficulty[];
}

/* -------------------------------------------------------------------------- */
/* Search intent                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Note the absent `locationCode`: this endpoint takes NO location at all, only
 * a language. Sending one is an "Invalid Field" error, so it is not in the
 * params rather than being quietly dropped.
 */
const searchIntentParamsSchema = z.object({
  keywords: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(LABS_MAX_BULK_KEYWORDS),
  languageCode: z.string().trim().min(2).max(8),
  fresh: z.boolean().optional(),
});

export type SearchIntentParams = z.input<typeof searchIntentParamsSchema>;

const intentLabelSchema = z.object({
  label: nullableString,
  /** 0–1 confidence. */
  probability: nullableNumber,
});

/**
 * And the second surprise: the intent lives at `keyword_intent.label` here,
 * NOT at `search_intent_info.main_intent` as on the keyword endpoints — same
 * concept, different key, different endpoint. `secondary_keyword_intents` is
 * nullable rather than an empty array.
 */
const searchIntentItemSchema = z.object({
  keyword: z.string(),
  keyword_intent: intentLabelSchema.nullish(),
  secondary_keyword_intents: z
    .array(intentLabelSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export interface KeywordIntent {
  keyword: string;
  /** "informational" | "navigational" | "commercial" | "transactional". */
  intent: string | null;
  /** 0–1. How sure DataForSEO is about `intent`. */
  probability: number | null;
  secondary: { intent: string | null; probability: number | null }[];
}

export interface SearchIntentResult extends WrappedMeta {
  items: KeywordIntent[];
}

/* -------------------------------------------------------------------------- */
/* Ranked keywords                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which kind of SERP element a ranking is. This is the paid/organic split:
 * `item_types` on the request restricts what comes back, which is the
 * difference between fetching a domain's ads and filtering client-side.
 */
export const LABS_ITEM_TYPES = [
  "organic",
  "paid",
  "featured_snippet",
  "local_pack",
  "ai_overview_reference",
] as const;

export type LabsItemType = (typeof LABS_ITEM_TYPES)[number];

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
  offset: z.number().int().min(0).optional(),
  /**
   * The paid/organic split. Omitted entirely rather than defaulted, so the
   * caller's silence means DataForSEO's own default and our cache key does not
   * fork on a value we invented.
   */
  itemTypes: z.array(z.enum(LABS_ITEM_TYPES)).min(1).optional(),
  /**
   * Server-side filtering. Field paths must carry this endpoint's nesting —
   * `keyword_data.keyword_info.search_volume`, not `keyword_info....` — see
   * RANKED_KEYWORDS_FIELDS below, which exists so no route hand-writes one.
   */
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type RankedKeywordsParams = z.input<typeof rankedKeywordsParamsSchema>;

/**
 * The filterable/sortable paths on ranked_keywords, named once. Every one is
 * prefixed by the row's own nesting, which differs from the flat endpoints —
 * getting it wrong returns an "Invalid Field" task error, not a silent no-op.
 */
export const RANKED_KEYWORDS_FIELDS = {
  keyword: "keyword_data.keyword",
  searchVolume: "keyword_data.keyword_info.search_volume",
  cpc: "keyword_data.keyword_info.cpc",
  competition: "keyword_data.keyword_info.competition",
  keywordDifficulty: "keyword_data.keyword_properties.keyword_difficulty",
  position: "ranked_serp_element.serp_item.rank_group",
  positionAbsolute: "ranked_serp_element.serp_item.rank_absolute",
  etv: "ranked_serp_element.serp_item.etv",
  serpItemType: "ranked_serp_element.serp_item.type",
  url: "ranked_serp_element.serp_item.url",
} as const;

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

/* -------------------------------------------------------------------------- */
/* Domain rank overview                                                        */
/* -------------------------------------------------------------------------- */

const domainRankOverviewParamsSchema = z.object({
  target: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  fresh: z.boolean().optional(),
});

export type DomainRankOverviewParams = z.input<
  typeof domainRankOverviewParamsSchema
>;

const domainRankOverviewItemSchema = z.object({
  location_code: nullableNumber,
  language_code: nullableString,
  metrics: labsMetricsBlockSchema.nullish(),
});

export interface DomainRankOverview extends WrappedMeta {
  locationCode: number | null;
  languageCode: string | null;
  organic: LabsRankMetrics;
  paid: LabsRankMetrics;
  raw: unknown;
}

/* -------------------------------------------------------------------------- */
/* Historical rank overview                                                    */
/* -------------------------------------------------------------------------- */

const historicalRankOverviewParamsSchema = z.object({
  target: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  /** `yyyy-mm-dd`. DataForSEO's history starts 2020-10-01. */
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  fresh: z.boolean().optional(),
});

export type HistoricalRankOverviewParams = z.input<
  typeof historicalRankOverviewParamsSchema
>;

/**
 * Doc surprise: the series is keyed by separate integer `year` and `month`
 * fields. There is no ISO date string anywhere in the item, so anything
 * wanting one has to build it — `toIsoMonth` below does, once.
 */
const historicalRankOverviewItemSchema = z.object({
  year: nullableNumber,
  month: nullableNumber,
  metrics: labsMetricsBlockSchema.nullish(),
});

export interface HistoricalRankPoint {
  year: number | null;
  month: number | null;
  /** `YYYY-MM`, derived — the API sends only the two integers above. */
  period: string | null;
  organic: LabsRankMetrics;
  paid: LabsRankMetrics;
}

export interface HistoricalRankOverviewResult extends WrappedMeta {
  items: HistoricalRankPoint[];
  totalCount: number | null;
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Relevant pages                                                              */
/* -------------------------------------------------------------------------- */

const relevantPagesParamsSchema = z.object({
  target: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  itemTypes: z.array(z.enum(LABS_ITEM_TYPES)).min(1).optional(),
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type RelevantPagesParams = z.input<typeof relevantPagesParamsSchema>;

/** Doc surprise: the URL field is `page_address`, not `url`. */
const relevantPageItemSchema = z.object({
  page_address: nullableString,
  metrics: labsMetricsBlockSchema.nullish(),
});

export interface RelevantPage {
  /** Absolute URL, scheme included. From `page_address`. */
  url: string | null;
  organic: LabsRankMetrics;
  paid: LabsRankMetrics;
  raw: unknown;
}

export interface RelevantPagesResult extends WrappedMeta {
  items: RelevantPage[];
  totalCount: number | null;
  itemsCount: number | null;
}

/** Filterable/sortable paths on relevant_pages. Flat `metrics.` prefix here. */
export const RELEVANT_PAGES_FIELDS = {
  organicCount: "metrics.organic.count",
  organicEtv: "metrics.organic.etv",
  paidCount: "metrics.paid.count",
  paidEtv: "metrics.paid.etv",
} as const;

/* -------------------------------------------------------------------------- */
/* Competitors                                                                 */
/* -------------------------------------------------------------------------- */

const competitorsDomainParamsSchema = z.object({
  target: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  itemTypes: z.array(z.enum(LABS_ITEM_TYPES)).min(1).optional(),
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type CompetitorsDomainParams = z.input<
  typeof competitorsDomainParamsSchema
>;

/**
 * The trap on this endpoint: it returns TWO metric blocks that look alike and
 * mean different things.
 *
 *  - `full_domain_metrics` — the competitor's own totals, across everything it
 *    ranks for. This is what a "competitor traffic" column should show.
 *  - `metrics` — the TARGET's numbers on the keywords the two share. Reading
 *    this as the competitor's traffic silently reports the wrong domain.
 *
 * Both are surfaced, named for what they are.
 */
const competitorDomainItemSchema = z.object({
  domain: nullableString,
  avg_position: nullableNumber,
  sum_position: nullableNumber,
  intersections: nullableNumber,
  full_domain_metrics: labsMetricsBlockSchema.nullish(),
  metrics: labsMetricsBlockSchema.nullish(),
});

export interface CompetitorDomain {
  domain: string | null;
  /** Keywords this competitor and the target both rank for. */
  intersections: number | null;
  /** Average position over the intersecting keywords only. */
  avgPosition: number | null;
  sumPosition: number | null;
  /** The competitor's own totals. Use this for "their traffic". */
  fullDomain: LabsMetricsBlock;
  /** The TARGET's numbers on the shared keyword set. Not the competitor's. */
  sharedKeywords: LabsMetricsBlock;
  raw: unknown;
}

export interface CompetitorsDomainResult extends WrappedMeta {
  items: CompetitorDomain[];
  totalCount: number | null;
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Intersections (domain + page)                                               */
/* -------------------------------------------------------------------------- */

/**
 * **The hard limit that shapes the whole Gap feature:** domain_intersection
 * compares exactly TWO domains. They are `target1` and `target2` — two
 * separate top-level strings, not a `targets` array and not a numeric-keyed
 * object (page_intersection is the one with the keyed object). There is no
 * third target and no documented way to add one, so comparing a site against
 * four competitors is four pairwise calls merged by the caller.
 */
export const DOMAIN_INTERSECTION_MAX_TARGETS = 2;

/** page_intersection's documented ceilings. */
export const PAGE_INTERSECTION_MAX_PAGES = 20;
export const PAGE_INTERSECTION_MAX_EXCLUDE_PAGES = 10;

/**
 * `intersection_mode` — whether the compared pages must all rank on the same
 * SERP, or merely one of them.
 *
 * The default is conditional and therefore not expressible as a static one:
 * `intersect` when only `pages` is sent, `union` when `exclude_pages` is sent
 * too. The wrapper passes whatever the caller gives it and no more, so silence
 * means DataForSEO's own rule applies.
 */
export const PAGE_INTERSECTION_MODES = ["union", "intersect"] as const;
export type PageIntersectionMode = (typeof PAGE_INTERSECTION_MODES)[number];

const domainIntersectionParamsSchema = z.object({
  /** Bare domains. The docs are explicit: no `https://`, no `www.`. */
  target1: z.string().trim().min(1),
  target2: z.string().trim().min(1),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  /**
   * `true` (their default) → keywords BOTH domains rank for, with a SERP
   * element for each. `false` → keywords `target1` ranks for and `target2`
   * does **not**, with data for `target1` only. That second mode is the entire
   * "competitor ranks, you don't" query, done server-side.
   */
  intersections: z.boolean().optional(),
  itemTypes: z.array(z.enum(LABS_ITEM_TYPES)).min(1).optional(),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type DomainIntersectionParams = z.input<
  typeof domainIntersectionParamsSchema
>;

const pageIntersectionParamsSchema = z.object({
  /**
   * Absolute URLs **including the scheme**. Sent as an object keyed "1".."20";
   * the wrapper builds those keys from this array's order, and the response's
   * `intersection_result` uses the same keys, so position in this array is the
   * identity of a page throughout.
   *
   * A trailing `/*` wildcard matches a section ("example.com/eng/*"). The docs
   * are firm that the wildcard must follow a slash — `https://example.com*` is
   * rejected, `https://example.com/*` is not.
   */
  pages: z.array(z.string().trim().min(1)).min(1).max(PAGE_INTERSECTION_MAX_PAGES),
  /** Keywords the `pages` rank for but these do not. */
  excludePages: z
    .array(z.string().trim().min(1))
    .max(PAGE_INTERSECTION_MAX_EXCLUDE_PAGES)
    .optional(),
  intersectionMode: z.enum(PAGE_INTERSECTION_MODES).optional(),
  /** Their default is `true`; omitted means theirs applies. */
  includeSubdomains: z.boolean().optional(),
  ignoreSynonyms: z.boolean().optional(),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  itemTypes: z.array(z.enum(LABS_ITEM_TYPES)).min(1).optional(),
  limit: z.number().int().min(1).max(LABS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type PageIntersectionParams = z.input<typeof pageIntersectionParamsSchema>;

/**
 * A SERP element on either intersection endpoint.
 *
 * **Doc trap:** the field-description tables show these nested under
 * `organic` / `paid` / `local_pack` / `featured_snippet` keys. The actual
 * response — and every filterable path in their `available_filters` list — is
 * FLAT, with `type` as the discriminator. Parsing the documented nesting finds
 * nothing.
 */
const intersectionSerpElementSchema = z.object({
  type: nullableString,
  /** The ranking. `position` here is the column ("left"/"right"). */
  rank_group: nullableNumber,
  rank_absolute: nullableNumber,
  domain: nullableString,
  main_domain: nullableString,
  title: nullableString,
  url: nullableString,
  relative_url: nullableString,
  description: nullableString,
  etv: nullableNumber,
  estimated_paid_traffic_cost: nullableNumber,
});

export interface IntersectionSerpElement {
  /** "organic" | "paid" | "featured_snippet" | "local_pack". */
  type: string | null;
  /** `rank_group` — the ranking. */
  position: number | null;
  positionAbsolute: number | null;
  domain: string | null;
  mainDomain: string | null;
  title: string | null;
  url: string | null;
  description: string | null;
  /** Estimated monthly visits this ranking brings. */
  etv: number | null;
  estimatedPaidTrafficCostUsd: number | null;
  raw: unknown;
}

const domainIntersectionItemSchema = z.object({
  keyword_data: labsKeywordRowSchema.nullish(),
  /** target1's ranking. */
  first_domain_serp_element: intersectionSerpElementSchema.nullish(),
  /** target2's ranking — null under `intersections: false`, by definition. */
  second_domain_serp_element: intersectionSerpElementSchema.nullish(),
});

export interface DomainIntersectionRow {
  /** Volume, CPC, competition, difficulty and intent for the keyword. */
  keyword: LabsKeywordRow | null;
  /** `target1`'s SERP element. */
  first: IntersectionSerpElement | null;
  /** `target2`'s SERP element. Always null when `intersections: false`. */
  second: IntersectionSerpElement | null;
  raw: unknown;
}

export interface DomainIntersectionResult extends WrappedMeta {
  items: DomainIntersectionRow[];
  totalCount: number | null;
  itemsCount: number | null;
}

const pageIntersectionItemSchema = z.object({
  keyword_data: labsKeywordRowSchema.nullish(),
  /**
   * Keyed by the same "1".."20" strings the request's `pages` object used.
   * The docs' prose calls these "arrays"; they are objects.
   */
  intersection_result: z
    .record(z.string(), intersectionSerpElementSchema.nullish())
    .nullish(),
});

export interface PageIntersectionRow {
  keyword: LabsKeywordRow | null;
  /** Indexed like the `pages` array that was sent, position for position. */
  pages: (IntersectionSerpElement | null)[];
  raw: unknown;
}

export interface PageIntersectionResult extends WrappedMeta {
  items: PageIntersectionRow[];
  totalCount: number | null;
  itemsCount: number | null;
}

/**
 * Filterable/sortable paths shared by both intersection endpoints — the
 * keyword half of a row. Same `keyword_data.` nesting as ranked_keywords.
 */
export const INTERSECTION_KEYWORD_FIELDS = {
  keyword: "keyword_data.keyword",
  searchVolume: "keyword_data.keyword_info.search_volume",
  cpc: "keyword_data.keyword_info.cpc",
  competition: "keyword_data.keyword_info.competition",
  keywordDifficulty: "keyword_data.keyword_properties.keyword_difficulty",
} as const;

/**
 * domain_intersection's per-target paths. Both sides are filterable and
 * sortable, so "the competitor outranks me" is a server-side question.
 *
 * One documented asymmetry, encoded by its absence:
 * `second_domain_serp_element.estimated_paid_traffic_cost` is filterable but
 * `first_domain_serp_element.estimated_paid_traffic_cost` is NOT in their
 * available-filters list. Neither is offered here, so nothing can depend on it.
 */
export const DOMAIN_INTERSECTION_FIELDS = {
  firstType: "first_domain_serp_element.type",
  firstPosition: "first_domain_serp_element.rank_group",
  firstPositionAbsolute: "first_domain_serp_element.rank_absolute",
  firstEtv: "first_domain_serp_element.etv",
  secondType: "second_domain_serp_element.type",
  secondPosition: "second_domain_serp_element.rank_group",
  secondPositionAbsolute: "second_domain_serp_element.rank_absolute",
  secondEtv: "second_domain_serp_element.etv",
} as const;

/**
 * page_intersection's per-page paths, e.g.
 * `intersection_result.2.rank_group`. `page` is 1-based, matching the request
 * keys — filtering "the first URL ranks top 3" needs the page's own number in
 * the path, and there is no wildcard form.
 */
export function pageIntersectionField(page: number, field: string): string {
  return `intersection_result.${page}.${field}`;
}

/* -------------------------------------------------------------------------- */
/* Bulk traffic estimation                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Monthly traffic estimates for up to 1000 targets in one call.
 *
 * Verified against https://docs.dataforseo.com/v3/dataforseo_labs/google/
 * bulk_traffic_estimation/live/ (2026-08-29). Four things about it are not
 * guessable, and every one of them is a silent wrong answer if assumed:
 *
 *  1. **Target formatting is asymmetric.** Verbatim: "domains and subdomains
 *     should be specified without `https://` and `www.`; pages should be
 *     specified with absolute URL, including `https://` and `www.`". So the
 *     scheme is the discriminator, and running a domain normaliser over a page
 *     URL turns a page query into a domain query that quietly answers a
 *     different question. `normalizeTrafficTarget` below encodes exactly this.
 *  2. **Order is not preserved and unknown targets are omitted.** Their own
 *     example returns the three targets re-sorted by descending `etv`, and
 *     `items_count` can be smaller than the number of targets sent. Callers
 *     match on the `target` string; `toTrafficEstimateMap` does it once.
 *  3. **The metrics block is lean.** Only `{etv, count}` per item type — none
 *     of the twelve position buckets the other Labs metric blocks carry — and
 *     an item type that was not requested comes back as `null` rather than
 *     zeroes. Hence its own schema rather than `labsMetricsBlockSchema`.
 *  4. **Price is per task PLUS per item** ($0.012 + $0.00012 each), so a
 *     1000-target call is $0.132 while a 1-target call is $0.01212 — 92× the
 *     per-target rate. Batch as close to the ceiling as the caller can.
 */
const bulkTrafficEstimationParamsSchema = z.object({
  targets: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(BULK_TRAFFIC_ESTIMATION_MAX_TARGETS),
  /**
   * Optional upstream (omitting means "all locations"), but a traffic estimate
   * with no market is not a number this product has a use for — every caller
   * asks about one market — so both are passed through rather than defaulted.
   */
  locationCode: z.number().int().positive().optional(),
  languageCode: z.string().trim().min(2).max(8).optional(),
  itemTypes: z.array(z.enum(LABS_ITEM_TYPES)).min(1).optional(),
  ignoreSynonyms: z.boolean().optional(),
  fresh: z.boolean().optional(),
});

export type BulkTrafficEstimationParams = z.input<
  typeof bulkTrafficEstimationParamsSchema
>;

/** `{etv, count}` and nothing else — see note 3 above. */
const bulkTrafficMetricsSchema = z
  .object({
    etv: nullableNumber,
    count: nullableNumber,
  })
  .nullish();

const bulkTrafficItemSchema = z.object({
  target: nullableString,
  metrics: z
    .object({
      organic: bulkTrafficMetricsSchema,
      paid: bulkTrafficMetricsSchema,
      featured_snippet: bulkTrafficMetricsSchema,
      local_pack: bulkTrafficMetricsSchema,
    })
    .nullish(),
});

/** One item type's estimate. Null throughout when that type was not asked for. */
export interface TrafficEstimateMetrics {
  /** Estimated monthly visits — DataForSEO's `etv`. */
  etv: number | null;
  /** SERPs of this type the target appears in. */
  count: number | null;
}

export interface TrafficEstimate {
  /** Echoed byte-identical to what was sent. The only safe join key. */
  target: string | null;
  organic: TrafficEstimateMetrics;
  paid: TrafficEstimateMetrics;
  featuredSnippet: TrafficEstimateMetrics;
  localPack: TrafficEstimateMetrics;
  raw: unknown;
}

export interface BulkTrafficEstimationResult extends WrappedMeta {
  items: TrafficEstimate[];
  totalCount: number | null;
  itemsCount: number | null;
}

/**
 * The target as this endpoint wants it, per note 1 above.
 *
 * A string carrying a scheme is a **page** and is passed through untouched —
 * lowercasing it would break case-sensitive paths, and stripping `www.` would
 * point at a host that may not serve the same page. Anything else is a domain
 * or subdomain and is flattened to a bare lowercase host.
 */
export function normalizeTrafficTarget(target: string): string {
  const trimmed = target.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .replace(/\.$/, "");
}

/**
 * De-duplicated and sorted, so the same target set asked for in a different
 * order shares one cache entry.
 */
export function normalizeTrafficTargetList(
  targets: readonly string[],
): string[] {
  const seen = new Set<string>();
  for (const target of targets) {
    const normalized = normalizeTrafficTarget(target);
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
}

/**
 * `target` → estimate, which is the only correct way to read this endpoint:
 * results come back reordered, and a target their index has never seen is
 * missing from `items` rather than present with zeroes.
 */
export function toTrafficEstimateMap(
  items: readonly TrafficEstimate[],
): Map<string, TrafficEstimate> {
  const map = new Map<string, TrafficEstimate>();
  for (const item of items) {
    if (item.target !== null) map.set(item.target, item);
  }
  return map;
}

export interface LabsApi {
  googleKeywordOverviewLive(
    params: KeywordOverviewParams,
  ): Promise<KeywordOverviewResult>;
  googleKeywordIdeasLive(params: KeywordIdeasParams): Promise<KeywordIdeasResult>;
  googleKeywordSuggestionsLive(
    params: KeywordSuggestionsParams,
  ): Promise<KeywordSuggestionsResult>;
  googleRelatedKeywordsLive(
    params: RelatedKeywordsParams,
  ): Promise<RelatedKeywordsResult>;
  googleBulkKeywordDifficultyLive(
    params: BulkKeywordDifficultyParams,
  ): Promise<BulkKeywordDifficultyResult>;
  googleSearchIntentLive(params: SearchIntentParams): Promise<SearchIntentResult>;
  googleRankedKeywordsLive(
    params: RankedKeywordsParams,
  ): Promise<RankedKeywordsResult>;
  googleDomainRankOverviewLive(
    params: DomainRankOverviewParams,
  ): Promise<DomainRankOverview>;
  googleHistoricalRankOverviewLive(
    params: HistoricalRankOverviewParams,
  ): Promise<HistoricalRankOverviewResult>;
  googleRelevantPagesLive(
    params: RelevantPagesParams,
  ): Promise<RelevantPagesResult>;
  googleCompetitorsDomainLive(
    params: CompetitorsDomainParams,
  ): Promise<CompetitorsDomainResult>;
  googleDomainIntersectionLive(
    params: DomainIntersectionParams,
  ): Promise<DomainIntersectionResult>;
  googlePageIntersectionLive(
    params: PageIntersectionParams,
  ): Promise<PageIntersectionResult>;
  /**
   * Traffic estimates for up to `BULK_TRAFFIC_ESTIMATION_MAX_TARGETS` domains,
   * subdomains **or page URLs** in one call. Read the header note above
   * `bulkTrafficEstimationParamsSchema` before using it: target formatting is
   * asymmetric and the results come back reordered.
   */
  googleBulkTrafficEstimationLive(
    params: BulkTrafficEstimationParams,
  ): Promise<BulkTrafficEstimationResult>;
}

const keywordIdeasResultSchema = labsWrapperSchema(z.unknown());

export function createLabsApi(client: DataForSeoClient): LabsApi {
  return {
    async googleKeywordOverviewLive(params) {
      const { keywords, locationCode, languageCode, fresh } = parseParams(
        keywordOverviewParamsSchema,
        params,
        `Invalid keyword overview request (max ${KEYWORD_OVERVIEW_MAX_KEYWORDS} keywords, ${KEYWORD_OVERVIEW_MAX_KEYWORD_LENGTH} characters each).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_KEYWORD_OVERVIEW_LIVE,
        payload: [
          {
            // An ARRAY, like keyword_ideas — not the singular `keyword` that
            // keyword_suggestions takes. DataForSEO lowercases these itself;
            // we do it anyway so the cache key does not fork on casing.
            keywords: normalizeKeywordList(keywords),
            location_code: locationCode,
            language_code: languageCode,
            // include_serp_info / include_clickstream_data are deliberately
            // not exposed: neither feeds anything we render, and clickstream
            // doubles the price of the request.
          },
        ],
        // Everything this returns — volume, difficulty, intent — is monthly
        // database data, the same clock as search volume.
        ttl: "long",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_KEYWORD_OVERVIEW_LIVE,
      );
      return {
        items: wrapper.items.map(toLabsKeywordRow),
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleKeywordIdeasLive(params) {
      const {
        keyword,
        locationCode,
        languageCode,
        limit,
        offset,
        filters,
        sorts,
        fresh,
      } = parseParams(
        keywordIdeasParamsSchema,
        params,
        `Invalid keyword ideas request (limit must be 1–${LABS_MAX_LIMIT}).`,
      );

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
            offset,
            filters: toLabsFilters(filters ?? []),
            order_by: toLabsOrderBy(sorts ?? []),
          },
        ],
        // Ideas are derived from search volume and move on the same clock.
        ttl: "long",
        fresh,
      });

      const wrapper = parseWrapper(response.results[0], GOOGLE_KEYWORD_IDEAS_LIVE);
      return {
        items: wrapper.items.map(toLabsKeywordRow),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleKeywordSuggestionsLive(params) {
      const {
        keyword,
        locationCode,
        languageCode,
        limit,
        offset,
        filters,
        sorts,
        fresh,
      } = parseParams(
        keywordSuggestionsParamsSchema,
        params,
        `Invalid keyword suggestions request (limit must be 1–${LABS_MAX_LIMIT}).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_KEYWORD_SUGGESTIONS_LIVE,
        payload: [
          {
            // SINGULAR here. keyword_ideas takes `keywords: [...]`.
            keyword: keyword.toLowerCase(),
            location_code: locationCode,
            language_code: languageCode,
            limit,
            offset,
            filters: toLabsFilters(filters ?? []),
            order_by: toLabsOrderBy(sorts ?? []),
          },
        ],
        // Suggestions are a text match over the same keyword database, and
        // ARCHITECTURE.md puts suggestions/related in the 14-day bucket.
        ttl: "medium",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_KEYWORD_SUGGESTIONS_LIVE,
      );
      return {
        items: wrapper.items.map(toLabsKeywordRow),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleRelatedKeywordsLive(params) {
      const {
        keyword,
        locationCode,
        languageCode,
        depth,
        limit,
        offset,
        filters,
        sorts,
        fresh,
      } = parseParams(
        relatedKeywordsParamsSchema,
        params,
        `Invalid related keywords request (depth must be 0–${RELATED_KEYWORDS_MAX_DEPTH}, limit 1–${LABS_MAX_LIMIT}).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_RELATED_KEYWORDS_LIVE,
        payload: [
          {
            keyword: keyword.toLowerCase(),
            location_code: locationCode,
            language_code: languageCode,
            depth,
            limit,
            offset,
            filters: toLabsFilters(filters ?? []),
            order_by: toLabsOrderBy(sorts ?? []),
          },
        ],
        ttl: "medium",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_RELATED_KEYWORDS_LIVE,
      );
      return {
        items: wrapper.items.map(toRelatedKeyword),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleBulkKeywordDifficultyLive(params) {
      const { keywords, locationCode, languageCode, fresh } = parseParams(
        bulkKeywordDifficultyParamsSchema,
        params,
        `Invalid bulk difficulty request (max ${LABS_MAX_BULK_KEYWORDS} keywords).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_BULK_KEYWORD_DIFFICULTY_LIVE,
        payload: [
          {
            keywords: normalizeKeywordList(keywords),
            location_code: locationCode,
            language_code: languageCode,
          },
        ],
        // Difficulty is derived from the same SERP data as ranked keywords.
        ttl: "short",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_BULK_KEYWORD_DIFFICULTY_LIVE,
      );
      return {
        items: wrapper.items.map((raw) => {
          const item = bulkKeywordDifficultyItemSchema.parse(raw);
          return {
            keyword: item.keyword,
            keywordDifficulty: item.keyword_difficulty,
          };
        }),
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleSearchIntentLive(params) {
      const { keywords, languageCode, fresh } = parseParams(
        searchIntentParamsSchema,
        params,
        `Invalid search intent request (max ${LABS_MAX_BULK_KEYWORDS} keywords).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_SEARCH_INTENT_LIVE,
        payload: [
          {
            keywords: normalizeKeywordList(keywords),
            // No location_code: this endpoint does not accept one.
            language_code: languageCode,
          },
        ],
        // Intent is a property of the phrase, not of the market — it changes
        // about as often as search volume does.
        ttl: "long",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_SEARCH_INTENT_LIVE,
      );
      return {
        items: wrapper.items.map(toKeywordIntent),
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleRankedKeywordsLive(params) {
      const {
        target,
        locationCode,
        languageCode,
        limit,
        offset,
        itemTypes,
        filters,
        sorts,
        fresh,
      } = parseParams(
        rankedKeywordsParamsSchema,
        params,
        `Invalid ranked keywords request (limit must be 1–${LABS_MAX_LIMIT}).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_RANKED_KEYWORDS_LIVE,
        payload: [
          {
            target: normalizeTarget(target),
            location_code: locationCode,
            language_code: languageCode,
            limit,
            offset,
            item_types: itemTypes,
            filters: toLabsFilters(filters ?? []),
            order_by: toLabsOrderBy(sorts ?? []),
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
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleDomainRankOverviewLive(params) {
      const { target, locationCode, languageCode, fresh } = parseParams(
        domainRankOverviewParamsSchema,
        params,
        "Invalid domain overview request.",
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_DOMAIN_RANK_OVERVIEW_LIVE,
        payload: [
          {
            target: normalizeTarget(target),
            location_code: locationCode,
            language_code: languageCode,
          },
        ],
        ttl: "short",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_DOMAIN_RANK_OVERVIEW_LIVE,
      );

      // One market, one row. An unknown domain comes back with an empty
      // `items` rather than an error, so zeroed metrics are the honest answer.
      const raw = wrapper.items[0] ?? null;
      const item = raw === null ? null : domainRankOverviewItemSchema.parse(raw);
      const metrics = toLabsMetricsBlock(item?.metrics);
      return {
        locationCode: item?.location_code ?? locationCode,
        languageCode: item?.language_code ?? languageCode,
        organic: metrics.organic,
        paid: metrics.paid,
        raw,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleHistoricalRankOverviewLive(params) {
      const { target, locationCode, languageCode, dateFrom, dateTo, fresh } =
        parseParams(
          historicalRankOverviewParamsSchema,
          params,
          "Invalid historical overview request (dates must be yyyy-mm-dd).",
        );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_HISTORICAL_RANK_OVERVIEW_LIVE,
        payload: [
          {
            target: normalizeTarget(target),
            location_code: locationCode,
            language_code: languageCode,
            date_from: dateFrom,
            date_to: dateTo,
          },
        ],
        // A monthly series; ARCHITECTURE.md puts historical/timeseries at 30d.
        ttl: "long",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_HISTORICAL_RANK_OVERVIEW_LIVE,
      );
      return {
        items: wrapper.items.map(toHistoricalRankPoint),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleRelevantPagesLive(params) {
      const {
        target,
        locationCode,
        languageCode,
        limit,
        offset,
        itemTypes,
        filters,
        sorts,
        fresh,
      } = parseParams(
        relevantPagesParamsSchema,
        params,
        `Invalid relevant pages request (limit must be 1–${LABS_MAX_LIMIT}).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_RELEVANT_PAGES_LIVE,
        payload: [
          {
            target: normalizeTarget(target),
            location_code: locationCode,
            language_code: languageCode,
            limit,
            offset,
            item_types: itemTypes,
            filters: toLabsFilters(filters ?? []),
            order_by: toLabsOrderBy(sorts ?? []),
          },
        ],
        ttl: "short",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_RELEVANT_PAGES_LIVE,
      );
      return {
        items: wrapper.items.map(toRelevantPage),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleCompetitorsDomainLive(params) {
      const {
        target,
        locationCode,
        languageCode,
        limit,
        offset,
        itemTypes,
        filters,
        sorts,
        fresh,
      } = parseParams(
        competitorsDomainParamsSchema,
        params,
        `Invalid competitors request (limit must be 1–${LABS_MAX_LIMIT}).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_COMPETITORS_DOMAIN_LIVE,
        payload: [
          {
            target: normalizeTarget(target),
            location_code: locationCode,
            language_code: languageCode,
            limit,
            offset,
            item_types: itemTypes,
            filters: toLabsFilters(filters ?? []),
            order_by: toLabsOrderBy(sorts ?? []),
          },
        ],
        ttl: "short",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_COMPETITORS_DOMAIN_LIVE,
      );
      return {
        items: wrapper.items.map(toCompetitorDomain),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleDomainIntersectionLive(params) {
      const {
        target1,
        target2,
        locationCode,
        languageCode,
        intersections,
        itemTypes,
        limit,
        offset,
        filters,
        sorts,
        fresh,
      } = parseParams(
        domainIntersectionParamsSchema,
        params,
        `Invalid domain intersection request (limit must be 1–${LABS_MAX_LIMIT}).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_DOMAIN_INTERSECTION_LIVE,
        payload: [
          {
            // Two flat strings. There is no third target on this endpoint.
            target1: normalizeTarget(target1),
            target2: normalizeTarget(target2),
            location_code: locationCode,
            language_code: languageCode,
            intersections,
            item_types: itemTypes,
            limit,
            offset,
            filters: toLabsFilters(filters ?? []),
            order_by: toLabsOrderBy(sorts ?? []),
          },
        ],
        // Rankings, the same 7-day bucket as ranked_keywords.
        ttl: "short",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_DOMAIN_INTERSECTION_LIVE,
      );
      return {
        items: wrapper.items.map(toDomainIntersectionRow),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googlePageIntersectionLive(params) {
      const {
        pages,
        excludePages,
        intersectionMode,
        includeSubdomains,
        ignoreSynonyms,
        locationCode,
        languageCode,
        itemTypes,
        limit,
        offset,
        filters,
        sorts,
        fresh,
      } = parseParams(
        pageIntersectionParamsSchema,
        params,
        `Invalid page intersection request (max ${PAGE_INTERSECTION_MAX_PAGES} pages, limit 1–${LABS_MAX_LIMIT}).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_PAGE_INTERSECTION_LIVE,
        payload: [
          {
            // An OBJECT keyed "1".."20", not an array — the one place in this
            // file where a list goes on the wire as numbered keys.
            pages: toNumberedPages(pages),
            // ...while `exclude_pages` really is a plain array. Not symmetric.
            exclude_pages: excludePages,
            intersection_mode: intersectionMode,
            include_subdomains: includeSubdomains,
            ignore_synonyms: ignoreSynonyms,
            location_code: locationCode,
            language_code: languageCode,
            item_types: itemTypes,
            limit,
            offset,
            filters: toLabsFilters(filters ?? []),
            order_by: toLabsOrderBy(sorts ?? []),
          },
        ],
        ttl: "short",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_PAGE_INTERSECTION_LIVE,
      );
      return {
        items: wrapper.items.map((raw) => toPageIntersectionRow(raw, pages.length)),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },

    async googleBulkTrafficEstimationLive(params) {
      const {
        targets,
        locationCode,
        languageCode,
        itemTypes,
        ignoreSynonyms,
        fresh,
      } = parseParams(
        bulkTrafficEstimationParamsSchema,
        params,
        `Invalid traffic estimation request (max ${BULK_TRAFFIC_ESTIMATION_MAX_TARGETS} targets).`,
      );

      const response = await client.request<unknown>({
        endpoint: GOOGLE_BULK_TRAFFIC_ESTIMATION_LIVE,
        payload: [
          {
            // NOT `normalizeTarget` — that one flattens everything to a
            // hostname, which would silently turn every page target into a
            // domain query. See note 1 on the params schema.
            targets: normalizeTrafficTargetList(targets),
            location_code: locationCode,
            language_code: languageCode,
            item_types: itemTypes,
            ignore_synonyms: ignoreSynonyms,
          },
        ],
        // A traffic estimate is derived from the same ranking database as
        // ranked_keywords and domain_rank_overview, so it moves on the same
        // clock and belongs in the same 7-day bucket.
        ttl: "short",
        fresh,
      });

      const wrapper = parseWrapper(
        response.results[0],
        GOOGLE_BULK_TRAFFIC_ESTIMATION_LIVE,
      );
      return {
        items: wrapper.items.map(toTrafficEstimate),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
        fetchedAtMs: response.fetchedAt,
      };
    },
  };
}

function toTrafficEstimateMetrics(
  raw: { etv: number | null; count: number | null } | null | undefined,
): TrafficEstimateMetrics {
  return { etv: raw?.etv ?? null, count: raw?.count ?? null };
}

function toTrafficEstimate(raw: unknown): TrafficEstimate {
  const item = bulkTrafficItemSchema.parse(raw);
  const metrics = item.metrics;
  return {
    target: item.target,
    organic: toTrafficEstimateMetrics(metrics?.organic),
    paid: toTrafficEstimateMetrics(metrics?.paid),
    // Null upstream unless the item type was requested — nulls here, not zeroes,
    // so "not asked for" never renders as "no featured snippets".
    featuredSnippet: toTrafficEstimateMetrics(metrics?.featured_snippet),
    localPack: toTrafficEstimateMetrics(metrics?.local_pack),
    raw,
  };
}

/**
 * `["a", "b"]` → `{ "1": "a", "2": "b" }`.
 *
 * The keys are 1-based strings because that is what `intersection_result` uses
 * to report each page's ranking, and what a filter path has to name
 * (`intersection_result.2.rank_group`). Keeping the array's order as the key
 * order is what lets the route map results back to the URLs it was asked about.
 */
export function toNumberedPages(pages: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  pages.forEach((page, index) => {
    out[String(index + 1)] = page.trim();
  });
  return out;
}

function toIntersectionSerpElement(
  raw: z.infer<typeof intersectionSerpElementSchema> | null | undefined,
  original: unknown,
): IntersectionSerpElement | null {
  if (!raw) return null;
  return {
    type: raw.type,
    // `rank_group` is the ranking; `position` is the SERP column.
    position: raw.rank_group,
    positionAbsolute: raw.rank_absolute,
    domain: raw.domain,
    mainDomain: raw.main_domain,
    title: raw.title,
    url: raw.url,
    description: raw.description,
    etv: raw.etv,
    estimatedPaidTrafficCostUsd: raw.estimated_paid_traffic_cost,
    raw: original,
  };
}

function toDomainIntersectionRow(raw: unknown): DomainIntersectionRow {
  const item = domainIntersectionItemSchema.parse(raw);
  const source = raw as Record<string, unknown> | null;
  return {
    keyword: item.keyword_data
      ? fromKeywordRow(item.keyword_data, source?.["keyword_data"])
      : null,
    first: toIntersectionSerpElement(
      item.first_domain_serp_element,
      source?.["first_domain_serp_element"],
    ),
    second: toIntersectionSerpElement(
      item.second_domain_serp_element,
      source?.["second_domain_serp_element"],
    ),
    raw,
  };
}

/**
 * Turns `intersection_result`'s numbered keys back into an array positioned
 * like the `pages` the caller sent, so index 0 is always page 1. A page that
 * does not rank for this keyword is `null` in its slot rather than missing,
 * which is what keeps a table column aligned.
 */
function toPageIntersectionRow(raw: unknown, pageCount: number): PageIntersectionRow {
  const item = pageIntersectionItemSchema.parse(raw);
  const source = raw as Record<string, unknown> | null;
  const results = item.intersection_result ?? {};
  const rawResults = (source?.["intersection_result"] ?? {}) as Record<
    string,
    unknown
  >;

  const pages: (IntersectionSerpElement | null)[] = [];
  for (let index = 0; index < pageCount; index += 1) {
    const key = String(index + 1);
    pages.push(toIntersectionSerpElement(results[key], rawResults[key]));
  }

  return {
    keyword: item.keyword_data
      ? fromKeywordRow(item.keyword_data, source?.["keyword_data"])
      : null,
    pages,
    raw,
  };
}

/**
 * Validate-or-throw, in the shape every wrapper above needs. Keeps the
 * `validation_failed` code and the flattened zod detail identical across ten
 * endpoints instead of ten near-copies drifting apart.
 */
function parseParams<S extends z.ZodType>(
  schema: S,
  params: unknown,
  message: string,
): z.infer<S> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ApiException(
      "validation_failed",
      message,
      z.flattenError(parsed.error),
    );
  }
  return parsed.data;
}

/**
 * Lowercased, de-duplicated, sorted — the same normalisation the Google Ads
 * wrapper applies, and for the same reason: DataForSEO requires lowercase, and
 * sorting is what lets one set of keywords hit one cache entry regardless of
 * the order the caller happened to collect them in.
 */
export function normalizeKeywordList(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
}

/** `YYYY-MM` from the API's separate integer year/month, or null. */
export function toIsoMonth(
  year: number | null,
  month: number | null,
): string | null {
  if (year === null || month === null) return null;
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
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

/** The flat row: keyword_ideas and keyword_suggestions items, verbatim. */
function toLabsKeywordRow(raw: unknown): LabsKeywordRow {
  return fromKeywordRow(labsKeywordRowSchema.parse(raw), raw);
}

/** Shared tail, so the wrapped and flat rows cannot drift apart. */
function fromKeywordRow(
  item: z.infer<typeof labsKeywordRowSchema>,
  raw: unknown,
): LabsKeywordRow {
  return {
    keyword: item.keyword,
    locationCode: item.location_code,
    languageCode: item.language_code,
    metrics: toLabsKeywordMetrics(item.keyword_info),
    keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
    mainIntent: item.search_intent_info?.main_intent ?? null,
    secondaryIntents: item.search_intent_info?.foreign_intent ?? [],
    raw,
  };
}

/**
 * related_keywords' row, flattened to the same surface as every other keyword
 * row so the UI does not have to know which endpoint produced it — the
 * `keyword_data` indirection stops here.
 */
function toRelatedKeyword(raw: unknown): RelatedKeyword {
  const item = relatedKeywordItemSchema.parse(raw);
  return {
    ...fromKeywordRow(item.keyword_data, raw),
    depth: item.depth,
    relatedKeywords: item.related_keywords,
  };
}

function toKeywordIntent(raw: unknown): KeywordIntent {
  const item = searchIntentItemSchema.parse(raw);
  return {
    keyword: item.keyword,
    intent: item.keyword_intent?.label ?? null,
    probability: item.keyword_intent?.probability ?? null,
    secondary: item.secondary_keyword_intents.map((entry) => ({
      intent: entry.label,
      probability: entry.probability,
    })),
  };
}

function toHistoricalRankPoint(raw: unknown): HistoricalRankPoint {
  const item = historicalRankOverviewItemSchema.parse(raw);
  const metrics = toLabsMetricsBlock(item.metrics);
  return {
    year: item.year,
    month: item.month,
    period: toIsoMonth(item.year, item.month),
    organic: metrics.organic,
    paid: metrics.paid,
  };
}

function toRelevantPage(raw: unknown): RelevantPage {
  const item = relevantPageItemSchema.parse(raw);
  const metrics = toLabsMetricsBlock(item.metrics);
  return {
    // `page_address`, not `url` — see relevantPageItemSchema.
    url: item.page_address,
    organic: metrics.organic,
    paid: metrics.paid,
    raw,
  };
}

function toCompetitorDomain(raw: unknown): CompetitorDomain {
  const item = competitorDomainItemSchema.parse(raw);
  return {
    domain: item.domain,
    intersections: item.intersections,
    avgPosition: item.avg_position,
    sumPosition: item.sum_position,
    fullDomain: toLabsMetricsBlock(item.full_domain_metrics),
    sharedKeywords: toLabsMetricsBlock(item.metrics),
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
