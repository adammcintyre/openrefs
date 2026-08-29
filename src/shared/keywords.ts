/**
 * Keyword Research response types — the contract between the Worker's
 * `/api/v1/keywords/*` routes and the SPA.
 *
 * Two conventions hold throughout, and both are deliberate:
 *
 * 1. **`null` means "DataForSEO did not tell us", never "zero".** A keyword
 *    with no volume data and a keyword with zero searches are different facts,
 *    and only one of them should render as "0". Every metric is nullable for
 *    this reason; the UI should show an em dash for null.
 * 2. **One row shape across all three keyword tabs.** Ideas, suggestions and
 *    related come back from three endpoints with three different wire shapes
 *    (see src/worker/dataforseo/labs.ts); the Worker flattens all of them to
 *    `KeywordRow` so a single table component serves all three.
 */
import type { ResultMeta } from "./api";

export type { ResultMeta };

/** Google Ads' competition bucket. The 0–1 float is `competition`. */
export type CompetitionLevel = "LOW" | "MEDIUM" | "HIGH";

/**
 * DataForSEO's four intent labels. Typed as a union plus `string` because the
 * label is theirs to extend — narrowing hard would turn a new label into a
 * crash instead of an unstyled chip.
 */
export type KeywordIntentLabel =
  | "informational"
  | "navigational"
  | "commercial"
  | "transactional"
  | (string & {});

/** One month of search volume. `period` is derived, `YYYY-MM`. */
export interface MonthlyVolumePoint {
  year: number | null;
  month: number | null;
  /** `YYYY-MM`, or null when the API sent an unusable year/month pair. */
  period: string | null;
  searchVolume: number | null;
}

/** The metric set every keyword table column reads. */
export interface KeywordRow {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  /** 0–1. */
  competition: number | null;
  competitionLevel: CompetitionLevel | null;
  /** 0–100. Badge-coloured in the UI. */
  keywordDifficulty: number | null;
  intent: KeywordIntentLabel | null;
  /**
   * Only populated by `/keywords/related`, which returns a graph rather than a
   * list: how many hops from the seed this keyword sits.
   */
  depth?: number | null;
  /**
   * Only populated by `/keywords/related`: sibling keywords as plain strings,
   * for an "expand this branch" affordance.
   */
  relatedKeywords?: string[];
}

/**
 * GET /api/v1/keywords/overview
 *
 * Fans out to three upstream endpoints (search volume, bulk difficulty, search
 * intent) and merges them, so any one of them being unavailable leaves its
 * fields null rather than failing the request.
 */
export interface KeywordOverviewResponse extends ResultMeta {
  keyword: string;
  locationCode: number;
  languageCode: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: CompetitionLevel | null;
  /** Low/high end of the top-of-page bid range, USD. */
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
  /** 0–100. */
  keywordDifficulty: number | null;
  intent: KeywordIntentLabel | null;
  /** 0–1 confidence in `intent`. */
  intentProbability: number | null;
  /** Runner-up intents, strongest first. Often empty. */
  secondaryIntents: { intent: KeywordIntentLabel | null; probability: number | null }[];
  /** Up to 12 months, oldest first — the TrendLineChart's series. */
  monthlySearches: MonthlyVolumePoint[];
}

/**
 * The paged list shape shared by /ideas, /suggestions and /related.
 *
 * `totalCount` is how many exist upstream, `itemsCount` how many this page
 * holds. "Load more" advances `offset` by `limit` and stops when
 * `offset + items.length >= totalCount`.
 */
export interface KeywordListResponse extends ResultMeta {
  keyword: string;
  locationCode: number;
  languageCode: string;
  items: KeywordRow[];
  totalCount: number | null;
  itemsCount: number | null;
  limit: number;
  offset: number;
}

/** One organic result in the SERP panel. */
export interface SerpRow {
  /** Organic rank. Not the SERP column — see the wrapper's notes. */
  position: number | null;
  /** Rank counting every SERP element, features included. */
  positionAbsolute: number | null;
  title: string | null;
  url: string | null;
  domain: string | null;
  description: string | null;
  breadcrumb: string | null;
}

/**
 * GET /api/v1/keywords/serp
 *
 * `serpFeatures` is DataForSEO's own list of every feature type on the page
 * (`organic`, `people_also_ask`, `ai_overview`, …) — the chip row. It is not
 * derived from `items`, which holds organic results only.
 */
export interface KeywordSerpResponse extends ResultMeta {
  keyword: string | null;
  locationCode: number;
  languageCode: string;
  /** The Google URL this SERP was read from. */
  checkUrl: string | null;
  /** When DataForSEO fetched it — the age shown next to Refresh. */
  fetchedAt: string | null;
  serpFeatures: string[];
  /** Google's "about N results". */
  totalResults: number | null;
  items: SerpRow[];
}

/** GET /api/v1/meta/locations — one selectable market. */
export interface MetaLocationOption {
  /** Pass this as `location` on every other endpoint. */
  code: number;
  name: string | null;
  /** ISO 3166-1 alpha-2, e.g. "GB". */
  countryIsoCode: string | null;
  /**
   * Languages valid for THIS location. Pairing a language from outside this
   * list with this location is an upstream error, so the language select
   * should be driven by the chosen location rather than by the global list.
   */
  languages: { code: string; name: string | null }[];
}

export interface MetaLocationsResponse extends ResultMeta {
  locations: MetaLocationOption[];
}

/** GET /api/v1/meta/languages — the global list, for display names. */
export interface MetaLanguageOption {
  /** ISO 639-1, e.g. "en". Pass as `language`. */
  code: string;
  name: string | null;
}

export interface MetaLanguagesResponse extends ResultMeta {
  languages: MetaLanguageOption[];
}
