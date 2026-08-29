import { describe, expect, it } from "vitest";

import type { GscQueryRow } from "../../shared/gsc";
import type { GscQueryPageRow } from "./opportunities";
import {
  CANNIBALIZATION_MIN_SHARE,
  EXPECTED_CTR_BY_POSITION,
  LOW_CTR_RATIO,
  OPPORTUNITY_LIMIT,
  computeOpportunities,
  expectedCtr,
  findCannibalization,
  findLowCtr,
  findStrikingDistance,
  medianImpressions,
  topPageByQuery,
} from "./opportunities";

/** A query row with sane defaults; tests override only what they mean. */
function q(over: Partial<GscQueryRow> & { query: string }): GscQueryRow {
  return {
    clicks: 0,
    impressions: 100,
    ctr: 0,
    position: 12,
    ...over,
  };
}

/** A query+page row. `ctr` defaults to a consistent clicks/impressions. */
function qp(
  over: Partial<GscQueryPageRow> & { query: string; page: string },
): GscQueryPageRow {
  const clicks = over.clicks ?? 0;
  const impressions = over.impressions ?? 100;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: 5,
    ...over,
  };
}

const NO_PAGES = new Map<string, string>();

/* -------------------------------------------------------------------------- */

describe("expectedCtr curve", () => {
  it("covers positions 1–10", () => {
    expect(EXPECTED_CTR_BY_POSITION).toHaveLength(10);
  });

  it("is strictly decreasing — a worse rank never expects more clicks", () => {
    for (let i = 1; i < EXPECTED_CTR_BY_POSITION.length; i++) {
      expect(EXPECTED_CTR_BY_POSITION[i]).toBeLessThan(
        EXPECTED_CTR_BY_POSITION[i - 1] as number,
      );
    }
  });

  it("is expressed as fractions, matching Search Console's own ctr", () => {
    for (const value of EXPECTED_CTR_BY_POSITION) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("rounds a fractional average position to the nearest rank", () => {
    expect(expectedCtr(3)).toBe(EXPECTED_CTR_BY_POSITION[2]);
    expect(expectedCtr(3.4)).toBe(EXPECTED_CTR_BY_POSITION[2]);
    expect(expectedCtr(3.5)).toBe(EXPECTED_CTR_BY_POSITION[3]);
    expect(expectedCtr(4.49)).toBe(EXPECTED_CTR_BY_POSITION[3]);
  });

  it("clamps past the end of the curve instead of returning zero", () => {
    // Zero would make every deep result infinitely under-performing.
    const last = EXPECTED_CTR_BY_POSITION.at(-1);
    expect(expectedCtr(11)).toBe(last);
    expect(expectedCtr(97.3)).toBe(last);
    expect(expectedCtr(Number.POSITIVE_INFINITY)).toBe(
      EXPECTED_CTR_BY_POSITION[0],
    );
  });

  it("treats an impossible position as position 1", () => {
    expect(expectedCtr(0)).toBe(EXPECTED_CTR_BY_POSITION[0]);
    expect(expectedCtr(Number.NaN)).toBe(EXPECTED_CTR_BY_POSITION[0]);
  });
});

/* -------------------------------------------------------------------------- */

describe("medianImpressions", () => {
  it("takes the middle value of an odd-length set", () => {
    const rows = [10, 30, 20].map((impressions, i) =>
      q({ query: `k${i}`, impressions }),
    );
    expect(medianImpressions(rows)).toBe(20);
  });

  it("averages the two middles of an even-length set", () => {
    const rows = [10, 20, 30, 40].map((impressions, i) =>
      q({ query: `k${i}`, impressions }),
    );
    expect(medianImpressions(rows)).toBe(25);
  });

  it("is unmoved by one enormous outlier — that is the point of a median", () => {
    const rows = [1, 2, 3, 4, 1_000_000].map((impressions, i) =>
      q({ query: `k${i}`, impressions }),
    );
    expect(medianImpressions(rows)).toBe(3);
  });

  it("returns 0 for an empty set, so nothing is filtered out", () => {
    expect(medianImpressions([])).toBe(0);
  });

  it("sorts numerically, not lexicographically", () => {
    // [9, 10, 100] sorted as strings is [10, 100, 9] — median 100, not 10.
    const rows = [9, 10, 100].map((impressions, i) =>
      q({ query: `k${i}`, impressions }),
    );
    expect(medianImpressions(rows)).toBe(10);
  });
});

/* -------------------------------------------------------------------------- */

describe("topPageByQuery", () => {
  it("picks the page with the most clicks", () => {
    const map = topPageByQuery([
      qp({ query: "widgets", page: "/a", clicks: 3 }),
      qp({ query: "widgets", page: "/b", clicks: 9 }),
      qp({ query: "widgets", page: "/c", clicks: 1 }),
    ]);
    expect(map.get("widgets")).toBe("/b");
  });

  it("breaks click ties on impressions", () => {
    const map = topPageByQuery([
      qp({ query: "widgets", page: "/a", clicks: 0, impressions: 10 }),
      qp({ query: "widgets", page: "/b", clicks: 0, impressions: 90 }),
    ]);
    expect(map.get("widgets")).toBe("/b");
  });

  it("keeps queries independent", () => {
    const map = topPageByQuery([
      qp({ query: "a", page: "/a", clicks: 1 }),
      qp({ query: "b", page: "/b", clicks: 1 }),
    ]);
    expect([...map]).toEqual([
      ["a", "/a"],
      ["b", "/b"],
    ]);
  });
});

/* -------------------------------------------------------------------------- */

describe("findStrikingDistance", () => {
  it("keeps positions 5–20 at or above the impression floor", () => {
    const rows = [
      q({ query: "in-range", position: 7, impressions: 500 }),
      q({ query: "too-good", position: 2, impressions: 500 }),
      q({ query: "too-deep", position: 41, impressions: 500 }),
      q({ query: "too-quiet", position: 7, impressions: 10 }),
    ];
    const found = findStrikingDistance(rows, NO_PAGES, 100).items;
    expect(found.map((row) => row.query)).toEqual(["in-range"]);
  });

  it("includes both boundary positions", () => {
    const rows = [
      q({ query: "at-5", position: 5 }),
      q({ query: "at-20", position: 20 }),
      q({ query: "at-4.9", position: 4.9 }),
      q({ query: "at-20.1", position: 20.1 }),
    ];
    const found = findStrikingDistance(rows, NO_PAGES, 0).items;
    expect(found.map((row) => row.query).sort()).toEqual(["at-20", "at-5"]);
  });

  it("includes a row exactly at the median, not just above it", () => {
    const rows = [q({ query: "at-median", position: 9, impressions: 100 })];
    expect(findStrikingDistance(rows, NO_PAGES, 100).items).toHaveLength(1);
  });

  it("orders by impressions, biggest prize first", () => {
    const rows = [
      q({ query: "small", position: 9, impressions: 100 }),
      q({ query: "big", position: 9, impressions: 9000 }),
      q({ query: "mid", position: 9, impressions: 900 }),
    ];
    expect(
      findStrikingDistance(rows, NO_PAGES, 0).items.map((row) => row.query),
    ).toEqual(["big", "mid", "small"]);
  });

  it("attaches the query's best page, or null when there is none", () => {
    const rows = [q({ query: "widgets", position: 8 }), q({ query: "gadgets", position: 8 })];
    const found = findStrikingDistance(
      rows,
      new Map([["widgets", "/widgets"]]),
      0,
    ).items;
    expect(found.find((row) => row.query === "widgets")?.page).toBe("/widgets");
    expect(found.find((row) => row.query === "gadgets")?.page).toBeNull();
  });

  it("caps the list at the shared table ceiling", () => {
    const rows = Array.from({ length: OPPORTUNITY_LIMIT + 50 }, (_, i) =>
      q({ query: `k${i}`, position: 9, impressions: 1000 - i }),
    );
    const found = findStrikingDistance(rows, NO_PAGES, 0).items;
    expect(found).toHaveLength(OPPORTUNITY_LIMIT);
    // Kept the biggest, not the first 200 in input order.
    expect(found[0]?.query).toBe("k0");
  });

  it("reports how many matched before the cap, so truncation is visible", () => {
    // Without this the UI cannot tell 200-of-200 from 200-of-250, and shows a
    // truncated list as though it were the whole picture.
    const rows = Array.from({ length: OPPORTUNITY_LIMIT + 50 }, (_, i) =>
      q({ query: `k${i}`, position: 9, impressions: 1000 - i }),
    );
    const found = findStrikingDistance(rows, NO_PAGES, 0);

    expect(found.total).toBe(OPPORTUNITY_LIMIT + 50);
    expect(found.items).toHaveLength(OPPORTUNITY_LIMIT);
  });

  it("counts only matches in the total, not the rows it was handed", () => {
    const rows = [
      q({ query: "in-range", position: 7, impressions: 500 }),
      q({ query: "too-good", position: 2, impressions: 500 }),
      q({ query: "too-deep", position: 41, impressions: 500 }),
    ];
    expect(findStrikingDistance(rows, NO_PAGES, 0).total).toBe(1);
  });

  it("does not mutate the caller's rows", () => {
    const rows = [
      q({ query: "b", position: 9, impressions: 1 }),
      q({ query: "a", position: 9, impressions: 2 }),
    ];
    findStrikingDistance(rows, NO_PAGES, 0);
    expect(rows.map((row) => row.query)).toEqual(["b", "a"]);
  });
});

/* -------------------------------------------------------------------------- */

describe("findLowCtr", () => {
  it("fires below half the curve and not at it", () => {
    const expected = expectedCtr(3);
    const rows = [
      q({ query: "under", position: 3, ctr: expected * 0.49, impressions: 1000 }),
      q({ query: "at-half", position: 3, ctr: expected * LOW_CTR_RATIO, impressions: 1000 }),
      q({ query: "healthy", position: 3, ctr: expected, impressions: 1000 }),
    ];
    expect(findLowCtr(rows, NO_PAGES).items.map((row) => row.query)).toEqual(["under"]);
  });

  it("ignores anything past position 10 — the curve stops being meaningful", () => {
    const rows = [
      q({ query: "deep", position: 14, ctr: 0, impressions: 5000 }),
      q({ query: "shallow", position: 9, ctr: 0, impressions: 5000 }),
    ];
    expect(findLowCtr(rows, NO_PAGES).items.map((row) => row.query)).toEqual([
      "shallow",
    ]);
  });

  it("ignores zero-impression rows — 0/0 says nothing about a snippet", () => {
    const rows = [q({ query: "unseen", position: 2, ctr: 0, impressions: 0 })];
    expect(findLowCtr(rows, NO_PAGES).items).toEqual([]);
  });

  it("ignores a row with no position rather than judging it as position 1", () => {
    /*
     * `gsc/api.ts` normalises a missing `position` to 0. Position 0 does not
     * exist on Search Console's 1-based scale — it means Google reported none —
     * and it slips past `position <= 10` while `expectedCtr` clamps anything
     * below 1 to the position-1 value. So an unknown position would be held to
     * the harshest expectation on the whole curve (27.6%) and reported as a
     * low-CTR problem on no evidence whatsoever.
     */
    const rows = [
      q({ query: "no-position", position: 0, ctr: 0.001, impressions: 5000 }),
    ];

    const found = findLowCtr(rows, NO_PAGES);
    expect(found.items).toEqual([]);
    // Not merely capped out of the list — never a match in the first place.
    expect(found.total).toBe(0);
  });

  it("still admits a genuine position 1", () => {
    // The guard is a floor at 1, not an exclusion of the top rank.
    const rows = [q({ query: "top", position: 1, ctr: 0.001, impressions: 5000 })];
    expect(findLowCtr(rows, NO_PAGES).items.map((row) => row.query)).toEqual([
      "top",
    ]);
  });

  it("reports how many matched before the cap", () => {
    const rows = Array.from({ length: OPPORTUNITY_LIMIT + 25 }, (_, i) =>
      q({ query: `k${i}`, position: 5, ctr: 0, impressions: 1000 - i }),
    );
    const found = findLowCtr(rows, NO_PAGES);

    expect(found.total).toBe(OPPORTUNITY_LIMIT + 25);
    expect(found.items).toHaveLength(OPPORTUNITY_LIMIT);
  });

  it("reports the expected CTR and the ratio it measured", () => {
    const expected = expectedCtr(4);
    const rows = [
      q({ query: "k", position: 4, ctr: expected * 0.25, impressions: 800 }),
    ];
    const [found] = findLowCtr(rows, NO_PAGES).items;
    expect(found?.expectedCtr).toBeCloseTo(expected, 10);
    expect(found?.ctrRatio).toBeCloseTo(0.25, 10);
  });

  it("orders by impressions — the biggest wasted ranking first", () => {
    const rows = [
      q({ query: "small", position: 5, ctr: 0, impressions: 100 }),
      q({ query: "huge", position: 5, ctr: 0, impressions: 90_000 }),
    ];
    expect(findLowCtr(rows, NO_PAGES).items.map((row) => row.query)).toEqual([
      "huge",
      "small",
    ]);
  });

  it("catches the classic case: position 1 with almost no clicks", () => {
    const rows = [
      q({ query: "brand term", position: 1.2, ctr: 0.02, impressions: 12_000 }),
    ];
    const [found] = findLowCtr(rows, NO_PAGES).items;
    expect(found?.query).toBe("brand term");
    expect(found?.rule).toBe("low_ctr");
  });
});

/* -------------------------------------------------------------------------- */

describe("findCannibalization", () => {
  const totals = new Map();

  it("fires when two pages each clear the 20% share", () => {
    const rows = [
      qp({ query: "widgets", page: "/a", clicks: 50 }),
      qp({ query: "widgets", page: "/b", clicks: 50 }),
    ];
    const found = findCannibalization(rows, totals).items;
    expect(found).toHaveLength(1);
    expect(found[0]?.pages.map((page) => page.page)).toEqual(["/a", "/b"]);
    expect(found[0]?.pages[0]?.shareOfClicks).toBeCloseTo(0.5, 10);
  });

  it("does not fire when one page dominates", () => {
    const rows = [
      qp({ query: "widgets", page: "/a", clicks: 95 }),
      qp({ query: "widgets", page: "/b", clicks: 5 }),
    ];
    expect(findCannibalization(rows, totals).items).toEqual([]);
  });

  it("drops the pages below the share threshold but keeps the finding", () => {
    const rows = [
      qp({ query: "widgets", page: "/a", clicks: 40 }),
      qp({ query: "widgets", page: "/b", clicks: 40 }),
      qp({ query: "widgets", page: "/c", clicks: 20 }),
      qp({ query: "widgets", page: "/d", clicks: 1 }),
    ];
    const [found] = findCannibalization(rows, totals).items;
    // /c is exactly at the threshold (20/101 < 0.2 → excluded); /d is far below.
    expect(found?.pages.map((page) => page.page)).toEqual(["/a", "/b"]);
  });

  it("treats the threshold as inclusive", () => {
    const rows = [
      qp({ query: "widgets", page: "/a", clicks: 80 }),
      qp({ query: "widgets", page: "/b", clicks: 20 }),
    ];
    const [found] = findCannibalization(rows, totals).items;
    expect(found?.pages).toHaveLength(2);
    expect(found?.pages[1]?.shareOfClicks).toBeCloseTo(
      CANNIBALIZATION_MIN_SHARE,
      10,
    );
  });

  it("ignores queries with no clicks — there is no split to measure", () => {
    const rows = [
      qp({ query: "widgets", page: "/a", clicks: 0, impressions: 5000 }),
      qp({ query: "widgets", page: "/b", clicks: 0, impressions: 5000 }),
    ];
    expect(findCannibalization(rows, totals).items).toEqual([]);
  });

  it("ignores a query served by a single page", () => {
    const rows = [qp({ query: "widgets", page: "/a", clicks: 100 })];
    expect(findCannibalization(rows, totals).items).toEqual([]);
  });

  it("prefers Google's own query-level aggregate for the headline metrics", () => {
    // Summing per-page impressions double-counts a SERP that showed both pages.
    const rows = [
      qp({ query: "widgets", page: "/a", clicks: 50, impressions: 900 }),
      qp({ query: "widgets", page: "/b", clicks: 50, impressions: 900 }),
    ];
    const queryTotals = new Map([
      ["widgets", { clicks: 100, impressions: 1000, ctr: 0.1, position: 4.2 }],
    ]);
    const [found] = findCannibalization(rows, queryTotals).items;
    expect(found?.impressions).toBe(1000);
    expect(found?.position).toBe(4.2);
  });

  it("falls back to the per-page sum when the query-level pull has no row", () => {
    // Search Console anonymises rare queries, so the two pulls can disagree.
    const rows = [
      qp({ query: "widgets", page: "/a", clicks: 30, impressions: 300, position: 2 }),
      qp({ query: "widgets", page: "/b", clicks: 30, impressions: 300, position: 8 }),
    ];
    const [found] = findCannibalization(rows, totals).items;
    expect(found?.clicks).toBe(60);
    expect(found?.impressions).toBe(600);
    expect(found?.ctr).toBeCloseTo(0.1, 10);
    // Click-weighted, so an even split lands midway.
    expect(found?.position).toBeCloseTo(5, 10);
  });

  it("orders findings by clicks and names the strongest page", () => {
    const rows = [
      qp({ query: "small", page: "/a", clicks: 3 }),
      qp({ query: "small", page: "/b", clicks: 3 }),
      qp({ query: "big", page: "/c", clicks: 300 }),
      qp({ query: "big", page: "/d", clicks: 200 }),
    ];
    const found = findCannibalization(rows, totals).items;
    expect(found.map((row) => row.query)).toEqual(["big", "small"]);
    expect(found[0]?.page).toBe("/c");
  });

  it("supports three-way cannibalization", () => {
    const rows = [
      qp({ query: "widgets", page: "/a", clicks: 34 }),
      qp({ query: "widgets", page: "/b", clicks: 33 }),
      qp({ query: "widgets", page: "/c", clicks: 33 }),
    ];
    expect(findCannibalization(rows, totals).items[0]?.pages).toHaveLength(3);
  });

  it("caps the list and reports how many matched before the cap", () => {
    const rows = Array.from({ length: OPPORTUNITY_LIMIT + 10 }, (_, i) => [
      qp({ query: `k${i}`, page: "/a", clicks: 50 }),
      qp({ query: `k${i}`, page: "/b", clicks: 50 }),
    ]).flat();

    const found = findCannibalization(rows, totals);

    expect(found.total).toBe(OPPORTUNITY_LIMIT + 10);
    expect(found.items).toHaveLength(OPPORTUNITY_LIMIT);
  });
});

/* -------------------------------------------------------------------------- */

describe("computeOpportunities", () => {
  it("runs all three rules over one pair of pulls", () => {
    const queryRows: GscQueryRow[] = [
      // Striking distance: position 8, impressions above the median, and a
      // healthy CTR for that position so it does not also trip the low-CTR rule.
      q({ query: "striking", position: 8, impressions: 5000, clicks: 100, ctr: 0.02 }),
      // Low CTR: page one, far under the curve.
      q({ query: "wasted", position: 2, impressions: 4000, clicks: 4, ctr: 0.001 }),
      // Cannibalized, and deliberately quiet so it does not also strike.
      q({ query: "split", position: 6, impressions: 50, clicks: 20, ctr: 0.4 }),
      q({ query: "filler", position: 30, impressions: 10, clicks: 0, ctr: 0 }),
    ];
    const queryPageRows = [
      qp({ query: "striking", page: "/striking", clicks: 20 }),
      qp({ query: "wasted", page: "/wasted", clicks: 4 }),
      qp({ query: "split", page: "/one", clicks: 10 }),
      qp({ query: "split", page: "/two", clicks: 10 }),
    ];

    const out = computeOpportunities({ queryRows, queryPageRows });

    expect(out.strikingDistance.items.map((row) => row.query)).toEqual([
      "striking",
    ]);
    expect(out.strikingDistance.items[0]?.page).toBe("/striking");
    expect(out.lowCtr.items.map((row) => row.query)).toEqual(["wasted"]);
    expect(out.cannibalization.items.map((row) => row.query)).toEqual(["split"]);
  });

  it("lets one query appear under more than one rule", () => {
    // The rules are independent, not a partition: a query sitting at position 8
    // with above-median impressions AND a dismal snippet is genuinely both
    // "nearly there" and "wasting the ranking it has", and the UI shows it in
    // both sections. Asserted so nobody later "fixes" it into exclusivity.
    const queryRows = [
      q({ query: "both", position: 8, impressions: 5000, clicks: 5, ctr: 0.001 }),
      q({ query: "filler", position: 30, impressions: 10 }),
    ];
    const out = computeOpportunities({ queryRows, queryPageRows: [] });

    expect(out.strikingDistance.items.map((row) => row.query)).toEqual(["both"]);
    expect(out.lowCtr.items.map((row) => row.query)).toEqual(["both"]);
  });

  it("reports the thresholds it used, median included", () => {
    const queryRows = [10, 20, 30].map((impressions, i) =>
      q({ query: `k${i}`, impressions }),
    );
    const out = computeOpportunities({ queryRows, queryPageRows: [] });

    expect(out.thresholds.strikingDistance.minImpressions).toBe(20);
    expect(out.thresholds.lowCtr.ratio).toBe(LOW_CTR_RATIO);
    expect(out.thresholds.cannibalization.minShareOfClicks).toBe(
      CANNIBALIZATION_MIN_SHARE,
    );
  });

  it("returns three empty lists for a property with no data", () => {
    const out = computeOpportunities({ queryRows: [], queryPageRows: [] });
    expect(out.strikingDistance).toEqual({ items: [], total: 0 });
    expect(out.lowCtr).toEqual({ items: [], total: 0 });
    expect(out.cannibalization).toEqual({ items: [], total: 0 });
    expect(out.thresholds.strikingDistance.minImpressions).toBe(0);
  });

  it("reports a pre-cap total on every list, not just the truncated ones", () => {
    // The UI reads `total` unconditionally to decide whether to say "showing
    // 200 of N", so an untruncated list must still carry an honest count
    // rather than 0 or undefined.
    const queryRows = [
      q({ query: "striking", position: 8, impressions: 5000, clicks: 100, ctr: 0.02 }),
      q({ query: "wasted", position: 2, impressions: 4000, clicks: 4, ctr: 0.001 }),
      q({ query: "split", position: 6, impressions: 50, clicks: 20, ctr: 0.4 }),
    ];
    const queryPageRows = [
      qp({ query: "split", page: "/one", clicks: 10 }),
      qp({ query: "split", page: "/two", clicks: 10 }),
    ];

    const out = computeOpportunities({ queryRows, queryPageRows });

    expect(out.strikingDistance.total).toBe(out.strikingDistance.items.length);
    expect(out.lowCtr.total).toBe(out.lowCtr.items.length);
    expect(out.cannibalization.total).toBe(out.cannibalization.items.length);
    expect(out.cannibalization.total).toBe(1);
  });
});
