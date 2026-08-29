/**
 * The Top keywords filter row, as data.
 *
 * These filters are **server-side**: DataForSEO applies them, so changing one
 * is a new billed query rather than a re-sift of rows already paid for. That is
 * why the row has an explicit Apply instead of filtering as you type, and why
 * the parsed shape is a value that can go straight into a query key —
 * `undefined` for "not set" so an untouched field cannot fork the cache.
 */

/** What the inputs hold: strings, because that is what an <input> gives you. */
export interface FilterDraft {
  minVolume: string;
  maxVolume: string;
  minPosition: string;
  maxPosition: string;
  include: string;
  exclude: string;
}

/** What the API takes. */
export interface KeywordFilters {
  minVolume?: number;
  maxVolume?: number;
  minPosition?: number;
  maxPosition?: number;
  include?: string;
  exclude?: string;
}

export const EMPTY_DRAFT: FilterDraft = {
  minVolume: "",
  maxVolume: "",
  minPosition: "",
  maxPosition: "",
  include: "",
  exclude: "",
};

export const EMPTY_FILTERS: KeywordFilters = {};

function num(raw: string, { min = 0 }: { min?: number } = {}): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min) return undefined;
  return value;
}

function text(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Draft to query params, dropping anything blank or nonsensical.
 *
 * Swapped bounds (min above max) are corrected rather than sent: DataForSEO
 * would happily accept `volume >= 900 AND volume <= 100`, charge for it, and
 * return nothing, which reads to the user as "this domain ranks for nothing".
 */
export function parseFilterDraft(draft: FilterDraft): KeywordFilters {
  const filters: KeywordFilters = {};

  let minVolume = num(draft.minVolume);
  let maxVolume = num(draft.maxVolume);
  if (minVolume !== undefined && maxVolume !== undefined && minVolume > maxVolume) {
    [minVolume, maxVolume] = [maxVolume, minVolume];
  }

  // Positions are 1-based; a "min position 0" is a typo, not a filter.
  let minPosition = num(draft.minPosition, { min: 1 });
  let maxPosition = num(draft.maxPosition, { min: 1 });
  if (
    minPosition !== undefined &&
    maxPosition !== undefined &&
    minPosition > maxPosition
  ) {
    [minPosition, maxPosition] = [maxPosition, minPosition];
  }

  if (minVolume !== undefined) filters.minVolume = minVolume;
  if (maxVolume !== undefined) filters.maxVolume = maxVolume;
  if (minPosition !== undefined) filters.minPosition = minPosition;
  if (maxPosition !== undefined) filters.maxPosition = maxPosition;

  const include = text(draft.include);
  const exclude = text(draft.exclude);
  if (include !== undefined) filters.include = include;
  if (exclude !== undefined) filters.exclude = exclude;

  return filters;
}

/** Applied filters back to a draft, so the row reopens showing what is on. */
export function toFilterDraft(filters: KeywordFilters): FilterDraft {
  return {
    minVolume: filters.minVolume === undefined ? "" : String(filters.minVolume),
    maxVolume: filters.maxVolume === undefined ? "" : String(filters.maxVolume),
    minPosition:
      filters.minPosition === undefined ? "" : String(filters.minPosition),
    maxPosition:
      filters.maxPosition === undefined ? "" : String(filters.maxPosition),
    include: filters.include ?? "",
    exclude: filters.exclude ?? "",
  };
}

/** How many filters are on — drives the count badge next to "Filters". */
export function activeFilterCount(filters: KeywordFilters): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

/** Every input blank. Drives whether "Clear" has anything to do. */
export function isDraftEmpty(draft: FilterDraft): boolean {
  return Object.values(draft).every((value) => value.trim() === "");
}
