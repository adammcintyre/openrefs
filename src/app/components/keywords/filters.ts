/**
 * The keyword table's filter row: min/max volume, min/max difficulty, and an
 * include/exclude substring.
 *
 * These filter the rows already loaded rather than re-querying. That is a
 * deliberate v1 choice and a cost one: the Worker does accept the same filters
 * as query parameters, but routing every keystroke through them would bill the
 * user for a fresh DataForSEO page each time they nudge a bound. Filtering
 * client-side makes the control free; "Load more" is what spends.
 *
 * State is held as strings because it comes straight from text inputs, and a
 * half-typed "-" or "1e" has to be representable without becoming NaN.
 */
import type { KeywordRow } from "../../../shared/keywords";

export interface KeywordFilterState {
  minVolume: string;
  maxVolume: string;
  minDifficulty: string;
  maxDifficulty: string;
  /** Keyword must contain this (case-insensitive). */
  include: string;
  /** Keyword must not contain this (case-insensitive). */
  exclude: string;
}

export const EMPTY_FILTERS: KeywordFilterState = {
  minVolume: "",
  maxVolume: "",
  minDifficulty: "",
  maxDifficulty: "",
  include: "",
  exclude: "",
};

/**
 * A bound as a number, or null when the field is empty or not yet a number.
 *
 * An unparseable bound reads as "no bound" rather than "match nothing", so the
 * table does not empty itself while someone is mid-keystroke.
 */
export function parseBound(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** True when any control in the row is doing something. */
export function isFilterActive(filters: KeywordFilterState): boolean {
  return (
    parseBound(filters.minVolume) !== null ||
    parseBound(filters.maxVolume) !== null ||
    parseBound(filters.minDifficulty) !== null ||
    parseBound(filters.maxDifficulty) !== null ||
    filters.include.trim() !== "" ||
    filters.exclude.trim() !== ""
  );
}

/**
 * Applies one numeric bound pair to a metric.
 *
 * The null case is the interesting one. `null` from the API means "not
 * reported", never zero (see src/shared/keywords.ts), so a row whose volume is
 * unknown cannot be shown to satisfy "volume >= 100" — and quietly treating
 * unknown as 0 would let it fail "volume <= 50" just as wrongly. Unknown rows
 * are therefore excluded whenever a bound on that metric is active, and kept
 * whenever it is not.
 */
function withinBounds(
  value: number | null | undefined,
  min: number | null,
  max: number | null,
): boolean {
  if (min === null && max === null) return true;
  if (value === null || value === undefined) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

/** Case-insensitive substring test used by both include and exclude. */
function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

export function matchesKeywordFilters(
  row: KeywordRow,
  filters: KeywordFilterState,
): boolean {
  if (
    !withinBounds(
      row.searchVolume,
      parseBound(filters.minVolume),
      parseBound(filters.maxVolume),
    )
  ) {
    return false;
  }

  if (
    !withinBounds(
      row.keywordDifficulty,
      parseBound(filters.minDifficulty),
      parseBound(filters.maxDifficulty),
    )
  ) {
    return false;
  }

  const include = filters.include.trim();
  if (include !== "" && !contains(row.keyword, include)) return false;

  const exclude = filters.exclude.trim();
  if (exclude !== "" && contains(row.keyword, exclude)) return false;

  return true;
}

export function filterKeywordRows(
  rows: ReadonlyArray<KeywordRow>,
  filters: KeywordFilterState,
): KeywordRow[] {
  if (!isFilterActive(filters)) return [...rows];
  return rows.filter((row) => matchesKeywordFilters(row, filters));
}
