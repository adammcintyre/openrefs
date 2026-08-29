import { describe, expect, it } from "vitest";

import type { RankPoint } from "./tracking";
import { positionChange, shiftIsoDate, toIsoDate } from "./tracking";

const series = (...points: [string, number | null][]): RankPoint[] =>
  points.map(([date, position]) => ({ date, position }));

describe("toIsoDate", () => {
  it("formats UTC, not local time", () => {
    expect(toIsoDate(new Date("2026-08-29T23:59:59.999Z"))).toBe("2026-08-29");
    expect(toIsoDate(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });
});

describe("shiftIsoDate", () => {
  it("moves whole days", () => {
    expect(shiftIsoDate("2026-08-29", -1)).toBe("2026-08-28");
    expect(shiftIsoDate("2026-08-29", -30)).toBe("2026-07-30");
  });

  it("rolls month and year boundaries", () => {
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("returns null for an unparseable date", () => {
    expect(shiftIsoDate("not-a-date", -1)).toBeNull();
  });
});

describe("positionChange", () => {
  it("is positive when the ranking improved", () => {
    // 8 → 3 is five places better, and better must read as positive.
    expect(positionChange(series(["2026-08-28", 8], ["2026-08-29", 3]), 1)).toBe(
      5,
    );
  });

  it("is negative when the ranking got worse", () => {
    expect(positionChange(series(["2026-08-28", 3], ["2026-08-29", 8]), 1)).toBe(
      -5,
    );
  });

  it("is zero when nothing moved", () => {
    expect(positionChange(series(["2026-08-28", 4], ["2026-08-29", 4]), 1)).toBe(
      0,
    );
  });

  it("anchors on the newest observation, not on today", () => {
    // A project last checked three days ago still has a meaningful Δ1d: the
    // change across the last day that was actually measured. Anchored on
    // today's date this would compare the newest row with itself and report a
    // confident zero.
    const points = series(
      ["2026-08-24", 20],
      ["2026-08-25", 12],
      ["2026-08-26", 9],
    );
    expect(positionChange(points, 1)).toBe(3);
  });

  it("uses the most recent observation at or before the cutoff", () => {
    // No snapshot exactly 7 days back, so the nearest earlier one stands in.
    const points = series(
      ["2026-08-20", 40],
      ["2026-08-22", 25],
      ["2026-08-29", 10],
    );
    expect(positionChange(points, 7)).toBe(15);
  });

  it("is null when there is no earlier observation to compare against", () => {
    expect(positionChange(series(["2026-08-29", 5]), 1)).toBeNull();
    expect(
      positionChange(series(["2026-08-28", 9], ["2026-08-29", 5]), 30),
    ).toBeNull();
  });

  it("is null when the baseline was out of the top 100", () => {
    // You cannot subtract "absent" from 7 and get a number of places.
    expect(
      positionChange(series(["2026-08-28", null], ["2026-08-29", 7]), 1),
    ).toBeNull();
  });

  it("is null when the latest check found nothing", () => {
    expect(
      positionChange(series(["2026-08-28", 7], ["2026-08-29", null]), 1),
    ).toBeNull();
  });

  it("is null for an empty series", () => {
    expect(positionChange([], 7)).toBeNull();
  });

  it("does not compare a row with itself", () => {
    // The cutoff lands on the newest row's own date, which must not count as a
    // baseline — that would report a fake zero for every keyword.
    expect(positionChange(series(["2026-08-29", 5]), 0)).toBeNull();
  });

  it("reads a 30-day series the way the sparkline column will", () => {
    const points = series(
      ["2026-07-30", 55],
      ["2026-08-22", 18],
      ["2026-08-28", 11],
      ["2026-08-29", 9],
    );
    expect(positionChange(points, 1)).toBe(2);
    expect(positionChange(points, 7)).toBe(9);
    expect(positionChange(points, 30)).toBe(46);
  });
});
