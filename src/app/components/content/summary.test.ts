import { describe, expect, it } from "vitest";

import type { ContentPageRow } from "../../../shared/content";
import { median, summarizeContentRows } from "./summary";

function row(patch: Partial<ContentPageRow>): ContentPageRow {
  return {
    url: patch.url ?? "https://example.com/a",
    domain: "example.com",
    title: null,
    domainScore: null,
    pageScore: null,
    estTraffic: null,
    keywords: [],
    totalVolume: 0,
    bestPosition: 1,
    wordCount: null,
    ...patch,
  };
}

describe("median", () => {
  it("is the middle value of an odd-length list", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the two middle values of an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("is null for nothing to average", () => {
    expect(median([])).toBeNull();
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("summarizeContentRows", () => {
  it("counts every loaded row", () => {
    expect(summarizeContentRows([row({}), row({ url: "b" })]).pages).toBe(2);
  });

  /*
   * The reason the strip shows a median and not a mean. One high-authority
   * result in a table of small sites is the normal case, and a mean would
   * report this SERP as twice as competitive as it is.
   */
  it("is not dragged by one high-authority outlier", () => {
    const summary = summarizeContentRows([
      row({ url: "a", domainScore: 10 }),
      row({ url: "b", domainScore: 12 }),
      row({ url: "c", domainScore: 94 }),
    ]);
    expect(summary.medianDomainScore).toBe(12);
  });

  it("takes the median over scored rows only, and says how many", () => {
    const summary = summarizeContentRows([
      row({ url: "a", domainScore: 20 }),
      row({ url: "b", domainScore: null }),
      row({ url: "c", domainScore: 40 }),
    ]);
    expect(summary.medianDomainScore).toBe(30);
    expect(summary.scoredPages).toBe(2);
    expect(summary.pages).toBe(3);
  });

  it("has no median when nothing loaded has a score", () => {
    const summary = summarizeContentRows([row({}), row({ url: "b" })]);
    expect(summary.medianDomainScore).toBeNull();
    expect(summary.scoredPages).toBe(0);
  });

  /*
   * A missing traffic estimate contributes nothing and is counted separately,
   * so the label can say "at least" honestly. Imputing an average here would
   * invent visits that were never measured.
   */
  it("sums known traffic and counts the unmeasured rows apart", () => {
    const summary = summarizeContentRows([
      row({ url: "a", estTraffic: 400 }),
      row({ url: "b", estTraffic: null }),
      row({ url: "c", estTraffic: 350 }),
    ]);
    expect(summary.totalTraffic).toBe(750);
    expect(summary.unmeasuredPages).toBe(1);
  });

  it("distinguishes a measured zero from an unmeasured page", () => {
    const summary = summarizeContentRows([
      row({ url: "a", estTraffic: 0 }),
      row({ url: "b", estTraffic: null }),
    ]);
    expect(summary.totalTraffic).toBe(0);
    expect(summary.unmeasuredPages).toBe(1);
  });

  it("is empty rather than undefined for no rows", () => {
    expect(summarizeContentRows([])).toEqual({
      pages: 0,
      medianDomainScore: null,
      scoredPages: 0,
      totalTraffic: 0,
      unmeasuredPages: 0,
    });
  });
});
