/**
 * Backlinks response types — the contract between the Worker's
 * `/api/v1/backlinks/*` routes and the SPA.
 *
 * Same conventions as keywords.ts and domains.ts: `null` means "not reported",
 * never zero, and the Worker flattens DataForSEO's nesting so the UI reads one
 * shape.
 *
 * **The metric.** Authority is **Domain Score** for a host and **Page Score**
 * for a single URL, both 0–100, both already normalised by the Worker. The
 * provider's raw 0–1000 rank is not on any type here and must never be shown;
 * neither may the trademarked names other vendors use for their own authority
 * metrics (CLAUDE.md rule 2).
 *
 * **Dofollow is derived, not reported.** The Backlinks API publishes nofollow
 * counts and totals but no dofollow count, so every `dofollow` block below is
 * `total - nofollow`, and each of its fields is null when the API did not
 * report enough to compute it. Null is not 0% and is not 100%.
 */
import type { ResultMeta } from "./api";

export type { ResultMeta };

/**
 * The colour bands for a 0–100 score, so the MetricCard, the table badges and
 * any chart legend agree on where "strong" starts. Thresholds are inclusive
 * lower bounds, highest first.
 */
export const SCORE_BANDS = [
  { min: 70, band: "very-high" },
  { min: 50, band: "high" },
  { min: 30, band: "medium" },
  { min: 0, band: "low" },
] as const;

export type ScoreBand = (typeof SCORE_BANDS)[number]["band"];

/** The band a score falls in, or null for an unknown score. */
export function scoreBand(score: number | null | undefined): ScoreBand | null {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }
  for (const entry of SCORE_BANDS) {
    if (score >= entry.min) return entry.band;
  }
  return "low";
}

/** The dofollow/nofollow split of a link profile. All fields derived. */
export interface DofollowSplit {
  /** Referring pages carrying at least one dofollow link. */
  dofollowPages: number | null;
  nofollowPages: number | null;
  /** 0–1, for the "dofollow %" card. Null when it cannot be computed. */
  dofollowRatio: number | null;
}

/**
 * GET /api/v1/backlinks/summary?workspace&target
 *
 * `target` is location-independent — a link profile is not per-market — and
 * accepts a domain, a subdomain, or an absolute page URL.
 */
export interface BacklinksSummaryResponse extends ResultMeta {
  /** Echoed back as DataForSEO resolved it. */
  target: string | null;
  /** 0–100. The headline metric. */
  domainScore: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  /** Domains counted once regardless of subdomain — always ≤ referringDomains. */
  referringMainDomains: number | null;
  referringPages: number | null;
  dofollow: DofollowSplit;
  brokenBacklinks: number | null;
  brokenPages: number | null;
  crawledPages: number | null;
  internalLinksCount: number | null;
  externalLinksCount: number | null;
  referringIps: number | null;
  referringSubnets: number | null;
  /** DataForSEO's own 0–100 spam estimate. Not one of our metrics. */
  spamScore: number | null;
  /** `yyyy-mm-dd hh-mm-ss +00:00`. */
  firstSeen: string | null;
  lostDate: string | null;
  server: string | null;
  countryIsoCode: string | null;
  /** Counts by link attribute, e.g. `{nofollow: 42}`. Open key set. */
  linkAttributes: Record<string, number> | null;
  linkTypes: Record<string, number> | null;
}

/**
 * How the backlinks list groups rows.
 *
 * `one_per_domain` answers "which domains link to me" with one example link
 * each; `as_is` is every individual link. **`groupCount` is only meaningful in
 * a grouped mode** — it comes back 0 under `as_is`.
 */
export const BACKLINKS_LIST_MODES = ["as_is", "one_per_domain"] as const;
export type BacklinksListMode = (typeof BACKLINKS_LIST_MODES)[number];

/** One row of the Backlinks tab. */
export interface BacklinkRow {
  /** The linking domain. */
  domainFrom: string | null;
  /** The linking page. */
  urlFrom: string | null;
  /** The page on the target being linked to. */
  urlTo: string | null;
  anchor: string | null;
  /** False means the link is nofollow. */
  dofollow: boolean | null;
  isBroken: boolean | null;
  isNew: boolean | null;
  isLost: boolean | null;
  firstSeen: string | null;
  lastSeen: string | null;
  /** 0–100 for the linking page. */
  pageScore: number | null;
  /** 0–100 for the linking domain. */
  domainScore: number | null;
  pageFromTitle: string | null;
  pageFromLanguage: string | null;
  /** Duplicate links from the same page, collapsed into this row. */
  linksCount: number | null;
  /** Total links from this domain. Only meaningful when mode is grouped. */
  groupCount: number | null;
  /** "anchor" | "image" | "meta" | "canonical" | "alternate" | "redirect". */
  itemType: string | null;
  /** 0–100 spam estimate for this individual link. */
  spamScore: number | null;
}

/** GET /api/v1/backlinks/list */
export interface BacklinksListResponse extends ResultMeta {
  target: string | null;
  mode: BacklinksListMode;
  items: BacklinkRow[];
  totalCount: number | null;
  itemsCount: number | null;
  limit: number;
  offset: number;
}

/** One row of the Referring domains tab. */
export interface ReferringDomainRow {
  domain: string | null;
  /** 0–100. */
  domainScore: number | null;
  backlinks: number | null;
  referringPages: number | null;
  dofollow: DofollowSplit;
  brokenBacklinks: number | null;
  firstSeen: string | null;
  lostDate: string | null;
  spamScore: number | null;
}

/**
 * GET /api/v1/backlinks/referring-domains
 *
 * **`totalCount` counts MAIN domains while `items` are domains including
 * subdomains** — DataForSEO's own documented asymmetry. The two legitimately
 * disagree, so do not drive "load more" off their difference alone.
 */
export interface ReferringDomainsResponse extends ResultMeta {
  target: string | null;
  items: ReferringDomainRow[];
  totalCount: number | null;
  itemsCount: number | null;
  limit: number;
  offset: number;
}

/** One row of the Anchors tab. */
export interface AnchorRow {
  anchor: string | null;
  /** 0–100 — the authority the links using this anchor carry. */
  score: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringPages: number | null;
  dofollow: DofollowSplit;
  brokenBacklinks: number | null;
  firstSeen: string | null;
  lostDate: string | null;
}

/** GET /api/v1/backlinks/anchors */
export interface AnchorsResponse extends ResultMeta {
  target: string | null;
  items: AnchorRow[];
  totalCount: number | null;
  itemsCount: number | null;
  limit: number;
  offset: number;
}

/** One month of a link profile's history. */
export interface BacklinksHistoryPoint {
  /** `YYYY-MM` — the chart's x axis. */
  period: string | null;
  /** The provider's raw timestamp, kept for tooltips. */
  date: string | null;
  /** 0–100. */
  domainScore: number | null;
  backlinks: number | null;
  newBacklinks: number | null;
  lostBacklinks: number | null;
  referringDomains: number | null;
  newReferringDomains: number | null;
  lostReferringDomains: number | null;
  referringMainDomains: number | null;
  referringPages: number | null;
  brokenBacklinks: number | null;
  crawledPages: number | null;
}

/** The provider's link history begins here; earlier `from` dates are rejected. */
export const BACKLINKS_HISTORY_MIN_DATE = "2019-01-01";

/**
 * GET /api/v1/backlinks/history?…&from&to
 *
 * Monthly, oldest first. Two caveats the chart should respect:
 *
 *  - **Months can be missing** from `items`; plot by `period`, never by index.
 *  - **The four delta series (`new*` / `lost*`) are 0, not null, before
 *    2021-05** — the provider has no change data that far back, and "no
 *    change" is indistinguishable from "no data" there.
 */
export interface BacklinksHistoryResponse extends ResultMeta {
  target: string | null;
  /** `yyyy-mm-dd`, as resolved by the provider. */
  dateFrom: string | null;
  dateTo: string | null;
  items: BacklinksHistoryPoint[];
  itemsCount: number | null;
}

/**
 * Our ceiling on `POST /api/v1/backlinks/scores`.
 *
 * DataForSEO allows 1000 targets per call; 100 is what one SERP page plus
 * headroom needs, and it keeps a single request's cost predictable.
 */
export const BACKLINKS_SCORES_MAX_TARGETS = 100;

/** One target's authority. */
export interface TargetScore {
  /** Echoed as the provider resolved it — match by this, never by index. */
  target: string | null;
  /** 0–100. */
  domainScore: number | null;
}

/**
 * POST /api/v1/backlinks/scores  `{ targets: string[] }`
 *
 * Batched so the SERP panel can score a whole page of results in one call.
 * **The provider does not preserve input order** (it returns URLs before bare
 * domains), so results must be matched back by the `target` string.
 */
export interface BacklinksScoresResponse extends ResultMeta {
  items: TargetScore[];
  itemsCount: number | null;
}

/**
 * Sort orders for the backlinks list. Applied server-side as the provider's
 * `order_by`, so changing sort is a fresh provider query, not a client-side
 * reshuffle. `domain_score` is the default and matches the old fixed
 * behaviour (referring domain authority first).
 */
export const BACKLINK_SORTS = [
  "domain_score",
  "page_score",
  "newest",
  "oldest",
] as const;
export type BacklinkSort = (typeof BACKLINK_SORTS)[number];

/**
 * The `maxSpamScore` the "Hide likely spam" toggle applies (provider spam
 * score, 0–100). 30 keeps ordinary directories and forums while dropping the
 * bulk-comment and link-farm tier.
 */
export const BACKLINKS_SPAM_HIDE_THRESHOLD = 30;
