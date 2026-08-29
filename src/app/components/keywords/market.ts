/**
 * The market (location + language) a research query runs in, and where the
 * user's last choice is remembered.
 *
 * Validation lives here rather than at the call sites because two different
 * untrusted sources feed this: the URL query string and localStorage. Both can
 * hold anything, and a bad value must never reach a paid endpoint — the Worker
 * would reject it at zod, but only after the round trip.
 */

/** UK. `docs/ARCHITECTURE.md` names UK + US as the default markets. */
export const DEFAULT_LOCATION_CODE = 2826;

export const DEFAULT_LANGUAGE_CODE = "en";

export interface MarketSelection {
  /** DataForSEO numeric location code, e.g. 2826 for the United Kingdom. */
  locationCode: number;
  /** ISO 639-1, occasionally with a region suffix — "en", "pt-BR". */
  languageCode: string;
}

export const DEFAULT_MARKET: MarketSelection = {
  locationCode: DEFAULT_LOCATION_CODE,
  languageCode: DEFAULT_LANGUAGE_CODE,
};

/** Mirrors `locationParam` in the Worker: a positive integer. */
export function isLocationCode(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Mirrors `languageParam` in the Worker: 2–8 letters and hyphens. */
export function isLanguageCode(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.length >= 2 && trimmed.length <= 8 && /^[A-Za-z-]+$/.test(trimmed)
  );
}

/**
 * Storage key for the last-used market.
 *
 * Scoped per workspace: markets are a property of the work, and someone who
 * researches a US site in one workspace and a UK one in another should not
 * have the two overwrite each other.
 */
export function marketStorageKey(workspaceId: string): string {
  return `openrefs.market.${workspaceId}`;
}

/**
 * Reads the remembered market, falling back to the default on anything
 * unexpected — absent, unparseable, wrong shape, or written by a future
 * version of the app. Storage itself can also throw (Safari private mode),
 * which is why the whole read is guarded.
 */
export function readStoredMarket(workspaceId: string): MarketSelection {
  try {
    const raw = globalThis.localStorage?.getItem(marketStorageKey(workspaceId));
    if (typeof raw !== "string") return DEFAULT_MARKET;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_MARKET;

    const { locationCode, languageCode } = parsed as Partial<MarketSelection>;
    if (!isLocationCode(locationCode) || !isLanguageCode(languageCode)) {
      return DEFAULT_MARKET;
    }
    return { locationCode, languageCode: languageCode.trim() };
  } catch {
    return DEFAULT_MARKET;
  }
}

/** Best-effort persist. Losing the preference is not worth an error path. */
export function writeStoredMarket(
  workspaceId: string,
  market: MarketSelection,
): void {
  try {
    globalThis.localStorage?.setItem(
      marketStorageKey(workspaceId),
      JSON.stringify(market),
    );
  } catch {
    /* storage unavailable — the in-memory selection still works this session */
  }
}

/**
 * Picks the language to use for a market, given the languages that market
 * actually supports.
 *
 * DataForSEO treats a location/language pair outside its own list as an
 * upstream error, so switching location has to re-check the language rather
 * than carry it over blindly. Preference order: keep the current language if
 * it is still valid, else English if offered, else the market's first.
 * `null` when the location advertises no languages at all, which leaves the
 * caller's existing choice untouched rather than blanking the select.
 */
export function resolveLanguageForLocation(
  current: string,
  languages: ReadonlyArray<{ code: string }>,
): string | null {
  if (languages.length === 0) return null;

  const normalized = current.trim().toLowerCase();
  const match = languages.find(
    (language) => language.code.trim().toLowerCase() === normalized,
  );
  if (match) return match.code;

  const english = languages.find(
    (language) => language.code.trim().toLowerCase() === DEFAULT_LANGUAGE_CODE,
  );
  return english?.code ?? languages[0]?.code ?? null;
}
