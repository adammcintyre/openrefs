/**
 * These constants are copies. The authoritative values live in the Worker's
 * DataForSEO wrappers, which the SPA must not import (they pull in the client
 * and Hono), so this suite is the tripwire that catches the copies drifting
 * apart — the same arrangement as `components/audit/cost.test.ts`.
 *
 * If one of the pins below fails, the Worker's price changed and the Expansion
 * select has been quoting a stale number. Fix the constant, do not relax the
 * test.
 */
import { describe, expect, it } from "vitest";

import { CONTENT_EXPAND_OPTIONS } from "../../../shared/content";
import {
  CONTENT_EXPANSION_PRICE_USD,
  CONTENT_SERP_DEPTH,
  CONTENT_SERP_PRICE_PER_10_RESULTS_USD,
  CONTENT_SERP_PRICE_USD,
  CONTENT_TRAFFIC_PRICE_PER_ITEM_USD,
  CONTENT_TRAFFIC_PRICE_PER_TASK_USD,
  CONTENT_WORDCOUNT_PRICE_PER_URL_USD,
  describeCosts,
  estimateDiscoverCostUsd,
  estimateWordCountCostUsd,
  formatCostHint,
  formatExpandCostHint,
  formatWordCountHint,
  serpCallsForExpand,
} from "./cost";

describe("price constants mirror the Worker", () => {
  it("pins the live SERP rate and depth (src/worker/dataforseo/serp.ts)", () => {
    expect(CONTENT_SERP_PRICE_PER_10_RESULTS_USD).toBe(0.002);
    expect(CONTENT_SERP_DEPTH).toBe(20);
  });

  it("pins bulk traffic estimation (src/worker/dataforseo/labs.ts)", () => {
    expect(CONTENT_TRAFFIC_PRICE_PER_TASK_USD).toBe(0.012);
    expect(CONTENT_TRAFFIC_PRICE_PER_ITEM_USD).toBe(0.00012);
  });

  it("pins content parsing (src/worker/dataforseo/on-page.ts)", () => {
    expect(CONTENT_WORDCOUNT_PRICE_PER_URL_USD).toBe(0.00015);
  });

  it("pins the observed keyword_suggestions price", () => {
    expect(CONTENT_EXPANSION_PRICE_USD).toBe(0.0126);
  });

  it("derives the per-SERP price from the rate and the depth we buy", () => {
    expect(CONTENT_SERP_PRICE_USD).toBeCloseTo(0.004, 10);
  });
});

describe("serpCallsForExpand", () => {
  it("buys the topic plus one SERP per expansion keyword", () => {
    expect(serpCallsForExpand(0)).toBe(1);
    expect(serpCallsForExpand(5)).toBe(6);
    expect(serpCallsForExpand(10)).toBe(11);
  });

  it("never returns fewer than the topic's own SERP", () => {
    expect(serpCallsForExpand(-3)).toBe(1);
  });
});

describe("estimateDiscoverCostUsd", () => {
  it("charges no expansion lookup when there is no expansion", () => {
    // 1 SERP + the flat traffic-estimation fee, and nothing else.
    expect(estimateDiscoverCostUsd(0)).toBeCloseTo(0.004 + 0.012, 10);
  });

  it("adds the expansion lookup exactly once, however many keywords", () => {
    const five = estimateDiscoverCostUsd(5);
    const ten = estimateDiscoverCostUsd(10);
    // The difference between the two is five SERPs and nothing else — the
    // suggestions call is bought once per sweep, not once per keyword.
    expect(ten - five).toBeCloseTo(5 * CONTENT_SERP_PRICE_USD, 10);
  });

  it("rises monotonically across the options the UI offers", () => {
    const costs = CONTENT_EXPAND_OPTIONS.map((option) =>
      estimateDiscoverCostUsd(option),
    );
    for (let i = 1; i < costs.length; i += 1) {
      expect(costs[i] as number).toBeGreaterThan(costs[i - 1] as number);
    }
  });

  it("leaves no IEEE754 tail on screen", () => {
    // The inputs are numbers like 0.00012; without rounding this is the sort of
    // arithmetic that renders as $0.030000000000000002.
    expect(String(estimateDiscoverCostUsd(10))).not.toMatch(/\d{10}/);
  });
});

describe("estimateWordCountCostUsd", () => {
  it("is one parse per URL", () => {
    expect(estimateWordCountCostUsd(10)).toBeCloseTo(0.0015, 10);
    expect(estimateWordCountCostUsd(1)).toBeCloseTo(0.00015, 10);
  });

  it("treats a negative count as nothing to buy", () => {
    expect(estimateWordCountCostUsd(-1)).toBe(0);
  });
});

describe("formatCostHint", () => {
  it("keeps four decimals below a cent rather than claiming $0.00", () => {
    expect(formatCostHint(0.004)).toBe("$0.0040");
  });

  /*
   * Four decimals is not enough resolution for the word-count rate: $0.00015
   * lands on "$0.0001", understating it by a third. That is the reason
   * `formatWordCountHint` quotes a full batch of ten rather than a per-URL
   * price — at $0.0015 the figure survives the formatter intact.
   */
  it("cannot resolve the per-URL word-count rate, hence the per-batch hint", () => {
    expect(formatCostHint(CONTENT_WORDCOUNT_PRICE_PER_URL_USD)).toBe("$0.0001");
    expect(
      formatCostHint(CONTENT_WORDCOUNT_PRICE_PER_URL_USD * 10),
    ).toBe("$0.0015");
  });

  it("uses two decimals at a cent and above", () => {
    expect(formatCostHint(0.08)).toBe("$0.08");
    expect(formatCostHint(1.5)).toBe("$1.50");
  });

  it("renders nothing spent as $0.00", () => {
    expect(formatCostHint(0)).toBe("$0.00");
    expect(formatCostHint(Number.NaN)).toBe("$0.00");
  });
});

describe("formatExpandCostHint", () => {
  /*
   * "from", never "≈". The estimate omits per-page enrichment, so it is a floor
   * the real bill can only exceed — and a tilde in front of a number that can
   * only go up is the kind of small lie a user catches once, on their invoice.
   */
  it("presents the figure as a floor", () => {
    expect(formatExpandCostHint(0)).toMatch(/^from \$/);
    expect(formatExpandCostHint(10)).toMatch(/^from \$/);
  });
});

describe("formatWordCountHint", () => {
  it("quotes a full batch, since the per-URL price is mostly zeros", () => {
    expect(formatWordCountHint()).toBe("≈$0.0015 per 10");
  });
});

describe("describeCosts", () => {
  const costs = {
    serpUsd: 0.024,
    serpCalls: 6,
    expansionUsd: 0.0126,
    scoresUsd: 0.02,
    trafficUsd: 0.0132,
    totalUsd: 0.0698,
  };

  it("names every part that was actually bought, plus the total", () => {
    const text = describeCosts(costs);
    expect(text).toContain("6 SERPs");
    expect(text).toContain("related keywords");
    expect(text).toContain("Domain Scores");
    expect(text).toContain("traffic estimates");
    expect(text).toContain("$0.07 total");
  });

  it("omits the expansion line when the topic was not expanded", () => {
    const text = describeCosts({
      ...costs,
      serpCalls: 1,
      expansionUsd: 0,
    });
    expect(text).toContain("1 SERP ");
    expect(text).not.toContain("related keywords");
  });

  /*
   * A sweep can buy fewer SERPs than the expansion asked for — suggestions
   * below the volume floor are dropped before their SERP is bought — so the
   * sentence quotes the payload's own count rather than 1 + expand.
   */
  it("quotes the SERP count from the payload, not from the expansion", () => {
    expect(describeCosts({ ...costs, serpCalls: 4 })).toContain("4 SERPs");
  });
});
