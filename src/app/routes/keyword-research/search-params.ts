/**
 * The Keyword Research search state, and its round trip through the URL.
 *
 * Search state lives in the query string rather than React state so a result
 * is a link: shareable with a colleague, survivable across a reload, and
 * correct under the back button. That makes the serialization a contract
 * rather than a detail, so it lives here as pure functions with tests instead
 * of inline `setSearchParams` calls scattered through the view.
 *
 * Parsing is total: every malformed value falls back rather than throwing. A
 * hand-edited or truncated URL should land the user on a sane screen, never on
 * an error boundary — and never on a request the Worker will reject at zod.
 */
import type { MarketSelection } from "../../components/keywords/market";
import {
  DEFAULT_MARKET,
  isLanguageCode,
  isLocationCode,
} from "../../components/keywords/market";

/** The three keyword tabs, in display order. */
export const KEYWORD_TABS = ["ideas", "suggestions", "related"] as const;

export type KeywordTabId = (typeof KEYWORD_TABS)[number];

export const DEFAULT_TAB: KeywordTabId = "ideas";

/** Query-string keys. Named once so the parser and builder cannot drift. */
export const SEARCH_PARAM_KEYS = {
  keyword: "q",
  location: "location",
  language: "language",
  tab: "tab",
} as const;

export interface KeywordSearchState extends MarketSelection {
  /** Empty string means "no search yet" — the landing state of the module. */
  keyword: string;
  tab: KeywordTabId;
}

export function isKeywordTab(value: unknown): value is KeywordTabId {
  return (
    typeof value === "string" &&
    (KEYWORD_TABS as readonly string[]).includes(value)
  );
}

/**
 * Reads search state out of a URL.
 *
 * `fallback` is the user's last-used market (localStorage, per workspace), so
 * arriving at a bare `/app/keyword-research` reopens the market they were last
 * working in while an explicit `?location=` in a shared link always wins.
 */
export function parseSearchParams(
  params: URLSearchParams,
  fallback: MarketSelection = DEFAULT_MARKET,
): KeywordSearchState {
  const rawLocation = params.get(SEARCH_PARAM_KEYS.location);
  const rawLanguage = params.get(SEARCH_PARAM_KEYS.language);
  const rawTab = params.get(SEARCH_PARAM_KEYS.tab);

  /*
   * Number() rather than parseInt(): parseInt("2826abc") is 2826, which would
   * send a code the user never chose to a paid endpoint. Number() rejects the
   * whole string, and the fallback applies.
   */
  const location = Number(rawLocation);

  return {
    keyword: (params.get(SEARCH_PARAM_KEYS.keyword) ?? "").trim(),
    locationCode:
      rawLocation !== null && isLocationCode(location)
        ? location
        : fallback.locationCode,
    languageCode:
      rawLanguage !== null && isLanguageCode(rawLanguage)
        ? rawLanguage.trim()
        : fallback.languageCode,
    tab: isKeywordTab(rawTab) ? rawTab : DEFAULT_TAB,
  };
}

/**
 * Writes search state back to a URL.
 *
 * An empty keyword produces empty params — the module's landing state should
 * have a clean address, not `?q=&location=2826`. The default tab is likewise
 * omitted, so the common link is the short one and `?tab=related` means
 * something when you see it.
 */
export function buildSearchParams(state: KeywordSearchState): URLSearchParams {
  const params = new URLSearchParams();
  const keyword = state.keyword.trim();
  if (keyword === "") return params;

  params.set(SEARCH_PARAM_KEYS.keyword, keyword);
  params.set(SEARCH_PARAM_KEYS.location, String(state.locationCode));
  params.set(SEARCH_PARAM_KEYS.language, state.languageCode);
  if (state.tab !== DEFAULT_TAB) params.set(SEARCH_PARAM_KEYS.tab, state.tab);
  return params;
}

/** `buildSearchParams` as the string react-router's `to` prop wants. */
export function buildSearchString(state: KeywordSearchState): string {
  const params = buildSearchParams(state);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
