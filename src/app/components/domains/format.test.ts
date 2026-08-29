import { describe, expect, it } from "vitest";

import {
  EM_DASH,
  aggregateMeta,
  costChipTitle,
  formatCostChip,
  formatCount,
  formatCpc,
  formatMoney,
  formatPercentDelta,
  formatPeriod,
  formatTraffic,
  isLikelyDomain,
  normalizeDomainInput,
  percentChange,
  urlPath,
} from "./format";

describe("null is not zero", () => {
  it("renders an em dash for anything unreported", () => {
    expect(formatCount(null)).toBe(EM_DASH);
    expect(formatCount(undefined)).toBe(EM_DASH);
    expect(formatTraffic(null)).toBe(EM_DASH);
    expect(formatMoney(null)).toBe(EM_DASH);
    expect(formatCpc(null)).toBe(EM_DASH);
  });

  it("still renders a measured zero as zero", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatTraffic(0)).toBe("0");
    expect(formatMoney(0)).toBe("$0");
    expect(formatCpc(0)).toBe("$0.00");
  });

  it("treats NaN and Infinity as unreported rather than printing them", () => {
    expect(formatCount(Number.NaN)).toBe(EM_DASH);
    expect(formatTraffic(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
  });
});

describe("number formatting", () => {
  it("groups thousands", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("rounds estimated traffic — the decimals imply a precision it lacks", () => {
    expect(formatTraffic(1204.63)).toBe("1,205");
    expect(formatTraffic(0.4)).toBe("0");
  });

  it("keeps cents for CPC and drops them for traffic value", () => {
    expect(formatCpc(0.42)).toBe("$0.42");
    expect(formatMoney(12345.67)).toBe("$12,346");
  });
});

describe("formatCostChip", () => {
  it("says cached when nothing was spent", () => {
    expect(formatCostChip({ costUsd: 0, cached: true })).toBe("cached");
  });

  it("names the price of a live call", () => {
    expect(formatCostChip({ costUsd: 0.1, cached: false })).toBe("$0.10 live");
  });

  it("never rounds a real charge down to $0.00", () => {
    expect(formatCostChip({ costUsd: 0.0011, cached: false })).toBe(
      "<$0.01 live",
    );
  });

  it("distinguishes a free live call from a cached one", () => {
    expect(formatCostChip({ costUsd: 0, cached: false })).toBe(
      "live · no charge",
    );
  });

  it("explains itself in the tooltip", () => {
    expect(costChipTitle({ costUsd: 0, cached: true })).toContain("cache");
    expect(costChipTitle({ costUsd: 0.02, cached: false })).toContain("$0.02");
  });
});

describe("aggregateMeta", () => {
  it("is null with no pages", () => {
    expect(aggregateMeta([])).toBeNull();
  });

  it("sums cost across loaded pages", () => {
    expect(
      aggregateMeta([
        { costUsd: 0.01, cached: false },
        { costUsd: 0.02, cached: false },
      ]),
    ).toEqual({ costUsd: 0.03, cached: false });
  });

  it("only claims cached when every page was", () => {
    expect(
      aggregateMeta([
        { costUsd: 0, cached: true },
        { costUsd: 0.02, cached: false },
      ]),
    ).toEqual({ costUsd: 0.02, cached: false });

    expect(
      aggregateMeta([
        { costUsd: 0, cached: true },
        { costUsd: 0, cached: true },
      ]),
    ).toEqual({ costUsd: 0, cached: true });
  });
});

describe("normalizeDomainInput", () => {
  it("reduces a pasted URL to its hostname", () => {
    expect(normalizeDomainInput("https://www.Example.com/pricing?utm=x#top")).toBe(
      "example.com",
    );
  });

  it("trims, lowercases and drops a trailing dot", () => {
    expect(normalizeDomainInput("  BrandPacks.com.  ")).toBe("brandpacks.com");
  });

  it("leaves a bare hostname alone", () => {
    expect(normalizeDomainInput("brandpacks.com")).toBe("brandpacks.com");
  });

  it("keeps subdomains that are not www", () => {
    expect(normalizeDomainInput("http://blog.example.co.uk/a/b")).toBe(
      "blog.example.co.uk",
    );
  });

  it("is empty for empty input", () => {
    expect(normalizeDomainInput("   ")).toBe("");
  });
});

describe("isLikelyDomain", () => {
  it("accepts hostnames", () => {
    expect(isLikelyDomain("example.com")).toBe(true);
    expect(isLikelyDomain("sub.example.co.uk")).toBe(true);
  });

  it("rejects things that would waste a call", () => {
    expect(isLikelyDomain("")).toBe(false);
    expect(isLikelyDomain("localhost")).toBe(false);
    expect(isLikelyDomain("example.c")).toBe(false);
    expect(isLikelyDomain("192.168.0.1")).toBe(false);
  });
});

describe("urlPath", () => {
  it("keeps the part that differs between rows", () => {
    expect(urlPath("https://example.com/blog/post?page=2")).toBe(
      "/blog/post?page=2",
    );
  });

  it("shows a root URL as /", () => {
    expect(urlPath("https://example.com")).toBe("/");
  });

  it("passes through anything it cannot parse", () => {
    expect(urlPath("/already/a/path")).toBe("/already/a/path");
  });

  it("em-dashes a missing URL", () => {
    expect(urlPath(null)).toBe(EM_DASH);
    expect(urlPath("")).toBe(EM_DASH);
  });
});

describe("formatPeriod", () => {
  it("turns a period into a readable month", () => {
    expect(formatPeriod("2026-03")).toBe("Mar 2026");
  });

  it("passes through anything unexpected", () => {
    expect(formatPeriod("whenever")).toBe("whenever");
    expect(formatPeriod("2026-13")).toBe("2026-13");
    expect(formatPeriod(null)).toBe(EM_DASH);
  });
});

describe("percentChange", () => {
  it("computes month over month", () => {
    expect(percentChange(120, 100)).toBeCloseTo(20);
    expect(percentChange(80, 100)).toBeCloseTo(-20);
  });

  it("refuses to divide by a zero or missing baseline", () => {
    expect(percentChange(120, 0)).toBeNull();
    expect(percentChange(120, null)).toBeNull();
    expect(percentChange(null, 100)).toBeNull();
  });

  it("labels with an explicit sign", () => {
    expect(formatPercentDelta(12.44)).toBe("+12.4%");
    expect(formatPercentDelta(-3)).toBe("-3.0%");
    expect(formatPercentDelta(0)).toBe("0.0%");
  });
});
