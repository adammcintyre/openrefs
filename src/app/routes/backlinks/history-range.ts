/**
 * The history chart's range picker — and, more importantly, why pressing it
 * costs nothing.
 *
 * The obvious implementation sends `from`/`to` to `/backlinks/history` and buys
 * a new series per range. This one buys the full series once, from the
 * provider's own index start, and slices it here. Three reasons, in order of
 * how much they matter:
 *
 * 1. **Each range would otherwise be a separate purchase.** Flicking 6m → 1y →
 *    all is three billed calls for data the first one already contained.
 * 2. It is instant, and a picker that stalls behind a network round trip stops
 *    feeling like a picker.
 * 3. One cache entry per target rather than three, so the second visit is free
 *    whichever range the link carried.
 *
 * The slicing rule comes from the shared types: **plot by `period`, never by
 * index** — DataForSEO can and does omit months, so `items[i]` is not month i.
 * `YYYY-MM` strings compare correctly with `<`, so no date parsing is needed.
 */

export const HISTORY_RANGES = ["6m", "1y", "all"] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** A year reads as a trend without being so long the recent months compress. */
export const DEFAULT_RANGE: HistoryRange = "1y";

/** How many months each range shows, inclusive of the current one. */
const MONTHS: Record<HistoryRange, number | null> = {
  "6m": 6,
  "1y": 12,
  all: null,
};

export const RANGE_LABELS: Record<HistoryRange, string> = {
  "6m": "6 months",
  "1y": "1 year",
  all: "All time",
};

/** Short label for the button itself. */
export const RANGE_SHORT: Record<HistoryRange, string> = {
  "6m": "6m",
  "1y": "1y",
  all: "All",
};

/**
 * The earliest `YYYY-MM` a range includes, or null when it includes everything.
 *
 * Built by arithmetic on UTC months rather than by subtracting days: "six months
 * ago" from the 31st is a date that does not exist in four of the twelve
 * possible answers, and `Date.UTC` normalising that into the next month would
 * quietly drop a month off the chart.
 */
export function rangeCutoff(range: HistoryRange, now: Date): string | null {
  const months = MONTHS[range];
  if (months === null) return null;

  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
  );
  const year = start.getUTCFullYear();
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * The points a range covers.
 *
 * Points with no `period` are dropped rather than kept at the end: there is no
 * position on a time axis for a month the provider did not name, and drawing one
 * anyway would put a fabricated data point in a chart people read as a trend.
 */
export function sliceHistory<T extends { period: string | null }>(
  points: ReadonlyArray<T>,
  range: HistoryRange,
  now: Date = new Date(),
): T[] {
  const cutoff = rangeCutoff(range, now);
  return points.filter(
    (point) =>
      point.period !== null && (cutoff === null || point.period >= cutoff),
  );
}

/** Every `YYYY-MM` from `first` to `last` inclusive. Empty if they invert. */
export function monthRange(first: string, last: string): string[] {
  const start = parseMonth(first);
  const end = parseMonth(last);
  if (start === null || end === null || start > end) return [];

  const months: string[] = [];
  for (let index = start; index <= end; index += 1) {
    months.push(formatMonth(index));
  }
  return months;
}

/** `YYYY-MM` to a month ordinal, so arithmetic never touches a day of month. */
function parseMonth(period: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (match === null) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return Number(match[1]) * 12 + (month - 1);
}

function formatMonth(ordinal: number): string {
  const year = Math.floor(ordinal / 12);
  const month = String((ordinal % 12) + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** One point of the history chart. `null` is a month with no data. */
export interface HistorySeriesPoint {
  period: string;
  backlinks: number | null;
  referringDomains: number | null;
}

/**
 * The chart's data: sliced to the range, then **gap-filled**.
 *
 * The gap-filling is the part that matters. DataForSEO omits months it has
 * nothing for, so a series that jumps March → June would otherwise be drawn as
 * one straight line between them and read as three months of steady growth that
 * were never measured. Inserting the missing months as nulls makes Recharts
 * break the line instead, which is the honest picture.
 */
export function historySeries(
  points: ReadonlyArray<{
    period: string | null;
    backlinks: number | null;
    referringDomains: number | null;
  }>,
  range: HistoryRange,
  now: Date = new Date(),
): HistorySeriesPoint[] {
  const inRange = sliceHistory(points, range, now);
  if (inRange.length === 0) return [];

  const byPeriod = new Map(
    inRange.map((point) => [point.period as string, point]),
  );
  const periods = [...byPeriod.keys()].sort();
  const first = periods[0];
  const last = periods.at(-1);
  if (first === undefined || last === undefined) return [];

  const months = monthRange(first, last);
  // A period the provider sent in a shape we cannot place on a month axis
  // leaves `months` empty; fall back to what we were given rather than an
  // empty chart.
  const axis = months.length === 0 ? periods : months;

  return axis.map((period) => {
    const point = byPeriod.get(period);
    return {
      period,
      backlinks: point?.backlinks ?? null,
      referringDomains: point?.referringDomains ?? null,
    };
  });
}
