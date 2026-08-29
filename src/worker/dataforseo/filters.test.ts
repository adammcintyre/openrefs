import { describe, expect, it } from "vitest";

import { ApiException } from "../http";
import type { LabsFilter, LabsSort } from "./filters";
import {
  containsFilter,
  LABS_MAX_FILTERS,
  LABS_MAX_SORTS,
  rangeFilters,
  toLabsFilters,
  toLabsOrderBy,
} from "./filters";

const volume = "keyword_data.keyword_info.search_volume";
const rank = "ranked_serp_element.serp_item.rank_group";

describe("toLabsFilters", () => {
  it("omits the key entirely when there is nothing to filter", () => {
    // `[]` is not the same as absent — DataForSEO errors the task on an empty
    // filters array, so this must be undefined rather than a falsy array.
    expect(toLabsFilters([])).toBeUndefined();
  });

  it("emits a BARE TRIPLE for a single condition, not a wrapped one", () => {
    // The documented single-condition form. Wrapping it would send a shape
    // their docs never show.
    expect(toLabsFilters([{ field: volume, operator: ">=", value: 50 }])).toEqual(
      [volume, ">=", 50],
    );
  });

  it("interleaves a bare 'and' between two conditions", () => {
    const filters: LabsFilter[] = [
      { field: rank, operator: "<=", value: 10 },
      { field: "ranked_serp_element.serp_item.type", operator: "<>", value: "paid" },
    ];
    expect(toLabsFilters(filters)).toEqual([
      [rank, "<=", 10],
      "and",
      ["ranked_serp_element.serp_item.type", "<>", "paid"],
    ]);
  });

  it("interleaves 'or' when asked", () => {
    const filters: LabsFilter[] = [
      { field: volume, operator: ">=", value: 10 },
      { field: volume, operator: "<=", value: 100 },
    ];
    expect(toLabsFilters(filters, "or")).toEqual([
      [volume, ">=", 10],
      "or",
      [volume, "<=", 100],
    ]);
  });

  it("places exactly one operator between each pair", () => {
    const filters: LabsFilter[] = Array.from({ length: 4 }, (_, i) => ({
      field: volume,
      operator: ">=" as const,
      value: i,
    }));
    const built = toLabsFilters(filters);
    expect(Array.isArray(built)).toBe(true);
    // 4 conditions + 3 joins.
    expect(built).toHaveLength(7);
    expect((built as unknown[]).filter((e) => e === "and")).toHaveLength(3);
  });

  it("accepts exactly the documented maximum", () => {
    const filters: LabsFilter[] = Array.from(
      { length: LABS_MAX_FILTERS },
      () => ({ field: volume, operator: ">=" as const, value: 1 }),
    );
    expect(() => toLabsFilters(filters)).not.toThrow();
  });

  it("refuses one more than the maximum, before the money is spent", () => {
    const filters: LabsFilter[] = Array.from(
      { length: LABS_MAX_FILTERS + 1 },
      () => ({ field: volume, operator: ">=" as const, value: 1 }),
    );
    expect(() => toLabsFilters(filters)).toThrow(ApiException);
    try {
      toLabsFilters(filters);
    } catch (err) {
      expect((err as ApiException).code).toBe("validation_failed");
    }
  });

  it("passes array values through for `in`", () => {
    expect(
      toLabsFilters([{ field: volume, operator: "in", value: [10, 1000] }]),
    ).toEqual([volume, "in", [10, 1000]]);
  });
});

describe("rangeFilters", () => {
  it("produces nothing when both bounds are absent", () => {
    expect(rangeFilters(volume, undefined, undefined)).toEqual([]);
  });

  it("produces one inclusive condition per supplied bound", () => {
    expect(rangeFilters(volume, 100, undefined)).toEqual([
      { field: volume, operator: ">=", value: 100 },
    ]);
    expect(rangeFilters(volume, undefined, 500)).toEqual([
      { field: volume, operator: "<=", value: 500 },
    ]);
  });

  it("is inclusive at both ends — 'min 100' includes 100", () => {
    expect(rangeFilters(volume, 100, 500)).toEqual([
      { field: volume, operator: ">=", value: 100 },
      { field: volume, operator: "<=", value: 500 },
    ]);
  });

  it("keeps a zero bound rather than treating it as absent", () => {
    expect(rangeFilters(volume, 0, undefined)).toEqual([
      { field: volume, operator: ">=", value: 0 },
    ]);
  });

  it("composes into a valid two-condition expression", () => {
    expect(toLabsFilters(rangeFilters(volume, 100, 500))).toEqual([
      [volume, ">=", 100],
      "and",
      [volume, "<=", 500],
    ]);
  });
});

describe("containsFilter", () => {
  it("wraps the needle in the wildcards `like` requires", () => {
    expect(containsFilter("keyword_data.keyword", "seo")).toEqual({
      field: "keyword_data.keyword",
      operator: "like",
      value: "%seo%",
    });
  });

  it("negates to not_like", () => {
    expect(containsFilter("keyword_data.keyword", "free", true)).toEqual({
      field: "keyword_data.keyword",
      operator: "not_like",
      value: "%free%",
    });
  });

  it("leaves user wildcards intact — broad beats silently empty", () => {
    // No documented escape exists upstream; a backslash would most likely be
    // matched literally and find nothing.
    expect(containsFilter("keyword_data.keyword", "50%").value).toBe("%50%%");
  });
});

describe("toLabsOrderBy", () => {
  it("omits the key when unsorted", () => {
    expect(toLabsOrderBy([])).toBeUndefined();
  });

  it("emits the comma-joined `field,direction` string form", () => {
    expect(toLabsOrderBy([{ field: volume, direction: "desc" }])).toEqual([
      `${volume},desc`,
    ]);
  });

  it("preserves rule order — the first rule is the primary sort", () => {
    const sorts: LabsSort[] = [
      { field: volume, direction: "desc" },
      { field: "keyword_data.keyword_info.cpc", direction: "asc" },
    ];
    expect(toLabsOrderBy(sorts)).toEqual([
      `${volume},desc`,
      "keyword_data.keyword_info.cpc,asc",
    ]);
  });

  it("accepts exactly three rules and refuses a fourth", () => {
    const three: LabsSort[] = Array.from({ length: LABS_MAX_SORTS }, () => ({
      field: volume,
      direction: "desc" as const,
    }));
    expect(() => toLabsOrderBy(three)).not.toThrow();
    expect(() =>
      toLabsOrderBy([...three, { field: volume, direction: "asc" }]),
    ).toThrow(ApiException);
  });
});
