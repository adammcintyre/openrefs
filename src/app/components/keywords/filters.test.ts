import { describe, expect, it } from "vitest";

import type { KeywordRow } from "../../../shared/keywords";
import {
  EMPTY_FILTERS,
  filterKeywordRows,
  isFilterActive,
  matchesKeywordFilters,
  parseBound,
} from "./filters";
import type { KeywordFilterState } from "./filters";

const row = (patch: Partial<KeywordRow> = {}): KeywordRow => ({
  keyword: "seo tools",
  searchVolume: 1000,
  cpc: 2.5,
  competition: 0.4,
  competitionLevel: "MEDIUM",
  keywordDifficulty: 45,
  intent: "commercial",
  ...patch,
});

const filters = (patch: Partial<KeywordFilterState> = {}): KeywordFilterState => ({
  ...EMPTY_FILTERS,
  ...patch,
});

describe("parseBound", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["abc", null],
    ["1e", null],
    ["-", null],
    ["0", 0],
    ["100", 100],
    ["  42  ", 42],
    ["2.5", 2.5],
    ["-5", -5],
  ])("parses %j as %j", (input, expected) => {
    expect(parseBound(input)).toBe(expected);
  });

  it("treats Infinity as no bound", () => {
    expect(parseBound("Infinity")).toBe(null);
  });
});

describe("isFilterActive", () => {
  it("is false for the empty state", () => {
    expect(isFilterActive(EMPTY_FILTERS)).toBe(false);
  });

  it("is false while a bound is still unparseable", () => {
    expect(isFilterActive(filters({ minVolume: "abc" }))).toBe(false);
  });

  it("counts a zero bound as active", () => {
    expect(isFilterActive(filters({ minVolume: "0" }))).toBe(true);
  });

  it.each([
    ["minVolume", "10"],
    ["maxVolume", "10"],
    ["minDifficulty", "10"],
    ["maxDifficulty", "10"],
    ["include", "seo"],
    ["exclude", "free"],
  ] as const)("is true when %s is set", (key, value) => {
    expect(isFilterActive(filters({ [key]: value }))).toBe(true);
  });
});

describe("matchesKeywordFilters", () => {
  it("keeps everything when no filter is set", () => {
    expect(matchesKeywordFilters(row(), EMPTY_FILTERS)).toBe(true);
    expect(
      matchesKeywordFilters(
        row({ searchVolume: null, keywordDifficulty: null }),
        EMPTY_FILTERS,
      ),
    ).toBe(true);
  });

  describe("volume bounds", () => {
    it("applies min and max inclusively", () => {
      expect(
        matchesKeywordFilters(row({ searchVolume: 100 }), filters({ minVolume: "100" })),
      ).toBe(true);
      expect(
        matchesKeywordFilters(row({ searchVolume: 99 }), filters({ minVolume: "100" })),
      ).toBe(false);
      expect(
        matchesKeywordFilters(row({ searchVolume: 100 }), filters({ maxVolume: "100" })),
      ).toBe(true);
      expect(
        matchesKeywordFilters(row({ searchVolume: 101 }), filters({ maxVolume: "100" })),
      ).toBe(false);
    });

    it("applies both ends together", () => {
      const range = filters({ minVolume: "100", maxVolume: "1000" });
      expect(matchesKeywordFilters(row({ searchVolume: 500 }), range)).toBe(true);
      expect(matchesKeywordFilters(row({ searchVolume: 50 }), range)).toBe(false);
      expect(matchesKeywordFilters(row({ searchVolume: 5000 }), range)).toBe(false);
    });
  });

  /*
   * The null contract, and the reason this file exists. `null` means "not
   * reported", so an unknown volume can neither prove nor disprove a bound —
   * it is excluded once a bound is set, and kept when none is. Treating null
   * as 0 would let unknown rows pass a "max 50" filter as if they were quiet
   * keywords, which is a different and wrong claim.
   */
  describe("unreported metrics", () => {
    it("keeps a null metric when no bound constrains it", () => {
      expect(
        matchesKeywordFilters(
          row({ searchVolume: null }),
          filters({ minDifficulty: "10" }),
        ),
      ).toBe(true);
    });

    it("drops a null volume once a volume bound is set", () => {
      expect(
        matchesKeywordFilters(row({ searchVolume: null }), filters({ minVolume: "0" })),
      ).toBe(false);
      expect(
        matchesKeywordFilters(
          row({ searchVolume: null }),
          filters({ maxVolume: "1000000" }),
        ),
      ).toBe(false);
    });

    it("drops a null difficulty once a difficulty bound is set", () => {
      expect(
        matchesKeywordFilters(
          row({ keywordDifficulty: null }),
          filters({ maxDifficulty: "100" }),
        ),
      ).toBe(false);
    });

    it("distinguishes a real zero from a null", () => {
      expect(
        matchesKeywordFilters(row({ searchVolume: 0 }), filters({ maxVolume: "10" })),
      ).toBe(true);
      expect(
        matchesKeywordFilters(row({ searchVolume: null }), filters({ maxVolume: "10" })),
      ).toBe(false);
    });
  });

  describe("include / exclude", () => {
    it("matches case-insensitively", () => {
      expect(
        matchesKeywordFilters(row({ keyword: "Best SEO Tools" }), filters({ include: "seo" })),
      ).toBe(true);
      expect(
        matchesKeywordFilters(row({ keyword: "best seo tools" }), filters({ exclude: "SEO" })),
      ).toBe(false);
    });

    it("ignores surrounding whitespace in the term", () => {
      expect(
        matchesKeywordFilters(row({ keyword: "seo tools" }), filters({ include: "  tools  " })),
      ).toBe(true);
    });

    it("drops a row failing include even when exclude also passes", () => {
      expect(
        matchesKeywordFilters(
          row({ keyword: "link building" }),
          filters({ include: "seo", exclude: "free" }),
        ),
      ).toBe(false);
    });

    it("applies exclude on top of a passing include", () => {
      expect(
        matchesKeywordFilters(
          row({ keyword: "free seo tools" }),
          filters({ include: "seo", exclude: "free" }),
        ),
      ).toBe(false);
    });
  });
});

describe("filterKeywordRows", () => {
  const rows = [
    row({ keyword: "seo tools", searchVolume: 1000, keywordDifficulty: 45 }),
    row({ keyword: "free seo tools", searchVolume: 500, keywordDifficulty: 20 }),
    row({ keyword: "link building", searchVolume: 2000, keywordDifficulty: 80 }),
    row({ keyword: "unknown metric", searchVolume: null, keywordDifficulty: null }),
  ];

  it("returns a copy, not the original array, when inactive", () => {
    const result = filterKeywordRows(rows, EMPTY_FILTERS);
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it("preserves input order", () => {
    expect(
      filterKeywordRows(rows, filters({ minVolume: "100" })).map((r) => r.keyword),
    ).toEqual(["seo tools", "free seo tools", "link building"]);
  });

  it("combines every control at once", () => {
    expect(
      filterKeywordRows(
        rows,
        filters({
          minVolume: "100",
          maxVolume: "1500",
          maxDifficulty: "50",
          include: "seo",
          exclude: "free",
        }),
      ).map((r) => r.keyword),
    ).toEqual(["seo tools"]);
  });

  it("can filter down to nothing", () => {
    expect(filterKeywordRows(rows, filters({ minVolume: "999999" }))).toEqual([]);
  });
});
