import { describe, expect, it } from "vitest";

import {
  EMPTY_CONTENT_DRAFT,
  activeContentFilterCount,
  isContentDraftEmpty,
  parseContentFilterDraft,
  readFiltersFromParams,
  toContentFilterDraft,
  writeFiltersToParams,
} from "./filters";

describe("parseContentFilterDraft", () => {
  it("drops blank fields rather than sending zeroes", () => {
    expect(parseContentFilterDraft(EMPTY_CONTENT_DRAFT)).toEqual({});
  });

  it("keeps a real zero, which is a meaningful cap", () => {
    // maxDomainScore=0 means "only sites with no measured authority" — a
    // legitimate, if severe, query. It must not be confused with "unset".
    expect(
      parseContentFilterDraft({ ...EMPTY_CONTENT_DRAFT, maxDomainScore: "0" }),
    ).toEqual({ maxDomainScore: 0 });
  });

  it("clamps a Domain Score above the scale instead of 422ing", () => {
    expect(
      parseContentFilterDraft({ ...EMPTY_CONTENT_DRAFT, maxDomainScore: "150" }),
    ).toEqual({ maxDomainScore: 100 });
  });

  it("clamps a negative traffic floor to zero", () => {
    expect(
      parseContentFilterDraft({ ...EMPTY_CONTENT_DRAFT, minTraffic: "-40" }),
    ).toEqual({ minTraffic: 0 });
  });

  it("ignores text that is not a number", () => {
    expect(
      parseContentFilterDraft({
        ...EMPTY_CONTENT_DRAFT,
        maxDomainScore: "banana",
      }),
    ).toEqual({});
  });

  it("trims the text filters and drops whitespace-only ones", () => {
    expect(
      parseContentFilterDraft({
        ...EMPTY_CONTENT_DRAFT,
        include: "  /blog/  ",
        exclude: "   ",
      }),
    ).toEqual({ include: "/blog/" });
  });
});

describe("toContentFilterDraft", () => {
  it("round-trips through the draft unchanged", () => {
    const filters = {
      maxDomainScore: 30,
      minTraffic: 500,
      include: "/blog/",
      exclude: "amazon",
    };
    expect(parseContentFilterDraft(toContentFilterDraft(filters))).toEqual(
      filters,
    );
  });

  it("renders an unset filter as an empty input, not as '0'", () => {
    expect(toContentFilterDraft({}).maxDomainScore).toBe("");
  });
});

describe("activeContentFilterCount", () => {
  it("counts only the filters that are set", () => {
    expect(activeContentFilterCount({})).toBe(0);
    expect(activeContentFilterCount({ maxDomainScore: 30, minTraffic: 500 })).toBe(2);
  });
});

describe("isContentDraftEmpty", () => {
  it("treats whitespace as empty", () => {
    expect(isContentDraftEmpty(EMPTY_CONTENT_DRAFT)).toBe(true);
    expect(
      isContentDraftEmpty({ ...EMPTY_CONTENT_DRAFT, include: "   " }),
    ).toBe(true);
    expect(isContentDraftEmpty({ ...EMPTY_CONTENT_DRAFT, include: "x" })).toBe(
      false,
    );
  });
});

describe("URL round-trip", () => {
  it("survives a trip through a query string", () => {
    const filters = { maxDomainScore: 30, minTraffic: 500, exclude: "pinterest" };
    const params = new URLSearchParams();
    writeFiltersToParams(params, filters);
    expect(readFiltersFromParams(params)).toEqual(filters);
  });

  it("writes nothing for an empty filter set", () => {
    const params = new URLSearchParams();
    writeFiltersToParams(params, {});
    expect(params.toString()).toBe("");
  });

  it("reads a hand-edited nonsense value as no filter at all", () => {
    // A broken URL should cost the reader that filter, not the whole screen.
    const params = new URLSearchParams("maxDomainScore=abc&minTraffic=500");
    expect(readFiltersFromParams(params)).toEqual({ minTraffic: 500 });
  });
});
