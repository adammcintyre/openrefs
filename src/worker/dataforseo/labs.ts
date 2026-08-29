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
      };
    },
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
