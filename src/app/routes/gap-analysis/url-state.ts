/**
 * The URL is the module's state.
 *
 * `?target=&competitors=a,b,c&location=&language=&mode=` describes a whole
 * comparison, so a gap report can be reloaded, bookmarked, or pasted to a
 * colleague and come back identical — competitor set included, which is the
 * part that would be tedious to rebuild by hand.
 *
 * Reading is deliberately total: any garbage resolves to a usable search rather
 * than an error state. That matters more here than on a single-domain screen,
 * because this URL carries a list a user may well have hand-edited, and one bad
 * entry should cost that entry rather than the whole report.
 *
 * Filters are **not** in the URL. They are a billed server-side query the user
 * applies deliberately, and a bookmarked link that spends on six filter
 * conditions the moment it opens is a trap; they live in component state.
 */
import type { GapMode } from "../../../shared/gap";
import { GAP_MODES } from "../../../shared/gap";
import {
  parseCompetitorList,
  hasCompetitors,
} from "../../components/gap/competitors";
import {
  isLikelyDomain,
  normalizeDomainInput,
} from "../../components/domains/format";

/** A location code + the language it is queried in. */
export interface GapMarket {
  location: number;
  language: string;
}

/** Everything the URL carries. */
export interface GapSearch extends GapMarket {
  /** Your domain, normalised. "" when nothing has been searched yet. */
  target: string;
  /** Normalised competitor hostnames, in the order they will be columns. */
  competitors: string[];
  mode: GapMode;
}

/**
 * United Kingdom, English — the same default the other research modules use
 * (docs/ARCHITECTURE.md; 2826 is the verified Labs location code).
 */
export const DEFAULT_MARKET: GapMarket = { location: 2826, language: "en" };

/**
 * `missing` is the strongest signal in the set — every competitor ranks and you
 * do not — and it is also the Worker's own default, so an omitted `?mode=`
 * means the same thing on both sides.
 */
export const DEFAULT_MODE: GapMode = "missing";

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

function readMode(raw: string | null): GapMode {
  return GAP_MODES.includes(raw as GapMode) ? (raw as GapMode) : DEFAULT_MODE;
}

/**
 * Parse the query string into a search.
 *
 * `fallback` is the workspace's last-used market, so a bare `/app/gap-analysis`
 * opens on the market the user works in rather than resetting to the UK.
 */
export function readGapSearch(
  params: URLSearchParams,
  fallback: GapMarket = DEFAULT_MARKET,
): GapSearch {
  const target = normalizeDomainInput(params.get("target") ?? "");
  return {
    target,
    // Parsing against the target drops "competitor = you", which upstream
    // would refuse to compare anyway.
    competitors: parseCompetitorList(params.get("competitors") ?? "", target),
    location: readLocation(params.get("location"), fallback.location),
    language: readLanguage(params.get("language"), fallback.language),
    mode: readMode(params.get("mode")),
  };
}

/**
 * Serialise back to a query string.
 *
 * Only the parts that carry information are written, and the default mode is
 * left implicit, so the common URL stays short enough to read at a glance.
 */
export function gapSearchParams(search: GapSearch): URLSearchParams {
  const params = new URLSearchParams();
  const target = normalizeDomainInput(search.target);
  const competitors = parseCompetitorList(search.competitors.join(","), target);

  if (target === "" && competitors.length === 0) return params;

  if (target !== "") params.set("target", target);
  if (competitors.length > 0) params.set("competitors", competitors.join(","));
  params.set("location", String(search.location));
  params.set("language", search.language);
  if (search.mode !== DEFAULT_MODE) params.set("mode", search.mode);
  return params;
}

/**
 * True when there is something worth spending on: a real domain of your own
 * and at least one competitor to compare it against.
 */
export function isGapSearchable(search: GapSearch): boolean {
  return (
    search.target !== "" &&
    isLikelyDomain(search.target) &&
    hasCompetitors(search.competitors)
  );
}

/**
 * Identity of one comparison, for cache keys and for re-syncing the form.
 *
 * The mode is excluded on purpose: it selects a view over rows the query
 * already covers, so switching tabs must not read as a different search.
 */
export function gapSearchKey(search: GapSearch): string {
  return [
    search.target,
    search.competitors.join(","),
    search.location,
    search.language,
  ].join("|");
}
