/**
 * Putting clicks and impressions on one chart.
 *
 * **Why this file exists.** Impressions outnumber clicks by roughly ten to a
 * hundred times on any real property. The shared `TrendLineChart`
 * (`components/charts/`) draws every series against a single Y axis — it takes
 * no `yAxisId` and exposes no second axis — so plotting both raw would pin the
 * clicks line flat along the bottom of the chart, where it has no readable
 * shape at all. The one thing this chart exists to show, whether clicks are
 * keeping pace with impressions, would be the one thing it could not show.
 *
 * **What it does instead.** Each series is indexed against its own peak day in
 * the window: 100 is that line's best day, 50 is half of it. Both lines then
 * occupy the full height and their *shapes* can be compared, which is the
 * comparison worth making — a flat clicks line under a rising impressions line
 * is a CTR problem, and that reads instantly once both are visible.
 *
 * **What it costs, and how that is paid for.** The axis no longer carries real
 * counts. So the real numbers are never far away: the totals sit in the metric
 * cards directly above, and `seriesPeaks` returns each line's peak value and
 * the day it fell on for the caption underneath. The chart shows shape; the
 * numbers around it show size. Nothing here invents, smooths or interpolates a
 * value — every plotted point is a real day's measurement expressed as a
 * percentage of a real day's measurement.
 */
import type { GscDailyPoint } from "../../../shared/gsc";

/** One plotted day. Both values are 0–100, indexed to their series' peak. */
export interface GscChartPoint extends Record<string, unknown> {
  /** `YYYY-MM-DD`, straight through — the axis formats it. */
  date: string;
  /** Clicks as a percentage of the window's best clicks day. */
  clicks: number;
  /** Impressions as a percentage of the window's best impressions day. */
  impressions: number;
}

/** The real number behind a line's 100, and the day it happened. */
export interface GscSeriesPeak {
  value: number;
  date: string | null;
}

export interface GscSeriesPeaks {
  clicks: GscSeriesPeak;
  impressions: GscSeriesPeak;
}

const EMPTY_PEAK: GscSeriesPeak = { value: 0, date: null };

/**
 * Index one metric against its own maximum.
 *
 * A peak of zero — a window in which the property earned nothing at all — maps
 * every day to 0 rather than dividing by it. That draws a flat line along the
 * bottom, which is the truthful picture of a week with no clicks.
 */
function indexed(value: number, peak: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (peak <= 0) return 0;
  // Rounded to one decimal: the axis is a percentage, and float noise in the
  // tooltip ("62.99999999%") is the kind of detail that reads as a bug.
  return Math.round((value / peak) * 1000) / 10;
}

function peakOf(
  daily: ReadonlyArray<GscDailyPoint>,
  pick: (point: GscDailyPoint) => number,
): GscSeriesPeak {
  let best = EMPTY_PEAK;
  for (const point of daily) {
    const value = pick(point);
    if (!Number.isFinite(value)) continue;
    // Strictly greater, so the *first* day to reach the peak is the one named
    // — a tie should not silently drift to the end of the window.
    if (best.date === null || value > best.value) {
      best = { value, date: point.date };
    }
  }
  return best;
}

/** Each line's peak value and the day it fell on. */
export function gscSeriesPeaks(
  daily: ReadonlyArray<GscDailyPoint>,
): GscSeriesPeaks {
  return {
    clicks: peakOf(daily, (point) => point.clicks),
    impressions: peakOf(daily, (point) => point.impressions),
  };
}

/**
 * The daily series as indexed chart points.
 *
 * Order is preserved exactly as the API returned it (the worker sorts by date),
 * because a line chart reading right to left would be worse than no chart.
 */
export function gscChartPoints(
  daily: ReadonlyArray<GscDailyPoint>,
): GscChartPoint[] {
  const peaks = gscSeriesPeaks(daily);
  return daily.map((point) => ({
    date: point.date,
    clicks: indexed(point.clicks, peaks.clicks.value),
    impressions: indexed(point.impressions, peaks.impressions.value),
  }));
}

/**
 * True when there is enough to draw.
 *
 * One point is a dot, not a trend, and `TrendLineChart` renders it as an empty
 * plot area with a lone invisible vertex — an empty state says more.
 */
export function hasPlottableGscSeries(
  daily: ReadonlyArray<GscDailyPoint>,
): boolean {
  return daily.length >= 2;
}
