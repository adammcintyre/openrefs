import { describe, expect, it } from "vitest";

import {
  BACKLINKS_RANK_MAX,
  SCORE_MAX,
  toDomainScore,
  toPageScore,
  toScore,
} from "./scores";

describe("toScore", () => {
  it("maps the ends of DataForSEO's scale to the ends of ours", () => {
    expect(toScore(0)).toBe(0);
    expect(toScore(BACKLINKS_RANK_MAX)).toBe(SCORE_MAX);
  });

  it("divides by ten", () => {
    expect(toScore(10)).toBe(1);
    expect(toScore(250)).toBe(25);
    expect(toScore(731)).toBe(73);
    expect(toScore(999)).toBe(100);
  });

  it("rounds to the nearest whole score", () => {
    // 4 -> 0.4 rounds down, 5 -> 0.5 rounds up (Math.round is half-up).
    expect(toScore(4)).toBe(0);
    expect(toScore(5)).toBe(1);
    expect(toScore(314)).toBe(31);
    expect(toScore(315)).toBe(32);
  });

  it("distinguishes 'not reported' from zero", () => {
    // The distinction the whole module exists for: a domain DataForSEO has
    // never crawled is unknown, not worthless.
    expect(toScore(null)).toBeNull();
    expect(toScore(undefined)).toBeNull();
    expect(toScore(0)).toBe(0);
  });

  it("returns null rather than a fake number for unusable input", () => {
    expect(toScore(Number.NaN)).toBeNull();
    expect(toScore(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toScore(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("clamps out-of-range ranks instead of dropping the column", () => {
    expect(toScore(-5)).toBe(0);
    expect(toScore(1500)).toBe(SCORE_MAX);
  });

  it("never leaves the published 0–100 range", () => {
    for (let rank = 0; rank <= BACKLINKS_RANK_MAX; rank += 7) {
      const score = toScore(rank);
      expect(score).not.toBeNull();
      expect(score as number).toBeGreaterThanOrEqual(0);
      expect(score as number).toBeLessThanOrEqual(SCORE_MAX);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it("is monotonic — a higher rank never scores lower", () => {
    let previous = -1;
    for (let rank = 0; rank <= BACKLINKS_RANK_MAX; rank += 13) {
      const score = toScore(rank) as number;
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  it("exposes the same normalisation under both product names", () => {
    expect(toDomainScore(640)).toBe(64);
    expect(toPageScore(640)).toBe(64);
    expect(toDomainScore).toBe(toScore);
    expect(toPageScore).toBe(toScore);
  });
});
