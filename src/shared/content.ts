/**
 * Content Discovery — the contract between `/api/v1/content/*` and the SPA.
 *
 * The question this module answers: **which pages are winning traffic without
 * much authority?** Those are the topics a small site can realistically take.
 * So the unit of the response is a *page* — not a keyword, not a domain — with
 * its authority and traffic beside the keywords it was found on.
 *
 * Nothing here is a new DataForSEO family. A row is composed from four
 * existing sources (a SERP, optionally more SERPs from keyword suggestions,
 * bulk ranks, bulk traffic estimation), which is why `ContentDiscoverCosts`
 * exists: a composed answer has no single price, and a UI that shows one
 * number should be able to explain it.
 */
import type { ResultMeta } from "./api";

/** How many related keywords to expand a topic into. */
export const CONTENT_EXPAND_OPTIONS = [0, 5, 10] as const;
export type ContentExpand = (typeof CONTENT_EXPAND_OPTIONS)[number];

/** Row cap per response. Above this, page with `offset`. */
export const CONTENT_MAX_ROWS = 200;
export const CONTENT_DEFAULT_ROWS = 50;

/** Most URLs one word-count request may carry. */
export const CONTENT_WORDCOUNT_MAX_URLS = 10;

/** What the table can be ordered by. */
export const CONTENT_SORTS = [
  "estTraffic",
  "domainScore",
  "totalVolume",
] as const;
export type ContentSort = (typeof CONTENT_SORTS)[number];

/**
 * The "Low-competition winners" preset, defined once so the chip, the empty
 * state and any docs cannot disagree about what it means.
 *
 * Honest framing matters here: this is a *starting point*, not a verdict. A
 * Domain Score of 30 is not a threshold below which ranking is easy, and the
 * UI copy should say so.
 */
export const CONTENT_PRESET_LOW_COMPETITION = {
  maxDomainScore: 30,
  minTraffic: 500,
} as const;

/** One keyword a page was found ranking for. */
export interface ContentPageKeyword {
  keyword: string;
  /** Organic `rank_group` on that keyword's SERP. */
  position: number;
  /** Monthly search volume for the keyword, null when unknown. */
  volume: number | null;
}

/** One deduplicated ranking page — the row of the table. */
export interface ContentPageRow {
  /** Absolute URL, normalised for deduplication. See `normalizeContentUrl`. */
  url: string;
  /** Bare host, for the domain column and the Domain Score join. */
  domain: string;
  /** The SERP's title for this page, when one was captured. */
  title: string | null;
  /** 0–100. Null when DataForSEO has never crawled the domain. */
  domainScore: number | null;
  /**
   * 0–100 for this exact URL.
   *
   * Null is common and does not mean zero: `bulk_ranks` accepts URL targets,
   * but only returns a rank for a page its index actually holds.
   */
  pageScore: number | null;
  /** Estimated monthly organic visits to this page. Null when unknown. */
  estTraffic: number | null;
  /** Every keyword this page ranked for, across the SERPs fetched. */
  keywords: ContentPageKeyword[];
  /** Summed volume of those keywords — the demand this page touches. */
  totalVolume: number;
  /** Its best position across them. */
  bestPosition: number;
  /**
   * Words in the page body, once someone has asked for it.
   *
   * Always null here: counting costs money per URL, so it is a separate
   * `POST /content/wordcount` for selected rows rather than part of the sweep.
   */
  wordCount: number | null;
}

/**
 * What a composed answer cost, broken down by what bought it.
 *
 * One number would be unexplainable: the same query costs nothing on a repeat,
 * a few cents fresh, and the difference between `expand=0` and `expand=10` is
 * ten more SERPs. The UI's cost chip should be able to show the parts.
 */
export interface ContentDiscoverCosts {
  /** The topic's SERP, plus one per expansion keyword. */
  serpUsd: number;
  /** How many SERPs that was. */
  serpCalls: number;
  /** The keyword-suggestions lookup that produced the expansion keywords. */
  expansionUsd: number;
  /** `backlinks/bulk_ranks` — Domain and Page Scores. */
  scoresUsd: number;
  /** `dataforseo_labs/bulk_traffic_estimation` — the traffic column. */
  trafficUsd: number;
  /** The sum, and what `ResultMeta.costUsd` reports. */
  totalUsd: number;
}

/**
 * GET /api/v1/content/discover
 *
 * `costUsd` is 0 and `cached` true when the composition was served from cache,
 * which is the normal case for paging, sorting and filtering: the whole
 * deduplicated set is composed once per (topic, market, expand) and every
 * later view of it is free.
 */
export interface ContentDiscoverResponse extends ResultMeta {
  topic: string;
  locationCode: number;
  languageCode: string;
  expand: number;
  /**
   * The keywords whose SERPs were actually fetched — the topic first, then the
   * expansion. Shown so a user can see what the result is made of, and why a
   * page they expected is missing.
   */
  keywordsSearched: string[];
  /** The page rows, after filters and sort, windowed by limit/offset. */
  items: ContentPageRow[];
  /** Unique pages found before any filter. */
  totalCount: number;
  /** Rows in `items`. */
  itemsCount: number;
  /** Pages the filters removed — the "loosen the cap?" number. */
  filteredOut: number;
  limit: number;
  offset: number;
  sort: ContentSort;
  costs: ContentDiscoverCosts;
  /**
   * Whether page-level scores came back at all.
   *
   * `bulk_ranks` takes URL targets, but their index holds far fewer pages than
   * domains, so a whole result set can legitimately come back with every
   * `pageScore` null. Saying so lets the UI hide the column rather than show a
   * column of dashes that looks like a bug.
   */
  pageScoresAvailable: boolean;
}

/** One URL's word count. */
export interface ContentWordCountRow {
  url: string;
  /**
   * Words in the article body — headers, footers and comments excluded.
   *
   * Null means "could not count": the page refused the crawler, answered
   * non-2xx, or was not parseable. Distinct from 0, which means a page that
   * really has no body text.
   */
  wordCount: number | null;
  /** The page's own HTTP status, when it answered. */
  statusCode: number | null;
}

/** POST /api/v1/content/wordcount */
export interface ContentWordCountResponse extends ResultMeta {
  items: ContentWordCountRow[];
  /** URLs that produced a count, out of those submitted. */
  counted: number;
  submitted: number;
}

/**
 * Query parameters that identify a *click*, not a page.
 *
 * Google appends `srsltid` to organic result URLs and gives a different value
 * per impression, so without stripping it the same article arrives as two rows
 * for two keywords — observed live on photoboothtemplates.com (2026-08-31),
 * where one page occupied two of the seven surviving low-authority slots.
 *
 * Deliberately an allowlist of known-inert names rather than "drop everything
 * with an `=`": plenty of real sites still identify pages by query string, and
 * collapsing `?p=12` into `?p=13` would merge two different articles into one
 * row — a worse error than showing one page twice.
 */
const TRACKING_PARAMS = [
  "srsltid",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
];

/**
 * The deduplication key: one string per page, so the same page reached from
 * three SERPs is one row.
 *
 * What is normalised, and why each one:
 *  - **scheme and host lowercased**, host only — a path is case-sensitive and
 *    `/About` may be a different page from `/about` on a case-sensitive server;
 *  - **fragment dropped** — `#section` is a position within one page, never a
 *    different page;
 *  - **trailing slash dropped**, except on a bare root, where `/` is the path;
 *  - **query kept**, except tracking parameters — `?p=12` really can be a
 *    different article, but `?srsltid=...` never is. See `TRACKING_PARAMS`.
 *
 * `www.` is deliberately NOT stripped: it is part of the host a SERP reported
 * and the URL we would open. (The *domain* column is stripped separately, by
 * `normalizeSerpDomain`, because that one is a join key against bulk_ranks.)
 * Returns the input trimmed when it will not parse, so an unparseable URL is
 * still its own row rather than colliding with every other unparseable one.
 */
export function normalizeContentUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }
  parsed.hash = "";
  for (const param of TRACKING_PARAMS) parsed.searchParams.delete(param);
  // An emptied query must leave no bare "?" behind, or two spellings of one
  // page survive the normaliser after all.
  if ([...parsed.searchParams].length === 0) parsed.search = "";
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }
  return parsed.toString();
}
