import { describe, expect, it } from "vitest";

import {
  gapExportUrl,
  gapFreshParams,
  gapQueryParams,
  nextGapOffset,
} from "./queries";
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

/**
 * The billing invariants behind the search trail. A history click must cost
 * nothing, and only a Refresh press may spend — which comes down to which
 * builder can emit which parameter.
 */
describe("cache mode", () => {
  it("asks for nothing special in the ordinary case", () => {
    const params = gapQueryParams("ws-1", SEARCH, {}, "auto");
    expect(params.get("stale")).toBeNull();
    expect(params.get("fresh")).toBeNull();
  });

  it("asks for the cached copy when re-opened from history", () => {
    expect(gapQueryParams("ws-1", SEARCH, {}, "stale").get("stale")).toBe("true");
  });

  it("can never produce a billed request, whatever the mode", () => {
    for (const mode of ["auto", "stale"] as const) {
      expect(gapQueryParams("ws-1", SEARCH, {}, mode).get("fresh")).toBeNull();
    }
  });

  it("bills only from the refresh builder, and never asks for both", () => {
    const params = gapFreshParams("ws-1", SEARCH, { minVolume: 100 });
    expect(params.get("fresh")).toBe("true");
    expect(params.get("stale")).toBeNull();
    // Still the same comparison, with the filters that were on screen.
    expect(params.get("competitors")).toBe("templatesbooth.com,hikelist.com");
    expect(params.get("minVolume")).toBe("100");
  });

  /**
   * One page, not every page the user had loaded: paging is one upstream call
   * per competitor *per page*, so re-buying five of them from one click would
   * be five times the bill anyone expected.
   */
  it("refreshes page one only", () => {
    const params = gapFreshParams("ws-1", SEARCH, {});
    expect(params.get("offset")).toBe("0");
    expect(params.get("limit")).toBe("50");
  });

  /** A CSV is a fresh server-side render, not a re-read of the screen. */
  it("keeps the export out of it", () => {
    expect(gapExportUrl("ws-1", SEARCH, {})).not.toContain("stale");
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
