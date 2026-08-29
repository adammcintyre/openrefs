/**
 * Shared zod pieces for parsing DataForSEO payloads.
 *
 * Two rules hold across every wrapper:
 *
 * 1. **Parse only what we consume.** DataForSEO items carry dozens of fields
 *    and grow new ones without notice; validating all of them would turn their
 *    release notes into our outages. Everything else rides along untouched on
 *    the `raw` field of each parsed item.
 * 2. **Be generous about absence, strict about type.** Their API returns
 *    `null` for unknown metrics and omits keys entirely on some plans, so
 *    optional-and-nullable is the norm and everything normalises to `null`.
 *    A field that is present but the wrong *type* is still a real change we
 *    want to hear about.
 */
import { z } from "zod";

/** `number | null | undefined | absent` -> `number | null`. */
export const nullableNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? null);

/** `string | null | undefined | absent` -> `string | null`. */
export const nullableString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

/**
 * Google Ads reports competition as a bucket string; DataForSEO Labs reports
 * the same idea as a 0–1 float plus a `competition_level` string. Doc surprise
 * worth restating at the type level: same word, two shapes, two endpoints.
 */
export const COMPETITION_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type CompetitionLevel = (typeof COMPETITION_LEVELS)[number];

/**
 * `.catch(null)` rather than a hard failure: a new bucket name would be a
 * cosmetic gap in one column, not a reason to fail a paid request the user
 * has already been billed for.
 */
export const competitionLevel = z
  .enum(COMPETITION_LEVELS)
  .nullish()
  .catch(null)
  .transform((v) => v ?? null);

export const monthlySearchSchema = z.object({
  year: nullableNumber,
  month: nullableNumber,
  search_volume: nullableNumber,
});

export interface MonthlySearch {
  year: number | null;
  month: number | null;
  searchVolume: number | null;
}

export function toMonthlySearches(
  rows: readonly z.infer<typeof monthlySearchSchema>[] | null | undefined,
): MonthlySearch[] {
  return (rows ?? []).map((row) => ({
    year: row.year,
    month: row.month,
    searchVolume: row.search_volume,
  }));
}

export const monthlySearches = z
  .array(monthlySearchSchema)
  .nullish()
  .transform((v) => v ?? []);

/**
 * The metric block Labs attaches to a keyword, at
 * `keyword_info` on both keyword_ideas items and ranked_keywords'
 * `keyword_data`.
 */
export const labsKeywordInfoSchema = z.object({
  search_volume: nullableNumber,
  cpc: nullableNumber,
  /** Labs: a 0–1 float. The bucket string is `competition_level`. */
  competition: nullableNumber,
  competition_level: competitionLevel,
  low_top_of_page_bid: nullableNumber,
  high_top_of_page_bid: nullableNumber,
  monthly_searches: monthlySearches,
});

export interface LabsKeywordMetrics {
  searchVolume: number | null;
  cpc: number | null;
  /** 0–1. Not the same scale as Google Ads' `competition` string. */
  competition: number | null;
  competitionLevel: CompetitionLevel | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  monthlySearches: MonthlySearch[];
}

export function toLabsKeywordMetrics(
  info: z.infer<typeof labsKeywordInfoSchema> | null | undefined,
): LabsKeywordMetrics {
  return {
    searchVolume: info?.search_volume ?? null,
    cpc: info?.cpc ?? null,
    competition: info?.competition ?? null,
    competitionLevel: info?.competition_level ?? null,
    lowTopOfPageBid: info?.low_top_of_page_bid ?? null,
    highTopOfPageBid: info?.high_top_of_page_bid ?? null,
    monthlySearches: toMonthlySearches(info?.monthly_searches),
  };
}

/**
 * Keyword difficulty lives at `keyword_properties.keyword_difficulty` — not
 * under `keyword_info`, and not in either `keyword_info_normalized_*` block.
 */
export const keywordPropertiesSchema = z.object({
  keyword_difficulty: nullableNumber,
  detected_language: nullableString,
});

export const searchIntentInfoSchema = z.object({
  main_intent: nullableString,
  foreign_intent: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
});

/**
 * Every Labs "live" endpoint returns `result` as an array holding exactly one
 * wrapper object; the rows are inside its `items`. (Google Ads search_volume,
 * by contrast, returns the rows directly — hence two shapes in one API.)
 */
export function labsWrapperSchema<TItem extends z.ZodTypeAny>(item: TItem) {
  return z.object({
    total_count: nullableNumber,
    items_count: nullableNumber,
    offset: nullableNumber,
    items: z
      .array(item)
      .nullish()
      .transform((v) => v ?? []),
  });
}

/** Common tail on every wrapper's return value. */
export interface WrappedMeta {
  /** USD billed for this call. Zero on a cache hit. */
  costUsd: number;
  cached: boolean;
}

/* -------------------------------------------------------------------------- */
/* Domain rank metrics                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The metric block Labs attaches to a domain or a page, verified identical
 * across domain_rank_overview, historical_rank_overview, relevant_pages and
 * competitors_domain (2026-08-29). Twelve position buckets plus five rollups.
 *
 * `etv` — "estimated traffic volume" — is DataForSEO's monthly organic traffic
 * estimate for the set, and is what the UI shows as "traffic". `count` is the
 * number of ranking keywords. `estimated_paid_traffic_cost` is what that
 * traffic would cost to buy, and is present on the organic block too (that is
 * the point of it: the value of the free traffic).
 */
export const labsRankMetricsSchema = z.object({
  pos_1: nullableNumber,
  pos_2_3: nullableNumber,
  pos_4_10: nullableNumber,
  pos_11_20: nullableNumber,
  pos_21_30: nullableNumber,
  pos_31_40: nullableNumber,
  pos_41_50: nullableNumber,
  pos_51_60: nullableNumber,
  pos_61_70: nullableNumber,
  pos_71_80: nullableNumber,
  pos_81_90: nullableNumber,
  pos_91_100: nullableNumber,
  etv: nullableNumber,
  count: nullableNumber,
  estimated_paid_traffic_cost: nullableNumber,
  is_new: nullableNumber,
  is_up: nullableNumber,
  is_down: nullableNumber,
  is_lost: nullableNumber,
});

/** Keyword counts by SERP position band. Keys are the band, values the count. */
export interface RankPositionBuckets {
  pos1: number | null;
  pos2to3: number | null;
  pos4to10: number | null;
  pos11to20: number | null;
  pos21to30: number | null;
  pos31to40: number | null;
  pos41to50: number | null;
  pos51to60: number | null;
  pos61to70: number | null;
  pos71to80: number | null;
  pos81to90: number | null;
  pos91to100: number | null;
}

export interface LabsRankMetrics {
  /** Ranking keywords in this set. */
  count: number | null;
  /** Estimated monthly traffic. DataForSEO's `etv`. */
  etv: number | null;
  /** What that traffic would cost to buy, USD/month. */
  estimatedPaidTrafficCostUsd: number | null;
  positions: RankPositionBuckets;
  /** Movement since the previous crawl. */
  isNew: number | null;
  isUp: number | null;
  isDown: number | null;
  isLost: number | null;
}

export function toLabsRankMetrics(
  metrics: z.infer<typeof labsRankMetricsSchema> | null | undefined,
): LabsRankMetrics {
  return {
    count: metrics?.count ?? null,
    etv: metrics?.etv ?? null,
    estimatedPaidTrafficCostUsd: metrics?.estimated_paid_traffic_cost ?? null,
    positions: {
      pos1: metrics?.pos_1 ?? null,
      pos2to3: metrics?.pos_2_3 ?? null,
      pos4to10: metrics?.pos_4_10 ?? null,
      pos11to20: metrics?.pos_11_20 ?? null,
      pos21to30: metrics?.pos_21_30 ?? null,
      pos31to40: metrics?.pos_31_40 ?? null,
      pos41to50: metrics?.pos_41_50 ?? null,
      pos51to60: metrics?.pos_51_60 ?? null,
      pos61to70: metrics?.pos_61_70 ?? null,
      pos71to80: metrics?.pos_71_80 ?? null,
      pos81to90: metrics?.pos_81_90 ?? null,
      pos91to100: metrics?.pos_91_100 ?? null,
    },
    isNew: metrics?.is_new ?? null,
    isUp: metrics?.is_up ?? null,
    isDown: metrics?.is_down ?? null,
    isLost: metrics?.is_lost ?? null,
  };
}

/**
 * The `metrics` container. `organic` and `paid` are always present;
 * `featured_snippet` and `local_pack` appear on the page/competitor endpoints,
 * which is why they are optional rather than assumed.
 */
export const labsMetricsBlockSchema = z.object({
  organic: labsRankMetricsSchema.nullish(),
  paid: labsRankMetricsSchema.nullish(),
  featured_snippet: labsRankMetricsSchema.nullish(),
  local_pack: labsRankMetricsSchema.nullish(),
});

export interface LabsMetricsBlock {
  organic: LabsRankMetrics;
  paid: LabsRankMetrics;
}

export function toLabsMetricsBlock(
  block: z.infer<typeof labsMetricsBlockSchema> | null | undefined,
): LabsMetricsBlock {
  return {
    organic: toLabsRankMetrics(block?.organic),
    paid: toLabsRankMetrics(block?.paid),
  };
}
