/**
 * The URL is the module's state.
 *
 * `?topic=&location=&language=&expand=&sort=&maxDomainScore=&minTraffic=&include=&exclude=`
 * describes a whole discovery, so a report can be reloaded, bookmarked or
 * pasted to a colleague and come back identical.
 *
 * **The filters are in the URL here, and in Gap Analysis they are not.** That
 * looks inconsistent and is deliberate. Gap's filters are conditions DataForSEO
 * applies inside a billed query, so a link carrying six of them spends the
 * recipient's credits on someone else's narrowing before they have seen
 * anything. Content Discovery's filters are applied by the Worker over a
 * composed set it has already cached — changing one costs nothing, and the
 * whole design of the module is that the Domain Score cap is a knob you turn
 * freely. A shared link therefore costs its recipient exactly one composition,
 * filtered or not, so putting the filters in it is free and makes "here are the
 * seven pages I meant" a link rather than a list of instructions.
 *
 * Reading is total: any garbage resolves to a usable search rather than an
 * error state.
 */
import type { ContentExpand, ContentSort } from "../../../shared/content";
import {
  CONTENT_EXPAND_OPTIONS,
  CONTENT_SORTS,
} from "../../../shared/content";
import type { ContentFilters } from "../../components/content/filters";
import {
  EMPTY_CONTENT_FILTERS,
  readFiltersFromParams,
  writeFiltersToParams,
} from "../../components/content/filters";

/** A location code + the language it is queried in. */
export interface ContentMarket {
  location: number;
  language: string;
}

/** Everything the URL carries. */
export interface ContentSearch extends ContentMarket {
  /** The topic, trimmed. "" when nothing has been searched yet. */
  topic: string;
  expand: ContentExpand;
  sort: ContentSort;
  filters: ContentFilters;
}

/**
 * United Kingdom, English — the same default the other research modules use
 * (docs/ARCHITECTURE.md; 2826 is the verified Labs location code).
 */
export const DEFAULT_MARKET: ContentMarket = { location: 2826, language: "en" };

/**
 * No expansion by default: the cheapest option is the one a first-time visitor
 * should land on, and it is also the Worker's own default, so an omitted
 * `?expand=` means the same thing on both sides.
 */
export const DEFAULT_EXPAND: ContentExpand = 0;

/**
 * Traffic first. The module's question is "which pages win traffic without much
 * authority", and ordering by the authority column instead would put the
 * lowest-authority pages on top regardless of whether anyone visits them.
 * Also the Worker's default.
 */
export const DEFAULT_SORT: ContentSort = "estTraffic";

function readLocation(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function readLanguage(raw: string | null, fallback: string): string {
  if (raw === null) return fallback;
  const value = raw.trim().toLowerCase();
  // The shape the Worker's languageParam accepts; anything else is fallback.
  return /^[a-z]{2,8}(-[a-z0-9]{2,8})?$/.test(value) ? value : fallback;
}

/**
 * Expansion, restricted to the three the UI offers.
 *
 * Anything else falls back to 0 rather than being clamped to the nearest
 * option: a hand-edited `?expand=50` is a typo, and quietly turning it into the
 * dearest legal sweep would spend real money on a guess. The Worker refuses it
 * too, so this keeps both sides agreeing.
 */
function readExpand(raw: string | null): ContentExpand {
  if (raw === null) return DEFAULT_EXPAND;
  const parsed = Number(raw);
  return (CONTENT_EXPAND_OPTIONS as readonly number[]).includes(parsed)
    ? (parsed as ContentExpand)
    : DEFAULT_EXPAND;
}

function readSort(raw: string | null): ContentSort {
  return CONTENT_SORTS.includes(raw as ContentSort)
    ? (raw as ContentSort)
    : DEFAULT_SORT;
}

/**
 * Parse the query string into a search.
 *
 * `fallback` is the workspace's last-used market, so a bare
 * `/app/content-discovery` opens on the market the user works in rather than
 * resetting to the UK.
 */
export function readContentSearch(
  params: URLSearchParams,
  fallback: ContentMarket = DEFAULT_MARKET,
): ContentSearch {
  return {
    topic: (params.get("topic") ?? "").trim(),
    location: readLocation(params.get("location"), fallback.location),
    language: readLanguage(params.get("language"), fallback.language),
    expand: readExpand(params.get("expand")),
    sort: readSort(params.get("sort")),
    filters: readFiltersFromParams(params),
  };
}

/**
 * Serialise back to a query string.
 *
 * Only the parts that carry information are written and defaults are left
 * implicit, so the common URL stays short enough to read at a glance.
 */
export function contentSearchParams(search: ContentSearch): URLSearchParams {
  const params = new URLSearchParams();
  const topic = search.topic.trim();

  if (topic === "") return params;

  params.set("topic", topic);
  params.set("location", String(search.location));
  params.set("language", search.language);
  if (search.expand !== DEFAULT_EXPAND) params.set("expand", String(search.expand));
  if (search.sort !== DEFAULT_SORT) params.set("sort", search.sort);
  writeFiltersToParams(params, search.filters);
  return params;
}

/** True when there is a topic worth spending on. */
export function isContentSearchable(search: ContentSearch): boolean {
  return search.topic.trim() !== "";
}

/**
 * Identity of one *composition*, for resetting selections.
 *
 * Filters and sort are excluded on purpose: they are views over a set that has
 * already been bought, so narrowing the table must not read as a new search.
 * Expansion is included, because it changes which SERPs were paid for.
 */
export function contentSearchKey(search: ContentSearch): string {
  return [
    search.topic.trim().toLowerCase(),
    search.location,
    search.language,
    search.expand,
  ].join("|");
}

/** Everything except the filters, for the "clear the filters" affordance. */
export const EMPTY_FILTERS = EMPTY_CONTENT_FILTERS;
