import { describe, expect, it } from "vitest";

import type { TargetScore } from "../../../shared/backlinks";
import {
  distinctScoreTargets,
  lookupDomainScore,
  normalizeScoreTarget,
  scoresByTarget,
} from "./domain-scores";

describe("normalizeScoreTarget", () => {
  it("strips scheme, www and a trailing slash", () => {
    expect(normalizeScoreTarget("https://www.example.com/")).toBe("example.com");
    expect(normalizeScoreTarget("HTTP://Example.COM")).toBe("example.com");
    expect(normalizeScoreTarget("  example.com  ")).toBe("example.com");
  });

  it("keeps a path, because a page has its own score", () => {
    expect(normalizeScoreTarget("https://example.com/pricing")).toBe(
      "example.com/pricing",
    );
  });

  it("treats missing input as no target rather than throwing", () => {
    expect(normalizeScoreTarget(null)).toBe("");
    expect(normalizeScoreTarget(undefined)).toBe("");
  });
});

describe("distinctScoreTargets", () => {
  it("de-duplicates across spelling variants and drops blanks", () => {
    expect(
      distinctScoreTargets([
        "https://www.example.com/",
        "example.com",
        null,
        "",
        "other.com",
      ]),
    ).toEqual(["example.com", "other.com"]);
  });

  it("keeps first-seen order so the query key is stable", () => {
    expect(distinctScoreTargets(["b.com", "a.com", "b.com"])).toEqual([
      "b.com",
      "a.com",
    ]);
  });

  it("caps the batch at the request limit", () => {
    const many = Array.from({ length: 10 }, (_, i) => `site${i}.com`);
    expect(distinctScoreTargets(many, 4)).toEqual([
      "site0.com",
      "site1.com",
      "site2.com",
      "site3.com",
    ]);
  });
});

describe("scoresByTarget", () => {
  /**
   * The failure this whole module exists to prevent: the provider answers in
   * its own order, so row 1's score is not necessarily item 1.
   */
  it("matches by target, not by position", () => {
    const items: TargetScore[] = [
      { target: "https://example.com/pricing", domainScore: 91 },
      { target: "second.com", domainScore: 40 },
      { target: "first.com", domainScore: 12 },
    ];
    const scores = scoresByTarget(items);

    expect(lookupDomainScore(scores, "first.com")).toBe(12);
    expect(lookupDomainScore(scores, "second.com")).toBe(40);
    expect(lookupDomainScore(scores, "example.com/pricing")).toBe(91);
  });

  it("matches a www-prefixed answer to a bare request", () => {
    const scores = scoresByTarget([
      { target: "www.example.com", domainScore: 55 },
    ]);
    expect(lookupDomainScore(scores, "https://example.com/")).toBe(55);
  });

  it("keeps a reported score over a later null for the same target", () => {
    const scores = scoresByTarget([
      { target: "example.com", domainScore: 33 },
      { target: "www.example.com", domainScore: null },
    ]);
    expect(lookupDomainScore(scores, "example.com")).toBe(33);
  });

  it("ignores items with no target at all", () => {
    const scores = scoresByTarget([{ target: null, domainScore: 70 }]);
    expect(scores.size).toBe(0);
  });

  it("keeps a real zero distinct from unknown", () => {
    const scores = scoresByTarget([
      { target: "new-site.com", domainScore: 0 },
      { target: "unmeasured.com", domainScore: null },
    ]);
    expect(lookupDomainScore(scores, "new-site.com")).toBe(0);
    expect(lookupDomainScore(scores, "unmeasured.com")).toBeNull();
    expect(lookupDomainScore(scores, "never-asked.com")).toBeNull();
  });
});

describe("lookupDomainScore", () => {
  it("is null before the batch has loaded", () => {
    expect(lookupDomainScore(undefined, "example.com")).toBeNull();
  });
});
