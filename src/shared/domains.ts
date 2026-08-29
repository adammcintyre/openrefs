/**
 * Domain Overview response types — the contract between the Worker's
 * `/api/v1/domains/*` routes and the SPA.
 *
 * Same two conventions as keywords.ts: `null` means "not reported", never
 * zero; and the Worker flattens DataForSEO's nesting so the UI reads one
 * shape. The vocabulary here follows CLAUDE.md's trademark rules — this is
 * Domain Overview, and the 0–100 site metric (when the Backlinks module lands)
 * is Domain Score.
 */
import type { ResultMeta } from "./api";
import type { CompetitionLevel, KeywordIntentLabel } from "./keywords";

export type { ResultMeta };

/** Keyword counts by SERP position band. */
export interface PositionBuckets {
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

/**
 * One side (organic or paid) of a domain's or page's ranking profile.
 *
 * `traffic` is DataForSEO's `etv` — an *estimate* of monthly visits, not
 * measured analytics, and the UI should say "est." wherever it appears.
 * `trafficValueUsd` is what buying that traffic would cost, which is the more
 * meaningful number for the organic side.
 */
export interface RankMetrics {
  /** Ranking keywords. */
  keywordCount: number | null;
  /** Estimated monthly visits. */
  traffic: number | null;
  /** USD/month the same traffic would cost as ads. */
  trafficValueUsd: number | null;
  positions: PositionBuckets;
  /** Movement since the previous crawl. */
  isNew: number | null;
  isUp: number | null;
  isDown: number | null;
  isLost: number | null;
}

/** GET /api/v1/domains/overview — the MetricCard strip. */
export interface DomainOverviewResponse extends ResultMeta {
  domain: string;
  locationCode: number;
  languageCode: string;
  organic: RankMetrics;
  paid: RankMetrics;
}

/** One month of a domain's history. */
export interface DomainHistoryPoint {
  year: number | null;
  month: number | null;
  /** `YYYY-MM`, derived — the upstream sends only the two integers. */
  period: string | null;
  organic: RankMetrics;
  paid: RankMetrics;
}

/** GET /api/v1/domains/history — the traffic TrendLineChart, oldest first. */
export interface DomainHistoryResponse extends ResultMeta {
  domain: string;
  locationCode: number;
  languageCode: string;
  items: DomainHistoryPoint[];
}

/** One row of the Top keywords tab. */
export interface DomainKeywordRow {
  keyword: string | null;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: CompetitionLevel | null;
  keywordDifficulty: number | null;
  intent?: KeywordIntentLabel | null;
  /** The domain's rank for this keyword. */
  position: number | null;
  positionAbsolute: number | null;
  /** The ranking page. */
  url: string | null;
  title: string | null;
  /** "organic" | "paid" | "featured_snippet" | "local_pack" | … */
  serpItemType: string | null;
  /** Estimated monthly visits this one ranking brings. */
  traffic: number | null;
}

/**
 * GET /api/v1/domains/keywords
 *
 * **Param quirk that matters:** `paid=true` does not filter a shared result
 * set — it changes what is *fetched* upstream (`item_types`). DataForSEO
 * refuses to sort or filter by a result type that was not requested, so the
 * organic and paid views are genuinely separate queries with separate cache
 * entries. Toggling the switch costs a call the first time each way.
 */
export interface DomainKeywordsResponse extends ResultMeta {
  domain: string;
  locationCode: number;
  languageCode: string;
  /** Which side was fetched. */
  paid: boolean;
  items: DomainKeywordRow[];
  totalCount: number | null;
  itemsCount: number | null;
  limit: number;
  offset: number;
}

/** One row of the Top pages tab. */
export interface DomainPageRow {
  /** Absolute URL. */
  url: string | null;
  organic: RankMetrics;
  paid: RankMetrics;
}

/** GET /api/v1/domains/pages */
export interface DomainPagesResponse extends ResultMeta {
  domain: string;
  locationCode: number;
  languageCode: string;
  items: DomainPageRow[];
  totalCount: number | null;
  itemsCount: number | null;
  limit: number;
  offset: number;
}

/**
 * One row of the Competitors tab.
 *
 * **The trap this shape exists to prevent:** upstream returns two
 * identically-shaped metric blocks per competitor. `organic`/`paid` here are
 * the competitor's OWN totals (`full_domain_metrics`) — what a "their traffic"
 * column should show. `sharedOrganic`/`sharedPaid` describe the *target's*
 * performance on the keywords the two domains share, which is a different
 * domain's data entirely. Do not label the shared block as the competitor's.
 */
export interface CompetitorRow {
  domain: string | null;
  /** Keywords both domains rank for. */
  commonKeywords: number | null;
  /** Average position over the shared keywords only. */
  avgPosition: number | null;
  /** The competitor's own totals. */
  organic: RankMetrics;
  paid: RankMetrics;
  /** The TARGET's numbers on the shared keyword set. */
  sharedOrganic: RankMetrics;
  sharedPaid: RankMetrics;
}

/** GET /api/v1/domains/competitors */
export interface DomainCompetitorsResponse extends ResultMeta {
  domain: string;
  locationCode: number;
  languageCode: string;
  items: CompetitorRow[];
  totalCount: number | null;
  itemsCount: number | null;
  limit: number;
  offset: number;
}

/** One market in the country breakdown. */
export interface DomainCountryRow {
  locationCode: number;
  countryIsoCode: string;
  countryName: string;
  organic: RankMetrics;
  paid: RankMetrics;
}

/**
 * GET /api/v1/domains/countries
 *
 * The expensive one: about ten upstream calls, which is why the UI puts it
 * behind a button with a cost hint. Markets are fetched concurrently and
 * independently — **a market that errors is omitted from `items` and named in
 * `failedCountries` rather than failing the whole request**, so a partial
 * breakdown still renders. `costUsd` covers only the calls that succeeded.
 */
export interface DomainCountriesResponse extends ResultMeta {
  domain: string;
  languageCode: string;
  /** Sorted by organic traffic, highest first. */
  items: DomainCountryRow[];
  /** ISO codes of markets that errored. Usually empty. */
  failedCountries: string[];
  /** How many markets were attempted, including failures. */
  requestedCount: number;
}
