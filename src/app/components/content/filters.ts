/**
 * The Content Discovery filter row, as data.
 *
 * These filters are **server-side but free**. The Worker applies them over a
 * composed set it has already cached under the (topic, market, expansion) it
 * was bought with, so raising the Domain Score cap from 30 to 40 is an HTTP
 * request that costs $0.00 — not a fresh fan-out of a dozen paid SERPs. That is
 * the whole reason the cap is presented as a knob rather than hidden behind an
 * Apply button with a price on it.
 *
 * **The two numeric filters treat an unknown value in opposite directions, on
 * purpose,** and this is the single most important thing about this file:
 *
 *  - a page with **no Domain Score passes** a `maxDomainScore` filter. Unknown
 *    authority is not high authority — a site DataForSEO has never crawled is
 *    usually a small one, which is exactly what someone capping the score is
 *    hunting for. Dropping those rows would hide the best answers behind a
 *    missing value.
 *  - a page with **no traffic estimate fails** a `minTraffic` filter. "At least
 *    500 visits a month" is a claim an unmeasured page cannot be said to meet.
 *
 * Both rules live in the Worker (`filterContentRows` in
 * src/worker/routes/content.ts); the copy here exists so the UI can *explain*
 * them in a tooltip rather than leaving a user to infer them from row counts.
 */

/** What the inputs hold: strings, because that is what an `<input>` gives you. */
export interface ContentFilterDraft {
  maxDomainScore: string;
  minTraffic: string;
  include: string;
  exclude: string;
}

/** What the API takes. Field names match the Worker's discover query schema. */
export interface ContentFilters {
  maxDomainScore?: number;
  minTraffic?: number;
  include?: string;
  exclude?: string;
}

export const EMPTY_CONTENT_DRAFT: ContentFilterDraft = {
  maxDomainScore: "",
  minTraffic: "",
  include: "",
  exclude: "",
};

export const EMPTY_CONTENT_FILTERS: ContentFilters = {};

/**
 * What each filter does to a row whose value is unknown. Rendered as the
 * tooltip on the two numeric fields, so the asymmetry above is visible at the
 * point where it changes what you see.
 */
export const NULL_SEMANTICS = {
  maxDomainScore:
    "Pages with no Domain Score are kept: DataForSEO has never crawled that site, which usually means a small one — not a high-authority one.",
  minTraffic:
    "Pages with no traffic estimate are dropped: an unmeasured page cannot be said to meet a traffic floor.",
} as const;

function num(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

function text(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function clamp(
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  return Math.min(max, Math.max(min, value));
}

/**
 * Draft to query params, dropping anything blank or nonsensical.
 *
 * Out-of-range values are clamped rather than sent: the Worker 422s a Domain
 * Score above 100, and a typed "150" plainly means "no cap that matters", not
 * "fail my request". Negative traffic floors become 0 for the same reason.
 */
export function parseContentFilterDraft(
  draft: ContentFilterDraft,
): ContentFilters {
  const filters: ContentFilters = {};

  const maxDomainScore = clamp(num(draft.maxDomainScore), 0, 100);
  const minTraffic = clamp(num(draft.minTraffic), 0, Number.MAX_SAFE_INTEGER);

  if (maxDomainScore !== undefined) filters.maxDomainScore = maxDomainScore;
  if (minTraffic !== undefined) filters.minTraffic = minTraffic;

  const include = text(draft.include);
  const exclude = text(draft.exclude);
  if (include !== undefined) filters.include = include;
  if (exclude !== undefined) filters.exclude = exclude;

  return filters;
}

/** Applied filters back to a draft, so the row reopens showing what is on. */
export function toContentFilterDraft(
  filters: ContentFilters,
): ContentFilterDraft {
  return {
    maxDomainScore:
      filters.maxDomainScore === undefined ? "" : String(filters.maxDomainScore),
    minTraffic:
      filters.minTraffic === undefined ? "" : String(filters.minTraffic),
    include: filters.include ?? "",
    exclude: filters.exclude ?? "",
  };
}

/** How many filters are on — drives the count badge next to "Filters". */
export function activeContentFilterCount(filters: ContentFilters): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

/** Every input blank. Drives whether "Clear" has anything to do. */
export function isContentDraftEmpty(draft: ContentFilterDraft): boolean {
  return Object.values(draft).every((value) => value.trim() === "");
}

/* -------------------------------------------------------------------------- */
/* URL round-trip                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Filters out of a query string.
 *
 * Reused by `readContentSearch`, and total in the same way: a `maxDomainScore`
 * of "banana" is no filter rather than an error, because the alternative is a
 * hand-edited URL that renders a broken screen instead of a wide table.
 */
export function readFiltersFromParams(params: URLSearchParams): ContentFilters {
  return parseContentFilterDraft({
    maxDomainScore: params.get("maxDomainScore") ?? "",
    minTraffic: params.get("minTraffic") ?? "",
    include: params.get("include") ?? "",
    exclude: params.get("exclude") ?? "",
  });
}

/** Filters into a query string, omitting the ones that are not set. */
export function writeFiltersToParams(
  params: URLSearchParams,
  filters: ContentFilters,
): void {
  if (filters.maxDomainScore !== undefined) {
    params.set("maxDomainScore", String(filters.maxDomainScore));
  }
  if (filters.minTraffic !== undefined) {
    params.set("minTraffic", String(filters.minTraffic));
  }
  if (filters.include !== undefined) params.set("include", filters.include);
  if (filters.exclude !== undefined) params.set("exclude", filters.exclude);
}
