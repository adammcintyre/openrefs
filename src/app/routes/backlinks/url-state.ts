/**
 * The URL is the module's state.
 *
 * Same contract as Domain Overview's `url-state.ts`: everything that decides
 * *what report am I looking at* lives in the query string, so a link profile can
 * be reloaded, bookmarked and pasted to a colleague and come back identical.
 * Nothing here touches React, which is what makes it testable without a DOM.
 *
 * Two differences from that module, both forced by the API:
 *
 *  - **No location or language.** A link profile is a property of the web, not
 *    of a market, and none of the `/backlinks/*` endpoints accepts a location
 *    code. There is no market to carry, so none is carried.
 *  - **`target` may be a URL.** See `components/backlinks/target.ts`.
 *
 * `mode`, `sort` and `range` ride along in the URL because they are part of the
 * report's identity rather than transient UI: "one link per domain, strongest
 * first, last six months" is what someone means when they send the link.
 * Filters deliberately do not — they are server-side and therefore billed, and
 * an Apply button is the right gate for a purchase.
 *
 * Reading is total: any garbage resolves to a usable state rather than an error
 * one, so a hand-edited `?tab=banana` cannot strand the page.
 */
import type { BacklinkSort, BacklinksListMode } from "../../../shared/backlinks";
import { BACKLINKS_LIST_MODES, BACKLINK_SORTS } from "../../../shared/backlinks";
import {
  isLikelyTarget,
  normalizeTarget,
} from "../../components/backlinks/target";
import type { HistoryRange } from "./history-range";
import { DEFAULT_RANGE, HISTORY_RANGES } from "./history-range";

export const BACKLINK_TABS = ["backlinks", "referring", "anchors"] as const;

export type BacklinkTabId = (typeof BACKLINK_TABS)[number];

export const DEFAULT_TAB: BacklinkTabId = "backlinks";

/**
 * One link per referring domain by default.
 *
 * A raw link list is dominated by whichever site links a thousand times from
 * its footer; the grouped view answers "who links to me", which is the question
 * people actually open this screen with.
 */
export const DEFAULT_MODE: BacklinksListMode = "one_per_domain";

/**
 * Strongest linking domains first.
 *
 * The same order the module shipped with when the sort was fixed, so the
 * default view of every existing bookmark is unchanged — and the right default
 * regardless: the first question of a link profile is "who important links to
 * me", not "what came in most recently".
 */
export const DEFAULT_SORT: BacklinkSort = "domain_score";

/** Everything the query string carries. */
export interface BacklinksSearch {
  /** Normalised domain or URL, or "" when nothing has been searched yet. */
  target: string;
  tab: BacklinkTabId;
  mode: BacklinksListMode;
  sort: BacklinkSort;
  range: HistoryRange;
}

function readTab(raw: string | null): BacklinkTabId {
  return BACKLINK_TABS.includes(raw as BacklinkTabId)
    ? (raw as BacklinkTabId)
    : DEFAULT_TAB;
}

function readMode(raw: string | null): BacklinksListMode {
  return BACKLINKS_LIST_MODES.includes(raw as BacklinksListMode)
    ? (raw as BacklinksListMode)
    : DEFAULT_MODE;
}

function readSort(raw: string | null): BacklinkSort {
  return BACKLINK_SORTS.includes(raw as BacklinkSort)
    ? (raw as BacklinkSort)
    : DEFAULT_SORT;
}

function readRange(raw: string | null): HistoryRange {
  return HISTORY_RANGES.includes(raw as HistoryRange)
    ? (raw as HistoryRange)
    : DEFAULT_RANGE;
}

/** Parse the query string into a search. */
export function readBacklinksSearch(params: URLSearchParams): BacklinksSearch {
  return {
    target: normalizeTarget(params.get("target") ?? ""),
    tab: readTab(params.get("tab")),
    mode: readMode(params.get("mode")),
    sort: readSort(params.get("sort")),
    range: readRange(params.get("range")),
  };
}

/**
 * Serialise back to a query string.
 *
 * Only the parts carrying information are written: with no target there is
 * nothing to describe, and every default stays implicit so the common URL is
 * short enough to read in an address bar.
 */
export function backlinksSearchParams(
  search: BacklinksSearch,
): URLSearchParams {
  const params = new URLSearchParams();
  const target = normalizeTarget(search.target);
  if (target === "") return params;

  params.set("target", target);
  if (search.tab !== DEFAULT_TAB) params.set("tab", search.tab);
  if (search.mode !== DEFAULT_MODE) params.set("mode", search.mode);
  if (search.sort !== DEFAULT_SORT) params.set("sort", search.sort);
  if (search.range !== DEFAULT_RANGE) params.set("range", search.range);
  return params;
}

/** True when there is something worth spending a DataForSEO call on. */
export function isSearchable(search: BacklinksSearch): boolean {
  return search.target !== "" && isLikelyTarget(search.target);
}
