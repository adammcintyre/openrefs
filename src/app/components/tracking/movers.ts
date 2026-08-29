/**
 * The movers panel: which keywords went up, and which went down, over 7 days.
 *
 * Selection rather than sorting. The panel answers "what changed this week",
 * so a keyword that did not move is not a mover, and one with no baseline
 * seven days ago is not "flat" — it is unmeasured, and putting it in either
 * list would be inventing a result. Both are excluded.
 *
 * Ordering is total and deterministic: by size of move, then — for the ties
 * that are common when a whole page shifts by one — alphabetically. Without
 * the second key the panel would reshuffle between renders of identical data,
 * which reads as flicker and makes the list impossible to scan.
 */
import type { TrackedKeywordRow } from "../../../shared/tracking";

/** How many of each direction the panel shows. */
export const MOVERS_LIMIT = 5;

export interface Movers {
  /** Biggest improvements first (change is positive). */
  gainers: TrackedKeywordRow[];
  /** Biggest drops first (change is negative). */
  losers: TrackedKeywordRow[];
}

/**
 * Top gainers and top losers over 7 days.
 *
 * `change7d` is already signed so that positive means improved (see
 * src/shared/tracking.ts) — this does not re-invert it. "Biggest gain" is
 * therefore the largest positive number, and "biggest drop" the most negative.
 */
export function selectMovers(
  rows: ReadonlyArray<TrackedKeywordRow>,
  limit: number = MOVERS_LIMIT,
): Movers {
  const moved = rows.filter(
    (row) => row.change7d !== null && row.change7d !== 0,
  );

  const gainers = moved
    .filter((row) => (row.change7d ?? 0) > 0)
    .sort(byMagnitudeThenKeyword)
    .slice(0, limit);

  const losers = moved
    .filter((row) => (row.change7d ?? 0) < 0)
    .sort(byMagnitudeThenKeyword)
    .slice(0, limit);

  return { gainers, losers };
}

/**
 * Largest move first, then keyword A→Z.
 *
 * Magnitude rather than signed value, so the same comparator orders both
 * lists: the biggest gain and the biggest drop are both the largest |change|.
 */
function byMagnitudeThenKeyword(
  a: TrackedKeywordRow,
  b: TrackedKeywordRow,
): number {
  const sizeA = Math.abs(a.change7d ?? 0);
  const sizeB = Math.abs(b.change7d ?? 0);
  if (sizeA !== sizeB) return sizeB - sizeA;
  return a.keyword.localeCompare(b.keyword, "en");
}

/** True when there is nothing to show, so the panel can excuse itself. */
export function hasMovers(movers: Movers): boolean {
  return movers.gainers.length > 0 || movers.losers.length > 0;
}
