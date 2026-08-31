import { describe, expect, it } from "vitest";

import type { MonthlyVolumePoint } from "../../../shared/keywords";
import {
  EM_DASH,
  difficultyBand,
  formatCost,
  formatCpc,
  formatIntent,
  formatMonthLabel,
  formatPercent,
  formatRelativeTime,
  formatSerpFeature,
  formatVolume,
  intentVariant,
  sortMonthlyPoints,
} from "./format";

/**
 * The rule these all serve: `null` from DataForSEO means "not reported", and
 * is a different fact from 0. Anything that renders a null as "0" is a bug.
 */
describe("null is not zero", () => {
  it.each([
    ["formatVolume", formatVolume],
    ["formatCpc", formatCpc],
    ["formatCost", formatCost],
    ["formatPercent", formatPercent],
  ] as const)("%s renders null and undefined as an em dash", (_name, fn) => {
    expect(fn(null)).toBe(EM_DASH);
    expect(fn(undefined)).toBe(EM_DASH);
  });

  it("still renders a real zero as zero", () => {
    expect(formatVolume(0)).toBe("0");
    expect(formatCpc(0)).toBe("$0.00");
    expect(formatPercent(0)).toBe("0%");
  });

  it("renders NaN and Infinity as an em dash rather than as text", () => {
    expect(formatVolume(Number.NaN)).toBe(EM_DASH);
    expect(formatVolume(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
  });
});

describe("formatVolume", () => {
  it("groups thousands", () => {
    expect(formatVolume(3600)).toBe("3,600");
    expect(formatVolume(16_600_000)).toBe("16,600,000");
  });
});

describe("formatCpc", () => {
  it("renders USD to the cent", () => {
    expect(formatCpc(15.48)).toBe("$15.48");
    expect(formatCpc(2.5)).toBe("$2.50");
  });
});

describe("formatCost", () => {
  // The composed overview's real price, verified against the live API.
  it("keeps three decimals so differently-priced calls stay distinguishable", () => {
    expect(formatCost(0.11424)).toBe("$0.114");
    expect(formatCost(0.0126)).toBe("$0.013");
    expect(formatCost(0.004)).toBe("$0.004");
  });

  it("never renders a real cost as free", () => {
    expect(formatCost(0.0001)).toBe("< $0.001");
    expect(formatCost(0)).toBe("$0.000");
  });
});

describe("difficultyBand", () => {
  it.each([
    [0, "Easy"],
    [29, "Easy"],
    [30, "Medium"],
    [49, "Medium"],
    [50, "Hard"],
    [69, "Hard"],
    [70, "Very hard"],
    [100, "Very hard"],
  ])("bands %i as %s", (value, label) => {
    expect(difficultyBand(value).label).toBe(label);
  });

  // 69 is the real difficulty of "seo tools" in the UK; it must not round up
  // across the band boundary into "Very hard".
  it("does not drift across a boundary when rounding", () => {
    expect(difficultyBand(69).label).toBe("Hard");
    expect(difficultyBand(69.4).label).toBe("Hard");
  });

  it("clamps out-of-range values instead of inventing a band", () => {
    expect(difficultyBand(150).label).toBe("Very hard");
    expect(difficultyBand(-10).label).toBe("Easy");
  });

  it("is neutral and dashed when not reported", () => {
    expect(difficultyBand(null)).toEqual({ label: EM_DASH, variant: "neutral" });
  });
});

describe("intent", () => {
  it("sentence-cases a known label", () => {
    expect(formatIntent("commercial")).toBe("Commercial");
  });

  it("dashes an absent one", () => {
    expect(formatIntent(null)).toBe(EM_DASH);
    expect(formatIntent("")).toBe(EM_DASH);
  });

  // DataForSEO owns this vocabulary and can extend it; a new label should
  // render plainly rather than crash or be dropped.
  it("passes an unknown label through as neutral", () => {
    expect(formatIntent("speculative")).toBe("Speculative");
    expect(intentVariant("speculative")).toBe("neutral");
  });

  it("gives each known intent its own colour", () => {
    const variants = (
      ["transactional", "commercial", "navigational", "informational"] as const
    ).map(intentVariant);
    expect(new Set(variants).size).toBe(4);
  });
});

describe("formatMonthLabel", () => {
  it("shortens a YYYY-MM period", () => {
    expect(formatMonthLabel("2026-07")).toBe("Jul 26");
    expect(formatMonthLabel("2025-08")).toBe("Aug 25");
  });

  it("passes through anything it cannot parse", () => {
    expect(formatMonthLabel("2026-13")).toBe("2026-13");
    expect(formatMonthLabel("nonsense")).toBe("nonsense");
  });

  it("dashes a null period", () => {
    expect(formatMonthLabel(null)).toBe(EM_DASH);
  });
});

/**
 * The live API returns these newest-first even though the shared type
 * documents "oldest first". Charting the wire order draws the year backwards,
 * so the sort is load-bearing, not cosmetic.
 */
describe("sortMonthlyPoints", () => {
  const point = (period: string | null, searchVolume: number | null): MonthlyVolumePoint => ({
    year: period === null ? null : Number(period.slice(0, 4)),
    month: period === null ? null : Number(period.slice(5, 7)),
    period,
    searchVolume,
  });

  it("reverses the newest-first order the API actually sends", () => {
    const wireOrder = [
      point("2026-07", 8100),
      point("2026-06", 5400),
      point("2025-09", 2900),
      point("2025-08", 2400),
    ];
    expect(sortMonthlyPoints(wireOrder).map((p) => p.period)).toEqual([
      "2025-08",
      "2025-09",
      "2026-06",
      "2026-07",
    ]);
  });

  it("leaves an already-ascending series alone", () => {
    const ascending = [point("2025-08", 1), point("2026-07", 2)];
    expect(sortMonthlyPoints(ascending).map((p) => p.period)).toEqual([
      "2025-08",
      "2026-07",
    ]);
  });

  it("orders across a year boundary rather than by month number", () => {
    const points = [point("2026-01", 1), point("2025-12", 2)];
    expect(sortMonthlyPoints(points).map((p) => p.period)).toEqual([
      "2025-12",
      "2026-01",
    ]);
  });

  it("keeps undated points instead of dropping them, at the end", () => {
    const points = [point(null, 5), point("2026-01", 1)];
    const sorted = sortMonthlyPoints(points);
    expect(sorted).toHaveLength(2);
    expect(sorted.map((p) => p.period)).toEqual(["2026-01", null]);
  });

  it("does not mutate its input", () => {
    const original = [point("2026-07", 1), point("2025-08", 2)];
    const copy = [...original];
    sortMonthlyPoints(original);
    expect(original).toEqual(copy);
  });
});

describe("formatSerpFeature", () => {
  // Every one of these came back from a real SERP call for "seo tools".
  it("humanises the generic case", () => {
    expect(formatSerpFeature("people_also_ask")).toBe("People also ask");
    expect(formatSerpFeature("related_searches")).toBe("Related searches");
    expect(formatSerpFeature("organic")).toBe("Organic");
  });

  it("keeps acronyms upper-case", () => {
    expect(formatSerpFeature("ai_overview")).toBe("AI overview");
    expect(formatSerpFeature("faq")).toBe("FAQ");
  });

  it("passes an unknown feature through the generic rule", () => {
    expect(formatSerpFeature("some_new_feature")).toBe("Some new feature");
  });
});

describe("formatRelativeTime", () => {
  const NOW = Date.parse("2026-08-31T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("collapses the last minute to 'just now'", () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(59 * SECOND), NOW)).toBe("just now");
  });

  it.each([
    [MINUTE, "1 minute ago"],
    [90 * SECOND, "1 minute ago"],
    [5 * MINUTE, "5 minutes ago"],
    [HOUR, "1 hour ago"],
    [3 * HOUR, "3 hours ago"],
    [DAY, "1 day ago"],
    [3 * DAY, "3 days ago"],
    [8 * DAY, "1 week ago"],
    [40 * DAY, "1 month ago"],
    [200 * DAY, "6 months ago"],
  ])("reads %d ms ago as %s", (elapsed, expected) => {
    expect(formatRelativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  /*
   * A 400-day-old payload reading "13 months ago" is technically true and
   * useless; the largest unit that still counts at least one is the readable
   * one.
   */
  it("promotes to the largest unit that still counts", () => {
    expect(formatRelativeTime(ago(400 * DAY), NOW)).toBe("1 year ago");
  });

  /*
   * `fetchedAt` is optional and nullable on ResultMeta — one endpoint reports
   * the provider's own crawl time, which the provider can omit. Null here means
   * the caller omits the chip rather than shows a guess.
   */
  it.each<[value: string | null | undefined, why: string]>([
    [null, "null"],
    [undefined, "undefined"],
    ["", "an empty string"],
    ["not a date", "unparseable text"],
  ])("returns null for %s (%s)", (value) => {
    expect(formatRelativeTime(value, NOW)).toBeNull();
  });

  /*
   * The Worker's clock and the browser's can disagree by a second or two, and
   * "-3 seconds ago" is worse than nothing. Small skew reads as "just now"; a
   * genuinely future timestamp is refused.
   */
  it("absorbs small clock skew and refuses a real future date", () => {
    expect(formatRelativeTime(new Date(NOW + 5 * SECOND).toISOString(), NOW)).toBe(
      "just now",
    );
    expect(formatRelativeTime(new Date(NOW + DAY).toISOString(), NOW)).toBeNull();
  });
});
