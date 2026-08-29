import { describe, expect, it } from "vitest";

import {
  AUDIT_JS_COST_MULTIPLIER,
  AUDIT_LIGHTHOUSE_PRICE_USD,
  AUDIT_PRICE_PER_PAGE_JS_USD,
  AUDIT_PRICE_PER_PAGE_USD,
  costBreakdown,
  estimateAuditCostUsd,
  formatCostCeiling,
  formatCostHint,
  formatPerPageRate,
  perPageCostUsd,
} from "./cost";

/**
 * These are the copies the UI shows. The authoritative values live in
 * `src/worker/dataforseo/on-page.ts`; this suite is the tripwire that catches
 * the copy drifting from them (see the header of cost.ts for why there is a
 * copy at all).
 */
describe("price constants", () => {
  it("match the verified DataForSEO price list", () => {
    expect(AUDIT_PRICE_PER_PAGE_USD).toBe(0.00015);
    expect(AUDIT_PRICE_PER_PAGE_JS_USD).toBe(0.0015);
    expect(AUDIT_LIGHTHOUSE_PRICE_USD).toBe(0.005);
  });

  it("makes JS rendering 10× basic, not the 2× the spec claims", () => {
    expect(AUDIT_JS_COST_MULTIPLIER).toBe(10);
  });

  it("prices one Lighthouse run above an entire 25-page crawl", () => {
    // The whole argument for homepage-only Lighthouse in v1.
    expect(AUDIT_LIGHTHOUSE_PRICE_USD).toBeGreaterThan(
      25 * AUDIT_PRICE_PER_PAGE_USD,
    );
  });
});

describe("perPageCostUsd", () => {
  it("switches rate on the JS toggle", () => {
    expect(perPageCostUsd(false)).toBe(0.00015);
    expect(perPageCostUsd(true)).toBe(0.0015);
  });
});

describe("estimateAuditCostUsd", () => {
  it("is crawl ceiling plus one Lighthouse run", () => {
    // 25 × $0.00015 = $0.00375, + $0.005 = $0.00875.
    expect(estimateAuditCostUsd(25, false)).toBe(0.00875);
  });

  it("covers every offered crawl size", () => {
    expect(estimateAuditCostUsd(100, false)).toBe(0.02);
    expect(estimateAuditCostUsd(250, false)).toBe(0.0425);
    expect(estimateAuditCostUsd(500, false)).toBe(0.08);
    expect(estimateAuditCostUsd(1000, false)).toBe(0.155);
  });

  it("multiplies only the crawl by 10 when rendering JS, never Lighthouse", () => {
    // 25 × $0.0015 = $0.0375, + a flat $0.005 = $0.0425 — so the total is 4.9×
    // the basic audit, not 10×. A UI that said "10× the price" would be wrong.
    expect(estimateAuditCostUsd(25, true)).toBe(0.0425);
    expect(estimateAuditCostUsd(1000, true)).toBe(1.505);
  });

  it("does not leak floating-point noise into the number on screen", () => {
    // 250 × 0.00015 is 0.037500000000000006 in IEEE754 before rounding.
    expect(String(estimateAuditCostUsd(250, false))).toBe("0.0425");
  });

  it("still charges for Lighthouse when the crawl is empty or absurd", () => {
    expect(estimateAuditCostUsd(0, false)).toBe(0.005);
    expect(estimateAuditCostUsd(-10, false)).toBe(0.005);
  });
});

describe("formatCostHint", () => {
  it("keeps four decimals below a cent so an estimate never reads as free", () => {
    expect(formatCostHint(0.00875)).toBe("$0.0088");
    expect(formatCostHint(0.005)).toBe("$0.0050");
  });

  it("uses two decimals from a cent up", () => {
    expect(formatCostHint(0.01)).toBe("$0.01");
    expect(formatCostHint(0.02)).toBe("$0.02");
    expect(formatCostHint(1.5)).toBe("$1.50");
  });

  it("treats zero, negatives and nonsense as $0.00", () => {
    expect(formatCostHint(0)).toBe("$0.00");
    expect(formatCostHint(-1)).toBe("$0.00");
    expect(formatCostHint(Number.NaN)).toBe("$0.00");
  });
});

describe("formatCostCeiling", () => {
  it('always says "up to" — unused pages are refunded', () => {
    expect(formatCostCeiling(estimateAuditCostUsd(100, false))).toBe(
      "up to $0.02",
    );
    expect(formatCostCeiling(estimateAuditCostUsd(25, false))).toBe(
      "up to $0.0088",
    );
  });
});

describe("formatPerPageRate", () => {
  it("keeps the base rate exact rather than rounding it up a third", () => {
    // formatCostHint would render this as "$0.0002".
    expect(formatPerPageRate(AUDIT_PRICE_PER_PAGE_USD)).toBe("$0.00015");
  });

  it("strips trailing zeros", () => {
    expect(formatPerPageRate(AUDIT_PRICE_PER_PAGE_JS_USD)).toBe("$0.0015");
  });
});

describe("costBreakdown", () => {
  it("names both halves and says the crawl half is refundable", () => {
    const text = costBreakdown(100, false);
    expect(text).toContain("100 pages × $0.00015");
    expect(text).toContain("$0.0050");
    expect(text).toContain("refunded");
  });

  it("quotes the JS rate when the toggle is on", () => {
    expect(costBreakdown(25, true)).toContain("$0.0015");
  });
});
