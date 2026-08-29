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
