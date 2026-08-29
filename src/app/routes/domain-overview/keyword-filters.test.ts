import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  activeFilterCount,
  isDraftEmpty,
  parseFilterDraft,
  toFilterDraft,
} from "./keyword-filters";

describe("parseFilterDraft", () => {
  it("is empty for an untouched row — a blank field must not fork the cache key", () => {
    expect(parseFilterDraft(EMPTY_DRAFT)).toEqual({});
  });

  it("parses what was typed", () => {
    expect(
      parseFilterDraft({
        ...EMPTY_DRAFT,
        minVolume: "100",
        maxPosition: "10",
        include: " template ",
      }),
    ).toEqual({ minVolume: 100, maxPosition: 10, include: "template" });
  });

  /*
   * DataForSEO would accept `volume >= 900 AND volume <= 100`, bill for it and
   * return nothing — which reads on screen as "this domain ranks for nothing".
   */
  it("corrects swapped bounds instead of buying an empty result", () => {
    expect(
      parseFilterDraft({ ...EMPTY_DRAFT, minVolume: "900", maxVolume: "100" }),
    ).toEqual({ minVolume: 100, maxVolume: 900 });

    expect(
      parseFilterDraft({ ...EMPTY_DRAFT, minPosition: "20", maxPosition: "3" }),
    ).toEqual({ minPosition: 3, maxPosition: 20 });
  });

  it("drops values that cannot mean anything", () => {
    expect(
      parseFilterDraft({
        ...EMPTY_DRAFT,
        minVolume: "-5",
        // Positions are 1-based, so 0 is a typo rather than a filter.
        minPosition: "0",
        maxVolume: "abc",
        exclude: "   ",
      }),
    ).toEqual({});
  });

  it("keeps a deliberate zero volume floor", () => {
    expect(parseFilterDraft({ ...EMPTY_DRAFT, minVolume: "0" })).toEqual({
      minVolume: 0,
    });
  });
});

describe("toFilterDraft", () => {
  it("round-trips applied filters back into the inputs", () => {
    const filters = { minVolume: 100, maxPosition: 10, include: "template" };
    expect(parseFilterDraft(toFilterDraft(filters))).toEqual(filters);
  });

  it("blanks anything unset", () => {
    expect(toFilterDraft({})).toEqual(EMPTY_DRAFT);
  });
});

describe("counting", () => {
  it("counts only what is set", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ minVolume: 100, include: "a" })).toBe(2);
  });

  it("knows an empty draft from a filled one", () => {
    expect(isDraftEmpty(EMPTY_DRAFT)).toBe(true);
    expect(isDraftEmpty({ ...EMPTY_DRAFT, include: "  " })).toBe(true);
    expect(isDraftEmpty({ ...EMPTY_DRAFT, minVolume: "1" })).toBe(false);
  });
});
