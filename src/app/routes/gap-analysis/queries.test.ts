import { describe, expect, it } from "vitest";

import { gapExportUrl, gapQueryParams, nextGapOffset } from "./queries";
import type { GapSearch } from "./url-state";

const SEARCH: GapSearch = {
  target: "brandpacks.com",
  competitors: ["templatesbooth.com", "hikelist.com"],
  location: 2826,
  language: "en",
  mode: "missing",
  view: "keywords",
  pages: [],
};

const page = (over: Partial<Parameters<typeof nextGapOffset>[0]> = {}) => ({
  items: Array.from({ length: 10 }, () => ({})),
  filteredOut: 40,
  offset: 0,
  limit: 50,
  totalCount: null as number | null,
  ...over,
});

describe("nextGapOffset", () => {
  /**
   * The rule this module gets wrong if it is careless: the Worker fetches
   * `limit` rows and then drops the ones the mode excludes, so a page that
   * shows 10 rows may have consumed 50. Advancing by the visible count would
   * re-buy the 40 that were filtered out.
   */
  it("advances past the rows the mode filtered out, not just the visible ones", () => {
    expect(nextGapOffset(page())).toBe(50);
  });

  it("cannot loop forever on a page where everything was filtered out", () => {
    expect(nextGapOffset(page({ items: [], filteredOut: 50 }))).toBe(50);
  });

  it("stops when upstream returned nothing at all", () => {
    expect(nextGapOffset(page({ items: [], filteredOut: 0 }))).toBeUndefined();
  });

  it("stops on a short page", () => {
    expect(
      nextGapOffset(page({ items: [{}, {}], filteredOut: 7 })),
    ).toBeUndefined();
  });

  it("stops once the reported total is reached", () => {
    expect(
      nextGapOffset(page({ offset: 50, totalCount: 100 })),
    ).toBeUndefined();
    expect(nextGapOffset(page({ offset: 50, totalCount: 500 }))).toBe(100);
  });
});

describe("gapQueryParams", () => {
  it("carries the whole comparison", () => {
    const params = gapQueryParams("ws-1", SEARCH, {});
    expect(params.get("workspace")).toBe("ws-1");
    expect(params.get("target")).toBe("brandpacks.com");
    expect(params.get("competitors")).toBe("templatesbooth.com,hikelist.com");
    expect(params.get("location")).toBe("2826");
    expect(params.get("language")).toBe("en");
    expect(params.get("mode")).toBe("missing");
  });

  it("appends only the filters that are set", () => {
    const params = gapQueryParams("ws-1", SEARCH, {
      minVolume: 100,
      exclude: "free",
    });
    expect(params.get("minVolume")).toBe("100");
    expect(params.get("exclude")).toBe("free");
    expect(params.get("maxVolume")).toBeNull();
    expect(params.get("include")).toBeNull();
  });
});

describe("gapExportUrl", () => {
  it("is the same query as the table, as a same-origin link", () => {
    const url = gapExportUrl("ws-1", { ...SEARCH, mode: "weak" }, { minVolume: 50 });
    expect(url.startsWith("/api/v1/gap/keywords/export.csv?")).toBe(true);
    expect(url).toContain("mode=weak");
    expect(url).toContain("minVolume=50");
    expect(url).toContain("competitors=templatesbooth.com%2Chikelist.com");
  });
});
