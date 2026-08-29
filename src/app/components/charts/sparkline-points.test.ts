import { describe, expect, it } from "vitest";

import {
  sparklineGeometry,
  toPolylinePoints,
  type SparklineDatum,
} from "./sparkline-points";

const BOX = { width: 120, height: 28, padding: 2 } as const;

/** Everything here plots inside the padded box. */
const LEFT = 2;
const RIGHT = 118;
const TOP = 2;
const BOTTOM = 26;

describe("sparklineGeometry", () => {
  it("returns nothing for an empty series", () => {
    expect(sparklineGeometry([], BOX)).toEqual({
      segments: [],
      points: [],
      last: null,
      bestPosition: null,
      worstPosition: null,
    });
  });

  it("returns nothing when every day was checked and none ranked", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: null },
      { date: "2026-08-02", position: null },
    ];
    expect(sparklineGeometry(series, BOX).points).toEqual([]);
  });

  /*
   * The inversion. Position 3 is better than position 40, so it must sit
   * higher — a smaller y in SVG coordinates. A chart that fails this looks
   * entirely reasonable and tells the user the opposite of the truth.
   */
  it("puts the better position higher up the box", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: 40 },
      { date: "2026-08-02", position: 3 },
    ];
    const { points } = sparklineGeometry(series, BOX);
    const [worst, best] = points;

    expect(best?.position).toBe(3);
    expect(best?.y).toBe(TOP);
    expect(worst?.position).toBe(40);
    expect(worst?.y).toBe(BOTTOM);
    expect(best?.y).toBeLessThan(worst?.y ?? 0);
  });

  it("reports the best and worst positions plotted", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: 12 },
      { date: "2026-08-02", position: 4 },
      { date: "2026-08-03", position: 30 },
    ];
    const geometry = sparklineGeometry(series, BOX);
    expect(geometry.bestPosition).toBe(4);
    expect(geometry.worstPosition).toBe(30);
  });

  it("centres a flat series vertically instead of pinning it to the top", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: 4 },
      { date: "2026-08-02", position: 4 },
    ];
    const { points } = sparklineGeometry(series, BOX);
    for (const point of points) {
      expect(point.y).toBe((TOP + BOTTOM) / 2);
    }
  });

  it("centres a single observation horizontally", () => {
    const { points } = sparklineGeometry(
      [{ date: "2026-08-01", position: 9 }],
      BOX,
    );
    expect(points).toHaveLength(1);
    expect(points[0]?.x).toBe((LEFT + RIGHT) / 2);
  });

  /* ------------------------------- gaps ---------------------------------- */

  it("spaces points by date, so a gap in checking is a gap on screen", () => {
    // Checked on the 1st, 2nd, then not again until the 6th: the last step is
    // four days and must be four times as wide as the first.
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: 10 },
      { date: "2026-08-02", position: 10 },
      { date: "2026-08-06", position: 10 },
    ];
    const [a, b, c] = sparklineGeometry(series, BOX).points;

    const firstStep = (b?.x ?? 0) - (a?.x ?? 0);
    const lastStep = (c?.x ?? 0) - (b?.x ?? 0);
    expect(lastStep).toBeCloseTo(firstStep * 4, 6);
  });

  it("does not assume 30 points — a two-point month still spans the box", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: 20 },
      { date: "2026-08-30", position: 5 },
    ];
    const { points } = sparklineGeometry(series, BOX);
    expect(points).toHaveLength(2);
    expect(points[0]?.x).toBe(LEFT);
    expect(points[1]?.x).toBe(RIGHT);
  });

  it("breaks the line where a check found nothing in the top 100", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: 8 },
      { date: "2026-08-02", position: 9 },
      { date: "2026-08-03", position: null },
      { date: "2026-08-04", position: 7 },
    ];
    const { segments } = sparklineGeometry(series, BOX);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.map((point) => point.position)).toEqual([8, 9]);
    expect(segments[1]?.map((point) => point.position)).toEqual([7]);
  });

  it("keeps the unranked day's width, rather than closing the gap", () => {
    // The 3rd was checked and did not rank. The 4th must still be plotted a
    // full three days from the 1st, not two.
    const withGap = sparklineGeometry(
      [
        { date: "2026-08-01", position: 8 },
        { date: "2026-08-03", position: null },
        { date: "2026-08-04", position: 7 },
      ],
      BOX,
    );
    expect(withGap.points.at(-1)?.x).toBe(RIGHT);
    expect(withGap.points.at(0)?.x).toBe(LEFT);
  });

  it("ignores leading and trailing unranked days for the segments", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: null },
      { date: "2026-08-02", position: 5 },
      { date: "2026-08-03", position: null },
    ];
    const { segments, last } = sparklineGeometry(series, BOX);
    expect(segments).toHaveLength(1);
    expect(last?.position).toBe(5);
    // The unranked days still hold the x domain open at both ends.
    expect(last?.x).toBeGreaterThan(LEFT);
    expect(last?.x).toBeLessThan(RIGHT);
  });

  it("skips points whose date will not parse rather than throwing", () => {
    const series: SparklineDatum[] = [
      { date: "not-a-date", position: 3 },
      { date: "2026-08-02", position: 6 },
    ];
    const { points } = sparklineGeometry(series, BOX);
    expect(points.map((point) => point.position)).toEqual([6]);
  });

  it("takes the newest ranked point as the end cap", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: 30 },
      { date: "2026-08-02", position: 12 },
    ];
    expect(sparklineGeometry(series, BOX).last?.position).toBe(12);
  });
});

describe("toPolylinePoints", () => {
  it("renders a segment as an SVG points attribute", () => {
    const series: SparklineDatum[] = [
      { date: "2026-08-01", position: 10 },
      { date: "2026-08-02", position: 1 },
    ];
    const segment = sparklineGeometry(series, BOX).segments[0] ?? [];
    expect(toPolylinePoints(segment)).toBe("2,26 118,2");
  });

  it("is empty for an empty segment", () => {
    expect(toPolylinePoints([])).toBe("");
  });
});
