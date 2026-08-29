import { describe, expect, it } from "vitest";

import {
  historySeries,
  monthRange,
  rangeCutoff,
  sliceHistory,
} from "./history-range";

/** Mid-month, so nothing here can be passing by accident on a month boundary. */
const NOW = new Date("2026-08-14T09:00:00Z");

function point(
  period: string | null,
  backlinks: number | null = 1,
  referringDomains: number | null = 1,
) {
  return { period, backlinks, referringDomains };
}

describe("rangeCutoff", () => {
  it("counts months inclusively", () => {
    // Six months ending in August 2026 starts in March 2026.
    expect(rangeCutoff("6m", NOW)).toBe("2026-03");
    expect(rangeCutoff("1y", NOW)).toBe("2025-09");
  });

  it("has no cutoff for all time", () => {
    expect(rangeCutoff("all", NOW)).toBeNull();
  });

  /**
   * The reason this is month arithmetic and not day subtraction: "six months
   * before the 31st" is a date that does not exist in four months of the year,
   * and letting Date normalise it would silently drop a month off the chart.
   */
  it("is unaffected by the day of the month", () => {
    expect(rangeCutoff("6m", new Date("2026-08-31T23:59:00Z"))).toBe("2026-03");
    expect(rangeCutoff("6m", new Date("2026-08-01T00:00:00Z"))).toBe("2026-03");
  });

  it("crosses a year boundary correctly", () => {
    expect(rangeCutoff("6m", new Date("2026-02-10T00:00:00Z"))).toBe("2025-09");
  });
});

describe("sliceHistory", () => {
  const points = [
    point("2025-01"),
    point("2025-09"),
    point("2026-03"),
    point("2026-08"),
  ];

  it("keeps only the months in range", () => {
    expect(sliceHistory(points, "6m", NOW).map((p) => p.period)).toEqual([
      "2026-03",
      "2026-08",
    ]);
    expect(sliceHistory(points, "1y", NOW).map((p) => p.period)).toEqual([
      "2025-09",
      "2026-03",
      "2026-08",
    ]);
    expect(sliceHistory(points, "all", NOW)).toHaveLength(4);
  });

  it("drops points with no period — there is nowhere to plot them", () => {
    expect(sliceHistory([point(null), point("2026-08")], "all", NOW)).toEqual([
      point("2026-08"),
    ]);
  });
});

describe("monthRange", () => {
  it("enumerates months inclusively across a year boundary", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("is a single month when both ends match", () => {
    expect(monthRange("2026-02", "2026-02")).toEqual(["2026-02"]);
  });

  it("is empty for inverted or unparseable bounds", () => {
    expect(monthRange("2026-05", "2026-01")).toEqual([]);
    expect(monthRange("2026-13", "2026-14")).toEqual([]);
    expect(monthRange("nope", "2026-02")).toEqual([]);
  });
});

describe("historySeries", () => {
  /**
   * The behaviour the shared types warn about: DataForSEO omits months it has
   * nothing for. Without the fill, March → June is drawn as one straight line
   * that reads as three months of measured growth.
   */
  it("fills months the provider skipped with nulls", () => {
    const series = historySeries(
      [point("2026-03", 100, 10), point("2026-06", 400, 40)],
      "all",
      NOW,
    );
    expect(series).toEqual([
      { period: "2026-03", backlinks: 100, referringDomains: 10 },
      { period: "2026-04", backlinks: null, referringDomains: null },
      { period: "2026-05", backlinks: null, referringDomains: null },
      { period: "2026-06", backlinks: 400, referringDomains: 40 },
    ]);
  });

  it("sorts by period rather than trusting the array order", () => {
    const series = historySeries(
      [point("2026-06", 400, 40), point("2026-05", 200, 20)],
      "all",
      NOW,
    );
    expect(series.map((p) => p.period)).toEqual(["2026-05", "2026-06"]);
  });

  it("slices before filling, so a range never invents months before it", () => {
    const series = historySeries(
      [point("2024-01", 1, 1), point("2026-08", 2, 2)],
      "6m",
      NOW,
    );
    expect(series).toEqual([
      { period: "2026-08", backlinks: 2, referringDomains: 2 },
    ]);
  });

  it("is empty when nothing falls in range", () => {
    expect(historySeries([point("2020-01")], "6m", NOW)).toEqual([]);
    expect(historySeries([], "all", NOW)).toEqual([]);
  });

  it("preserves a real zero rather than turning it into a gap", () => {
    const series = historySeries([point("2026-08", 0, 0)], "6m", NOW);
    expect(series).toEqual([
      { period: "2026-08", backlinks: 0, referringDomains: 0 },
    ]);
  });
});
