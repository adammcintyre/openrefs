/**
 * The one rule the overview chart can silently break: **plot by date, never by
 * index.**
 *
 * `RankSummaryResponse` is explicit that days can be missing — a project first
 * checked on a Tuesday has no Monday row — so a chart that derived a day from a
 * point's position in the array would mislabel every point after the first gap,
 * and would do it plausibly enough that nobody would notice.
 */
import { describe, expect, it } from "vitest";

import type { RankSummaryPoint } from "../../../shared/tracking";
import { toChartData } from "./rank-overview-chart";

function point(over: Partial<RankSummaryPoint> & { date: string }): RankSummaryPoint {
  return {
    avgPosition: 10,
    top3: 1,
    top10: 2,
    top100: 3,
    tracked: 3,
    ...over,
  };
}

describe("toChartData", () => {
  /** 20 August is absent; 21 August must still be labelled 21 August. */
  it("labels every point with its own date, gaps and all", () => {
    const data = toChartData([
      point({ date: "2026-08-19" }),
      point({ date: "2026-08-21" }),
      point({ date: "2026-08-25" }),
    ]);
    expect(data.map((datum) => datum.day)).toEqual([
      "19 Aug",
      "21 Aug",
      "25 Aug",
    ]);
  });

  it("carries the three cumulative bands through unchanged", () => {
    const [datum] = toChartData([
      point({ date: "2026-08-19", top3: 4, top10: 11, top100: 26 }),
    ]);
    expect(datum).toMatchObject({ top3: 4, top10: 11, top100: 26 });
  });

  /**
   * A day where nothing ranked has no average. Null keeps it a gap in the line;
   * a zero would be the *best possible* position and would draw a spike where
   * the truth is an absence.
   */
  it("keeps an unranked day null rather than zero", () => {
    const [datum] = toChartData([point({ date: "2026-08-22", avgPosition: null })]);
    expect(datum?.avgPosition).toBeNull();
  });

  it("handles an empty series", () => {
    expect(toChartData([])).toEqual([]);
  });

  /** A malformed date is shown as it arrived, not collapsed to a dash. */
  it("passes an unparseable date through so the axis stays distinguishable", () => {
    const [datum] = toChartData([point({ date: "not-a-date" })]);
    expect(datum?.day).toBe("not-a-date");
  });
});
