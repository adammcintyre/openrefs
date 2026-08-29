/**
 * Contract for `/api/v1/gsc/*` — Search Console (docs/specs/PHASE5.md).
 *
 * Three things make this module unlike every other one in OpenRefs, and all
 * three show up in these types:
 *
 *  - **It costs nothing.** The data comes from Google on the user's own OAuth
 *    grant, not from DataForSEO, so no response here carries a `ResultMeta`.
 *    Where other modules show a cost chip, this one shows `freshTo`.
 *  - **It is optional.** A deployment with no Google OAuth client is normal,
 *    not broken. `GscStatusResponse` is designed to be the *only* call the UI
 *    needs to decide between four states: unconfigured, unconnected, connected
 *    but property-less, and broken.
 *  - **The data is stale by design.** Search Console finalises a day's metrics
 *    roughly two days late, so "today" is never a question anyone can ask.
 *    Every report states the last day it can honestly speak for.
 */
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Freshness                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How far behind "today" this module assumes Search Console's finalised data
 * runs, in days.
 *
 * **Google does not publish a fixed figure**, and it would be wrong to imply
 * they do. What they document is a *mechanism*: `searchanalytics.query` takes
 * a `dataState` parameter which defaults to `final`, and only `all` returns
 * the still-moving recent rows — flagged by a `first_incomplete_date` in the
 * response metadata. Their 2024 Search Central post says the delay has roughly
 * halved and now runs to hours for the 24-hour view.
 *
 * OpenRefs asks for finalised data only, so the risk is not bad numbers but
 * *missing* ones: a window ending today would silently be short a day or two
 * and quietly understate the period. Clamping every request to end at
 * `today - GSC_DATA_LAG_DAYS` makes the window mean what it says, and two days
 * is the conservative choice docs/specs/PHASE5.md settled on.
 *
 * Every response reports the clamp in `freshTo`, which the UI renders as a
 * "data to <date>" chip in the slot other modules use for cost. If a later
 * phase wants genuinely fresh numbers, the honest way is `dataState: "all"`
 * plus honouring `first_incomplete_date` — not shrinking this constant.
 */
export const GSC_DATA_LAG_DAYS = 2;

/** Default window: the last 28 complete days, ending at `freshTo`. */
export const GSC_DEFAULT_RANGE_DAYS = 28;

/**
 * Rows pulled per Search Console query.
 *
 * Google documents `rowLimit` as "Valid range is 1–25,000; Default is 1,000";
 * we ask for 5,000 (docs/specs/PHASE5.md). That is far more than any table
 * renders and plenty for the opportunity rules to compute a meaningful median,
 * while keeping the KV cache entry a fifth of the size the maximum would need.
 */
export const GSC_ROW_LIMIT = 5000;

/** The date window a report actually covers, plus the freshness promise. */
export interface GscDateRange {
  /** Inclusive start, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive end, `YYYY-MM-DD`. Never later than `freshTo`. */
  to: string;
  /**
   * The most recent day Search Console has finalised — `today - 2`. Present on
   * every response so the UI can say what the numbers are current to without
   * re-deriving the lag rule.
   */
  freshTo: string;
}

/* -------------------------------------------------------------------------- */
/* Connection state                                                            */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/gsc/status?workspace&project
 *
 * The one call that never fails for a configuration reason — it *is* the
 * configuration report. Four UI states fall out of it:
 *
 *   configured: false                    → self-host setup card
 *   connected: false                     → "Connect Google Search Console"
 *   broken: true                         → reconnect CTA
 *   property: null                       → property picker
 *   otherwise                            → the reports
 */
export interface GscStatusResponse {
  /** This deployment has a Google OAuth client (both id and secret). */
  configured: boolean;
  /** This project has a stored refresh token. */
  connected: boolean;
  /** The chosen Search Console property, or null if none picked yet. */
  property: string | null;
  /**
   * Google refused the stored refresh token (`invalid_grant`) the last time we
   * used it. The connection exists but is dead; only reconnecting fixes it.
   */
  broken: boolean;
}

/**
 * `?error=` values the OAuth callback can redirect back to the SPA with.
 *
 * The callback is a browser navigation, not an XHR, so it cannot answer with a
 * JSON error body — it has to hand the reason to the page it lands on. These
 * are the flow-specific ones; the callback may also pass through an
 * `ApiErrorCode` (`gsc_error`, `gsc_reconnect_required`, `forbidden`,
 * `not_found`) when the failure happened after the state checked out.
 */
export const GSC_CALLBACK_ERRORS = [
  /** The user pressed Cancel on Google's consent screen. Not an error to shout about. */
  "access_denied",
  /** The state token was missing, malformed, or not signed by this deployment. */
  "invalid_state",
  /** The state token was authentic but older than ten minutes. */
  "expired_state",
  /** A different user finished a flow this user started. */
  "state_mismatch",
  /** Google completed the exchange but issued no refresh token. */
  "no_refresh_token",
] as const;

export type GscCallbackError = (typeof GSC_CALLBACK_ERRORS)[number];

/** One property the connected Google account can see. */
export interface GscSite {
  /** e.g. `sc-domain:example.com` or `https://example.com/`. */
  siteUrl: string;
  /** Google's own enum: siteOwner, siteFullUser, siteRestrictedUser, siteUnverifiedUser. */
  permissionLevel: string;
}

/** GET /api/v1/gsc/sites?workspace&project */
export interface GscSitesResponse {
  sites: GscSite[];
  /** Currently selected property, so the picker can show what is chosen. */
  property: string | null;
}

/**
 * PATCH /api/v1/gsc/connection?workspace&project
 *
 * The property is validated against `sites.list` server-side: a project may
 * only be bound to a property this grant can actually read.
 */
export const updateGscConnectionSchema = z.object({
  property: z.string().trim().min(1, "Choose a Search Console property."),
});
export type UpdateGscConnectionBody = z.input<typeof updateGscConnectionSchema>;

export interface GscConnectionResponse {
  connected: boolean;
  property: string | null;
}

/** DELETE /api/v1/gsc/connection?workspace&project */
export interface GscDisconnectedResponse {
  disconnected: true;
  /**
   * Whether Google accepted the token revocation. `false` means the row is
   * gone and the token is unusable by us, but Google may still list the grant
   * until the user removes it — surfaced so the UI can say so honestly rather
   * than implying more than happened.
   */
  revoked: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

/** The four metrics Search Console reports for any slice. */
export interface GscMetrics {
  clicks: number;
  impressions: number;
  /** Fraction, 0–1 — exactly as Google returns it. The UI formats as a %. */
  ctr: number;
  /** Average position, 1-based. Lower is better. */
  position: number;
}

export interface GscDailyPoint extends GscMetrics {
  /** `YYYY-MM-DD`. */
  date: string;
}

/** Fields every report response carries. */
export interface GscReportBase extends GscDateRange {
  /** The property these numbers describe. */
  property: string;
  /** Served from the 24h KV cache rather than a fresh Google call. */
  cached: boolean;
}

/** GET /api/v1/gsc/overview */
export interface GscOverviewResponse extends GscReportBase {
  totals: GscMetrics;
  daily: GscDailyPoint[];
}

export interface GscQueryRow extends GscMetrics {
  query: string;
}

export interface GscPageRow extends GscMetrics {
  page: string;
}

/** A window over the fetched set — the paging is ours, not Google's. */
export interface GscPagedReport extends GscReportBase {
  /** Rows available in the fetched set, before `limit`/`offset`. */
  total: number;
  limit: number;
  offset: number;
}

/** GET /api/v1/gsc/queries */
export interface GscQueriesResponse extends GscPagedReport {
  rows: GscQueryRow[];
}

/** GET /api/v1/gsc/pages */
export interface GscPagesResponse extends GscPagedReport {
  rows: GscPageRow[];
}

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

/** The three rules, in the order the UI lists them. */
export const GSC_OPPORTUNITY_RULES = [
  "striking_distance",
  "low_ctr",
  "cannibalization",
] as const;

export type GscOpportunityRule = (typeof GSC_OPPORTUNITY_RULES)[number];

/** Fields shared by every opportunity, whichever rule produced it. */
export interface GscOpportunityBase extends GscMetrics {
  rule: GscOpportunityRule;
  query: string;
  /**
   * The page earning the most clicks for this query, from the query+page pull
   * — the thing to actually go and edit. Null when the query+page breakdown
   * has no row for this query (Search Console anonymises rare queries, so the
   * two pulls do not always agree).
   */
  page: string | null;
}

/**
 * Position 5–20 with above-median impressions: real demand, just off page one.
 * The highest-leverage list, because the gap to close is small.
 */
export interface GscStrikingDistanceOpportunity extends GscOpportunityBase {
  rule: "striking_distance";
}

/**
 * Ranking well but under-clicked — a title/description problem, not a ranking
 * problem.
 */
export interface GscLowCtrOpportunity extends GscOpportunityBase {
  rule: "low_ctr";
  /** What the curve says a query at this position should earn, as a fraction. */
  expectedCtr: number;
  /** `ctr / expectedCtr`. Below 0.5 by construction. */
  ctrRatio: number;
}

/** One page competing for a query. */
export interface GscCannibalizedPage extends GscMetrics {
  page: string;
  /** This page's share of the query's clicks, 0–1. */
  shareOfClicks: number;
}

/**
 * Two or more pages each taking a meaningful share of one query's clicks —
 * the site competing with itself.
 */
export interface GscCannibalizationOpportunity extends GscOpportunityBase {
  rule: "cannibalization";
  /** Every page over the share threshold, most clicks first. At least two. */
  pages: GscCannibalizedPage[];
}

export type GscOpportunity =
  | GscStrikingDistanceOpportunity
  | GscLowCtrOpportunity
  | GscCannibalizationOpportunity;

/**
 * One opportunity list, plus the size of the set it was cut from.
 *
 * Every rule caps its output (see `OPPORTUNITY_LIMIT` in
 * src/worker/gsc/opportunities.ts): a 5,000-row pull can match well over a
 * thousand times, and nobody works through that. Without `total` the cap is
 * invisible — a truncated list is indistinguishable from a complete one, so
 * "200 striking-distance keywords" reads as the whole picture when it may be a
 * quarter of it.
 *
 * `total` counts the matches **before** the cap, which is what lets the UI say
 * "showing 200 of 843". `total > items.length` is the truncation test; the two
 * are equal whenever the list is complete.
 */
export interface GscOpportunityList<T> {
  /** The rows the UI renders: already sorted, already capped. */
  items: T[];
  /** Matches before the cap. Never less than `items.length`. */
  total: number;
}

/** GET /api/v1/gsc/opportunities */
export interface GscOpportunitiesResponse extends GscReportBase {
  strikingDistance: GscOpportunityList<GscStrikingDistanceOpportunity>;
  lowCtr: GscOpportunityList<GscLowCtrOpportunity>;
  cannibalization: GscOpportunityList<GscCannibalizationOpportunity>;
  /** The thresholds that produced these lists, so the UI can explain itself. */
  thresholds: GscOpportunityThresholds;
}

/**
 * The numbers the rules ran with. Returned rather than duplicated in the UI so
 * the explanation under each table can never drift from the computation.
 */
export interface GscOpportunityThresholds {
  strikingDistance: {
    minPosition: number;
    maxPosition: number;
    /** The median impressions of the fetched query set. */
    minImpressions: number;
  };
  lowCtr: {
    maxPosition: number;
    /** CTR must be below this fraction of the expected curve. */
    ratio: number;
  };
  cannibalization: {
    /** Each competing page must earn at least this share of the clicks. */
    minShareOfClicks: number;
    minPages: number;
  };
}
