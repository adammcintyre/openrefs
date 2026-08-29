/**
 * Gap Analysis response types — the contract between the Worker's
 * `/api/v1/gap/*` routes and the SPA.
 *
 * Same conventions as keywords.ts and domains.ts: `null` means "not reported",
 * never zero, and the Worker flattens DataForSEO's nesting so the UI reads one
 * shape.
 *
 * The one concept the UI has to get right is what a **position of `null`**
 * means on a competitor: that domain does not rank for that keyword in the top
 * results DataForSEO holds. It is not "position unknown" and it is certainly
 * not "position 0" — the table should render a dash, and the four modes below
 * are defined entirely in terms of which positions are null.
 */
import type { ResultMeta } from "./api";
import type { CompetitionLevel, KeywordIntentLabel } from "./keywords";

export type { ResultMeta };

/**
 * The four views of a keyword gap. Each is a filter over the same fetched
 * rows, so switching tabs never costs another upstream call.
 *
 * `missing` and `untapped` are easy to conflate and are genuinely different:
 *
 *  - **`missing`** — you do not rank and **every** competitor shown does. The
 *    strong signal: the whole peer set has this covered and you do not, so it
 *    is very unlikely to be a keyword that simply does not apply to your
 *    market.
 *  - **`untapped`** — you do not rank and **at least one** competitor does.
 *    Strictly broader: every `missing` keyword is also `untapped`. This is the
 *    opportunity list, including the ones only a single rival has found.
 *
 * Both require the target to be absent. `weak` is the opposite case — you are
 * present but behind — and `all` applies no filter at all.
 */
export const GAP_MODES = ["missing", "weak", "untapped", "all"] as const;

export type GapMode = (typeof GAP_MODES)[number];

/**
 * How many competitors one gap query may compare.
 *
 * **This is our ceiling, not the API's.** DataForSEO's `domain_intersection`
 * compares exactly two domains per call, so the Worker runs one pairwise call
 * per competitor and merges them — every competitor added is another upstream
 * call and another slice of the bill. Four is what the UI offers; the `all`
 * mode is the expensive one, needing two calls per competitor rather than one.
 */
export const GAP_MAX_COMPETITORS = 4;

/** DataForSEO's own ceiling on `page_intersection`'s compared URLs. */
export const GAP_MAX_PAGES = 20;

/** One-line explanations, so the UI's mode tabs describe the same rule. */
export const GAP_MODE_DESCRIPTIONS: Record<GapMode, string> = {
  missing: "Every competitor ranks for this keyword and you don't.",
  weak: "You rank for this keyword, but at least one competitor ranks higher.",
  untapped: "At least one competitor ranks for this keyword and you don't.",
  all: "Every keyword any of these domains ranks for.",
};

/** How one domain performs on one keyword. */
export interface GapPosition {
  /** The domain this position belongs to, normalised (no scheme, no `www.`). */
  domain: string;
  /**
   * SERP rank (DataForSEO's `rank_group`), or **null when the domain does not
   * rank for this keyword at all**. Render null as a dash, never as 0.
   */
  position: number | null;
  /** The ranking page. Null when `position` is. */
  url: string | null;
  /** Estimated monthly visits this ranking brings that domain. */
  traffic: number | null;
}

/** One row of the Gap Analysis table. */
export interface GapKeywordRow {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: CompetitionLevel | null;
  /** 0–100. */
  keywordDifficulty: number | null;
  intent: KeywordIntentLabel | null;
  /** Your side. `position: null` means you do not rank — the whole point. */
  target: GapPosition;
  /**
   * One entry per competitor **in the order they were requested**, so the
   * table can render a fixed column per competitor. A competitor that does not
   * rank for this keyword is still present here, with a null position.
   */
  competitors: GapPosition[];
  /**
   * Estimated traffic of the best-placed competitor on this keyword — the
   * "what it is worth to them" column. Null when no competitor ranks.
   */
  bestCompetitorTraffic: number | null;
}

/**
 * GET /api/v1/gap/keywords
 *
 * **Param quirks the UI must know:**
 *
 *  - `competitors` is a comma-separated list of domains, at least 1 and at
 *    most `GAP_MAX_COMPETITORS`.
 *  - `mode` filters rows the Worker has already fetched and paid for, so
 *    switching modes is free but changes how many rows come back for a given
 *    page window. `totalCount` is upstream's count for the unfiltered query;
 *    `itemsCount` is what survived the mode filter on this page. Paging is
 *    driven by `offset`/`limit` against the *unfiltered* set — see
 *    `filteredOut` for how many rows this page dropped.
 */
export interface GapKeywordsResponse extends ResultMeta {
  /** The domain being analysed ("you"). */
  target: string;
  /** Normalised competitor domains, in the order requested. */
  competitors: string[];
  locationCode: number;
  languageCode: string;
  mode: GapMode;
  items: GapKeywordRow[];
  /** Upstream's total for the unfiltered query. */
  totalCount: number | null;
  /** Rows on this page after the mode filter. */
  itemsCount: number | null;
  /**
   * Rows this page fetched and then dropped because they did not match the
   * mode. A large number next to a small `items` means the next page is worth
   * loading — it is not an error.
   */
  filteredOut: number;
  limit: number;
  offset: number;
}

/** One row of the page-level gap table. */
export interface GapPageRow {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  competitionLevel: CompetitionLevel | null;
  keywordDifficulty: number | null;
  intent: KeywordIntentLabel | null;
  /**
   * One entry per page compared, in the order requested. `domain` here is the
   * page URL, not a hostname — page_intersection compares URLs.
   */
  pages: GapPosition[];
}

/**
 * GET /api/v1/gap/pages
 *
 * Compares up to `GAP_MAX_PAGES` **URLs** (not domains) and returns the
 * keywords they rank for together. Unlike `/gap/keywords` this has no "you" —
 * every page is just one of the compared set — so it carries no mode filter.
 */
export interface GapPagesResponse extends ResultMeta {
  /** The compared page URLs, in the order requested. */
  pages: string[];
  locationCode: number;
  languageCode: string;
  items: GapPageRow[];
  totalCount: number | null;
  itemsCount: number | null;
  limit: number;
  offset: number;
}
