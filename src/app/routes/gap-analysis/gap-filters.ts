/**
 * The gap table's filter row, as data.
 *
 * These filters are **server-side**: DataForSEO applies them inside the
 * intersection query, so changing one is a new billed call per competitor
 * rather than a re-sift of rows already paid for. That is why the row has an
 * explicit Apply instead of filtering as you type, and why the parsed shape
 * uses `undefined` for "not set" — an untouched field must not fork the cache.
 *
 * Volume and difficulty rather than position, because position is what the
 * comparison itself is about: "you rank badly" is the `weak` mode, not a
 * filter.
 */

/** What the inputs hold: strings, because that is what an <input> gives you. */
export interface GapFilterDraft {
  minVolume: string;
  maxVolume: string;
  minDifficulty: string;
  maxDifficulty: string;
  include: string;
  exclude: string;
}

/** What the API takes. Field names match the Worker's rangeQuerySchema. */
export interface GapFilters {
  minVolume?: number;
  maxVolume?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
  include?: string;
  exclude?: string;
}

export const EMPTY_GAP_DRAFT: GapFilterDraft = {
  minVolume: "",
  maxVolume: "",
  minDifficulty: "",
  maxDifficulty: "",
  include: "",
  exclude: "",
};

export const EMPTY_GAP_FILTERS: GapFilters = {};

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

/** Difficulty is a 0–100 scale on both sides; the Worker 422s outside it. */
function clamp(value: number | undefined, min: number, max: number) {
  if (value === undefined) return undefined;
  return Math.min(max, Math.max(min, value));
}

/**
 * Draft to query params, dropping anything blank or nonsensical.
 *
 * Swapped bounds are corrected rather than sent: DataForSEO would happily
 * accept `volume >= 900 AND volume <= 100`, charge for it, and return nothing —
 * which reads to the user as "we have no gaps with these competitors" rather
 * than as the typo it is. Out-of-range difficulty is clamped for the same
 * reason: a typed "150" should mean "as hard as it gets", not a 422.
 */
export function parseGapFilterDraft(draft: GapFilterDraft): GapFilters {
  const filters: GapFilters = {};

  let minVolume = clamp(num(draft.minVolume), 0, Number.MAX_SAFE_INTEGER);
  let maxVolume = clamp(num(draft.maxVolume), 0, Number.MAX_SAFE_INTEGER);
  if (minVolume !== undefined && maxVolume !== undefined && minVolume > maxVolume) {
    [minVolume, maxVolume] = [maxVolume, minVolume];
  }

  let minDifficulty = clamp(num(draft.minDifficulty), 0, 100);
  let maxDifficulty = clamp(num(draft.maxDifficulty), 0, 100);
  if (
    minDifficulty !== undefined &&
    maxDifficulty !== undefined &&
    minDifficulty > maxDifficulty
  ) {
    [minDifficulty, maxDifficulty] = [maxDifficulty, minDifficulty];
  }

  if (minVolume !== undefined) filters.minVolume = minVolume;
  if (maxVolume !== undefined) filters.maxVolume = maxVolume;
  if (minDifficulty !== undefined) filters.minDifficulty = minDifficulty;
  if (maxDifficulty !== undefined) filters.maxDifficulty = maxDifficulty;

  const include = text(draft.include);
  const exclude = text(draft.exclude);
  if (include !== undefined) filters.include = include;
  if (exclude !== undefined) filters.exclude = exclude;

  return filters;
}

/** Applied filters back to a draft, so the row reopens showing what is on. */
export function toGapFilterDraft(filters: GapFilters): GapFilterDraft {
  return {
    minVolume: filters.minVolume === undefined ? "" : String(filters.minVolume),
    maxVolume: filters.maxVolume === undefined ? "" : String(filters.maxVolume),
    minDifficulty:
      filters.minDifficulty === undefined ? "" : String(filters.minDifficulty),
    maxDifficulty:
      filters.maxDifficulty === undefined ? "" : String(filters.maxDifficulty),
    include: filters.include ?? "",
    exclude: filters.exclude ?? "",
  };
}

/** How many filters are on — drives the count badge next to "Filters". */
export function activeGapFilterCount(filters: GapFilters): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

/** Every input blank. Drives whether "Clear" has anything to do. */
export function isGapDraftEmpty(draft: GapFilterDraft): boolean {
  return Object.values(draft).every((value) => value.trim() === "");
}
