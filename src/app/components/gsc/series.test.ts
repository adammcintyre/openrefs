import { describe, expect, it } from "vitest";

import type { GscDailyPoint } from "../../../shared/gsc";
import { gscChartPoints, gscSeriesPeaks, hasPlottableGscSeries } from "./series";

function day(
  date: string,
  clicks: number,
  impressions: number,
): GscDailyPoint {
  return {
    date,
    clicks,
    impressions,
    ctr: impressions === 0 ? 0 : clicks / impressions,
    position: 8.4,
  };
}

/*
 * The magnitudes this file exists for: impressions two orders of magnitude
 * above clicks, which is entirely ordinary for a real property.
 */
const DAILY: GscDailyPoint[] = [
  day("2026-08-01", 10, 1000),
  day("2026-08-02", 20, 500),
  day("2026-08-03", 5, 250),
];

describe("gscSeriesPeaks", () => {
  it("finds each series' best day independently", () => {
    expect(gscSeriesPeaks(DAILY)).toEqual({
      clicks: { value: 20, date: "2026-08-02" },
      impressions: { value: 1000, date: "2026-08-01" },
    });
  });

  it("names the first day to reach a tied peak", () => {
    const tied = [day("2026-08-01", 9, 90), day("2026-08-02", 9, 90)];
    expect(gscSeriesPeaks(tied).clicks.date).toBe("2026-08-01");
  });

  it("has no peak for an empty window", () => {
    expect(gscSeriesPeaks([])).toEqual({
      clicks: { value: 0, date: null },
      impressions: { value: 0, date: null },
    });
  });
});

describe("gscChartPoints", () => {
  /*
   * Both lines use the full height of the chart, so their shapes can be
   * compared. Plotted raw against one axis, clicks would be a flat line pinned
   * to the bottom and the comparison would be impossible.
   */
  it("indexes each series against its own peak", () => {
    expect(gscChartPoints(DAILY)).toEqual([
      { date: "2026-08-01", clicks: 50, impressions: 100 },
      { date: "2026-08-02", clicks: 100, impressions: 50 },
      { date: "2026-08-03", clicks: 25, impressions: 25 },
    ]);
  });

  it("keeps the API's order, so the line reads left to right", () => {
    expect(gscChartPoints(DAILY).map((point) => point.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  /* A window that earned nothing draws a flat line at zero, not a crash. */
  it("does not divide by a peak of zero", () => {
    const barren = [day("2026-08-01", 0, 0), day("2026-08-02", 0, 0)];
    expect(gscChartPoints(barren)).toEqual([
      { date: "2026-08-01", clicks: 0, impressions: 0 },
      { date: "2026-08-02", clicks: 0, impressions: 0 },
    ]);
  });

  it("handles one series being empty while the other is not", () => {
    const noClicks = [day("2026-08-01", 0, 400), day("2026-08-02", 0, 200)];
    expect(gscChartPoints(noClicks)).toEqual([
      { date: "2026-08-01", clicks: 0, impressions: 100 },
      { date: "2026-08-02", clicks: 0, impressions: 50 },
    ]);
  });

  it("rounds to one decimal so the tooltip shows no float noise", () => {
    const thirds = [day("2026-08-01", 1, 3), day("2026-08-02", 3, 3)];
    const points = gscChartPoints(thirds);
    expect(points[0]?.clicks).toBe(33.3);
    expect(String(points[0]?.clicks)).not.toContain("33.33333");
  });

  it("never plots a value outside 0–100", () => {
    for (const point of gscChartPoints(DAILY)) {
      expect(point.clicks).toBeGreaterThanOrEqual(0);
      expect(point.clicks).toBeLessThanOrEqual(100);
      expect(point.impressions).toBeGreaterThanOrEqual(0);
      expect(point.impressions).toBeLessThanOrEqual(100);
    }
  });

  it("returns nothing for an empty window", () => {
    expect(gscChartPoints([])).toEqual([]);
  });
});

describe("hasPlottableGscSeries", () => {
  /* One point is a dot, not a trend — the caller shows an empty state instead. */
  it("needs at least two days to draw a line", () => {
    expect(hasPlottableGscSeries([])).toBe(false);
    expect(hasPlottableGscSeries([DAILY[0] as GscDailyPoint])).toBe(false);
    expect(hasPlottableGscSeries(DAILY)).toBe(true);
  });
});
