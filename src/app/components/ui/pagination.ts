/**
 * Pagination arithmetic, kept separate from the table component so it can be
 * unit-tested without a DOM. The off-by-one traps here (an empty table must
 * read "0 of 0", not "1-0 of 0"; a partial last page must not claim rows it
 * does not have) are exactly the kind that survive a visual review.
 */
export interface PageRange {
  /** 1-based index of the first row on the page; 0 when there are no rows. */
  from: number;
  /** 1-based index of the last row on the page; 0 when there are no rows. */
  to: number;
  total: number;
  pageCount: number;
}

export function pageRange(
  pageIndex: number,
  pageSize: number,
  total: number,
): PageRange {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeSize = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.ceil(safeTotal / safeSize);

  if (safeTotal === 0) {
    return { from: 0, to: 0, total: 0, pageCount: 0 };
  }

  // Clamp rather than trust the caller: a page index left over from a larger
  // result set would otherwise render a range past the end of the data.
  const safeIndex = Math.min(Math.max(0, Math.trunc(pageIndex)), pageCount - 1);
  const from = safeIndex * safeSize + 1;
  const to = Math.min(from + safeSize - 1, safeTotal);

  return { from, to, total: safeTotal, pageCount };
}

/** "1–25 of 320", or "No rows" when empty. */
export function formatPageRange(range: PageRange): string {
  if (range.total === 0) return "No rows";
  return `${range.from.toLocaleString()}–${range.to.toLocaleString()} of ${range.total.toLocaleString()}`;
}
