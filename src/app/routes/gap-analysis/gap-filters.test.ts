import { describe, expect, it } from "vitest";

import {
  EMPTY_GAP_DRAFT,
  activeGapFilterCount,
  isGapDraftEmpty,
  parseGapFilterDraft,
  toGapFilterDraft,
} from "./gap-filters";

const draft = (over: Partial<typeof EMPTY_GAP_DRAFT> = {}) => ({
  ...EMPTY_GAP_DRAFT,
  ...over,
});

describe("parseGapFilterDraft", () => {
  it("drops blanks so an untouched row does not fork the cache", () => {
    expect(parseGapFilterDraft(EMPTY_GAP_DRAFT)).toEqual({});
  });

  it("reads the numbers and the text", () => {
    expect(
      parseGapFilterDraft(
        draft({
          minVolume: "100",
          maxVolume: "5000",
          minDifficulty: "10",
          maxDifficulty: "60",
          include: " template ",
          exclude: "free",
        }),
      ),
    ).toEqual({
      minVolume: 100,
      maxVolume: 5000,
      minDifficulty: 10,
      maxDifficulty: 60,
      include: "template",
      exclude: "free",
    });
  });

  /**
   * The expensive typo: upstream accepts `>= 900 AND <= 100`, bills for it, and
   * returns nothing — which reads as "no gaps here" rather than as a mistake.
   */
  it("corrects swapped bounds instead of buying an empty result", () => {
    expect(
      parseGapFilterDraft(draft({ minVolume: "900", maxVolume: "100" })),
    ).toEqual({ minVolume: 100, maxVolume: 900 });

    expect(
      parseGapFilterDraft(draft({ minDifficulty: "80", maxDifficulty: "20" })),
    ).toEqual({ minDifficulty: 20, maxDifficulty: 80 });
  });

  it("clamps difficulty into the 0–100 the Worker accepts", () => {
    expect(
      parseGapFilterDraft(draft({ minDifficulty: "-5", maxDifficulty: "150" })),
    ).toEqual({ minDifficulty: 0, maxDifficulty: 100 });
  });

  it("floors a negative volume at zero", () => {
    expect(parseGapFilterDraft(draft({ minVolume: "-40" }))).toEqual({
      minVolume: 0,
    });
  });

  it("ignores values that are not numbers at all", () => {
    expect(parseGapFilterDraft(draft({ minVolume: "banana" }))).toEqual({});
  });
});

describe("toGapFilterDraft", () => {
  it("round-trips, so reopening the row shows what is applied", () => {
    const filters = parseGapFilterDraft(
      draft({ minVolume: "100", maxDifficulty: "40", exclude: "free" }),
    );
    expect(parseGapFilterDraft(toGapFilterDraft(filters))).toEqual(filters);
  });
});

describe("activeGapFilterCount", () => {
  it("counts what is on", () => {
    expect(activeGapFilterCount({})).toBe(0);
    expect(activeGapFilterCount({ minVolume: 100, include: "x" })).toBe(2);
  });
});

describe("isGapDraftEmpty", () => {
  it("treats whitespace as empty", () => {
    expect(isGapDraftEmpty(EMPTY_GAP_DRAFT)).toBe(true);
    expect(isGapDraftEmpty(draft({ include: "   " }))).toBe(true);
    expect(isGapDraftEmpty(draft({ include: "x" }))).toBe(false);
  });
});
