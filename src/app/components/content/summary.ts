/**
 * The three numbers above the table.
 *
 * All of them are computed over the rows **currently loaded**, not over the
 * whole composed set, because the whole set is not on the client — paging
 * brings it in fifty at a time. That makes the strip a description of what you
 * are looking at, which is the honest reading and the one the labels commit to
 * ("in these results", not "for this topic").
 *
 * Nulls are the recurring problem here, and each number handles them
 * differently because each has a different right answer.
 */
import type { ContentPageRow } from "../../../shared/content";

export interface ContentSummary {
  /** Rows loaded. */
  pages: number;
  /**
   * Median Domain Score across the rows that have one.
   *
   * Median rather than mean: authority distributions are long-tailed, and a
   * single Wikipedia result in a table of small blogs drags a mean up by twenty
   * points and makes a genuinely soft SERP look competitive.
   *
   * Null when no loaded row has a score at all.
   */
  medianDomainScore: number | null;
  /** How many rows that median was taken over — see `scoredPages`. */
  scoredPages: number;
  /**
   * Summed traffic estimate over the rows that have one.
   *
   * Missing estimates contribute nothing rather than being imputed. The total
   * is therefore a floor, which is why the label says "at least" and
   * `unmeasuredPages` is reported beside it — a total of 1,200 across three of
   * forty pages means something very different from 1,200 across all forty.
   */
  totalTraffic: number;
  /** Rows with no traffic estimate — the caveat on `totalTraffic`. */
  unmeasuredPages: number;
}

/**
 * The median of a numeric list.
 *
 * Even-length lists average the two middle values, which can produce a .5 for
 * an integer scale; the caller rounds for display rather than here, so the
 * arithmetic stays exact for tests.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function summarizeContentRows(
  rows: readonly ContentPageRow[],
): ContentSummary {
  const scores: number[] = [];
  let totalTraffic = 0;
  let unmeasuredPages = 0;

  for (const row of rows) {
    if (row.domainScore !== null && Number.isFinite(row.domainScore)) {
      scores.push(row.domainScore);
    }
    if (row.estTraffic === null || !Number.isFinite(row.estTraffic)) {
      unmeasuredPages += 1;
    } else {
      totalTraffic += row.estTraffic;
    }
  }

  return {
    pages: rows.length,
    medianDomainScore: median(scores),
    scoredPages: scores.length,
    totalTraffic,
    unmeasuredPages,
  };
}
