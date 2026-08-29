/**
 * The URL is the module's state.
 *
 * Everything that decides *what was queried* — the domain, the market, the
 * open tab — lives in the query string, so a Domain Overview screen can be
 * reloaded, bookmarked, opened in a second tab or pasted to a colleague and
 * come back identical. Nothing here touches React; it is all string in, value
 * out, which is also what makes it testable without a DOM.
 *
 * Reading is deliberately total: any garbage in the URL resolves to a usable
 * search rather than an error state, because a hand-edited `?location=banana`
 * should not be able to put the page in a state the user cannot get out of.
 */
import {
  isLikelyDomain,
  normalizeDomainInput,
} from "../../components/domains/format";

export const DOMAIN_TABS = [
  "keywords",
  "pages",
  "competitors",
  "countries",
] as const;

export type DomainTabId = (typeof DOMAIN_TABS)[number];

export const DEFAULT_TAB: DomainTabId = "keywords";

/** A location code + the language it is queried in. */
export interface Market {
  location: number;
  language: string;
}

/** Everything the URL carries. */
export interface DomainSearch extends Market {
  /** Normalised hostname, or "" when nothing has been searched yet. */
  target: string;
  tab: DomainTabId;
}

/**
 * United Kingdom, English. Per docs/ARCHITECTURE.md the default markets are UK
 * and US; the UK code 2826 is the one verified against DataForSEO's Labs
 * locations list (which is country-level only — see routes/meta.ts).
 */
export const DEFAULT_MARKET: Market = { location: 2826, language: "en" };

function readLocation(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function readLanguage(raw: string | null, fallback: string): string {
  if (raw === null) return fallback;
  const value = raw.trim().toLowerCase();
  // Same shape the Worker's languageParam accepts; anything else is fallback.
  return /^[a-z]{2,8}(-[a-z0-9]{2,8})?$/.test(value) ? value : fallback;
}

function readTab(raw: string | null): DomainTabId {
  return DOMAIN_TABS.includes(raw as DomainTabId) ? (raw as DomainTabId) : DEFAULT_TAB;
}

/**
 * Parse the query string into a search.
 *
 * `fallback` is the workspace's last-used market, so a bare
 * `/app/domain-overview` opens on the market the user works in rather than
 * resetting to the UK every time.
 */
export function readDomainSearch(
  params: URLSearchParams,
  fallback: Market = DEFAULT_MARKET,
): DomainSearch {
  return {
    target: normalizeDomainInput(params.get("target") ?? ""),
    location: readLocation(params.get("location"), fallback.location),
    language: readLanguage(params.get("language"), fallback.language),
    tab: readTab(params.get("tab")),
  };
}

/**
 * Serialise back to a query string.
 *
 * Only the parts that carry information are written: with no target there is
 * nothing to describe, and the default tab is left implicit so the common URL
 * stays short enough to read.
 */
export function domainSearchParams(search: DomainSearch): URLSearchParams {
  const params = new URLSearchParams();
  const target = normalizeDomainInput(search.target);
  if (target === "") return params;

  params.set("target", target);
  params.set("location", String(search.location));
  params.set("language", search.language);
  if (search.tab !== DEFAULT_TAB) params.set("tab", search.tab);
  return params;
}

/** True when there is something worth spending a DataForSEO call on. */
export function isSearchable(search: DomainSearch): boolean {
  return search.target !== "" && isLikelyDomain(search.target);
}

/**
 * Identity of one market+domain query, for cache keys and for deciding when a
 * lazily-loaded tab's "the user asked for this" flag no longer applies. The
 * tab is excluded on purpose: switching tabs must not invalidate anything.
 */
export function searchKey(search: DomainSearch): string {
  return `${search.target}|${search.location}|${search.language}`;
}
