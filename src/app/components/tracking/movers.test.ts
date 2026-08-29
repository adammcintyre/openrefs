import { describe, expect, it } from "vitest";

import type { TrackedKeywordRow } from "../../../shared/tracking";
import { hasMovers, selectMovers } from "./movers";

/** A row with only the fields the movers panel reads set meaningfully. */
function row(keyword: string, change7d: number | null): TrackedKeywordRow {
  return {
    id: `id-${keyword}`,
    keyword,
    device: "desktop",
    locationCode: 2826,
    languageCode: "en",
    createdAt: "2026-08-01T00:00:00.000Z",
    latest: null,
    previous: null,
    change1d: null,
    change7d,
    change30d: null,
    bestPosition: null,
    aiOverview: false,
    series: [],
  };
}

const keywords = (rows: TrackedKeywordRow[]) => rows.map((r) => r.keyword);

describe("selectMovers", () => {
  it("splits by direction, biggest move first in each list", () => {
    const { gainers, losers } = selectMovers([
      row("a", 2),
      row("b", -9),
      row("c", 11),
      row("d", -1),
    ]);

    expect(keywords(gainers)).toEqual(["c", "a"]);
    expect(keywords(losers)).toEqual(["b", "d"]);
  });

  /*
   * The polarity rule from src/shared/tracking.ts: the Worker has already
   * applied "down is good" and hands back `older - newer`. A keyword that went
   * from position 8 to position 3 arrives as +5 and is a *gainer*. Re-inverting
   * here would file every improvement under losses.
   */
  it("treats a positive change as an improvement, not a drop", () => {
    const improved = row("moved up", 5);
    const { gainers, losers } = selectMovers([improved]);

    expect(keywords(gainers)).toEqual(["moved up"]);
    expect(losers).toEqual([]);
  });

  it("caps each list at the limit independently", () => {
    const rows = [
      row("g1", 10),
      row("g2", 9),
      row("g3", 8),
      row("g4", 7),
      row("g5", 6),
      row("g6", 5),
      row("l1", -4),
      row("l2", -3),
    ];
    const { gainers, losers } = selectMovers(rows);

    expect(keywords(gainers)).toEqual(["g1", "g2", "g3", "g4", "g5"]);
    expect(keywords(losers)).toEqual(["l1", "l2"]);
  });

  it("honours a custom limit", () => {
    const { gainers } = selectMovers([row("a", 3), row("b", 2), row("c", 1)], 2);
    expect(keywords(gainers)).toEqual(["a", "b"]);
  });

  /* --------------------------- what is excluded --------------------------- */

  it("excludes keywords that did not move", () => {
    const { gainers, losers } = selectMovers([row("still", 0)]);
    expect(gainers).toEqual([]);
    expect(losers).toEqual([]);
  });

  /*
   * A null change means there was no observation seven days ago to compare
   * with — unmeasured, not unmoved. It belongs in neither list.
   */
  it("excludes keywords with no baseline to compare against", () => {
    const { gainers, losers } = selectMovers([
      row("new keyword", null),
      row("real gain", 4),
    ]);

    expect(keywords(gainers)).toEqual(["real gain"]);
    expect(losers).toEqual([]);
  });

  it("returns two empty lists for an empty table", () => {
    expect(selectMovers([])).toEqual({ gainers: [], losers: [] });
  });

  /* ------------------------------ determinism ----------------------------- */

  it("breaks ties alphabetically so the panel does not reshuffle", () => {
    const { gainers } = selectMovers([
      row("zebra", 3),
      row("apple", 3),
      row("mango", 3),
    ]);
    expect(keywords(gainers)).toEqual(["apple", "mango", "zebra"]);
  });

  it("orders losers by size of drop, not by signed value", () => {
    // -1 is the *larger* number but the *smaller* move; -12 must lead.
    const { losers } = selectMovers([row("small", -1), row("big", -12)]);
    expect(keywords(losers)).toEqual(["big", "small"]);
  });

  it("does not mutate or reorder the input array", () => {
    const rows = [row("a", 1), row("b", 5)];
    const snapshot = keywords(rows);
    selectMovers(rows);
    expect(keywords(rows)).toEqual(snapshot);
  });
});

describe("hasMovers", () => {
  it("is false when nothing moved", () => {
    expect(hasMovers(selectMovers([row("flat", 0)]))).toBe(false);
  });

  it("is true when either list has an entry", () => {
    expect(hasMovers(selectMovers([row("up", 1)]))).toBe(true);
    expect(hasMovers(selectMovers([row("down", -1)]))).toBe(true);
  });
});
