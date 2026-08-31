import { describe, expect, it } from "vitest";

import { PAGE_SIZE, discoverQueryParams, nextContentOffset } from "./queries";

const page = (patch: Partial<Parameters<typeof nextContentOffset>[0]> = {}) => ({
  items: Array.from({ length: PAGE_SIZE }, (_, i) => i),
  offset: 0,
  limit: PAGE_SIZE,
  totalCount: 500,
  filteredOut: 0,
  ...patch,
});

describe("nextContentOffset", () => {
  it("advances by the rows it received", () => {
    expect(nextContentOffset(page())).toBe(PAGE_SIZE);
    expect(nextContentOffset(page({ offset: PAGE_SIZE }))).toBe(PAGE_SIZE * 2);
  });

  it("stops on an empty page", () => {
    expect(nextContentOffset(page({ items: [] }))).toBeUndefined();
  });

  it("stops on a short page, whatever the counts claim", () => {
    expect(nextContentOffset(page({ items: [1, 2, 3] }))).toBeUndefined();
  });

  /*
   * Paging runs over the *filtered* set. `totalCount` counts the composition
   * before any filter, so using it alone would keep "Load more" alive long
   * after the last matching row had been shown — every press returning nothing.
   */
  it("stops at the end of the filtered set, not the composed one", () => {
    expect(
      nextContentOffset(
        page({ offset: 50, totalCount: 500, filteredOut: 400 }),
      ),
    ).toBeUndefined();
  });

  it("keeps going while filtered rows remain", () => {
    expect(
      nextContentOffset(page({ offset: 0, totalCount: 500, filteredOut: 300 })),
    ).toBe(PAGE_SIZE);
  });

  it("survives filters removing everything", () => {
    expect(
      nextContentOffset(page({ items: [], totalCount: 500, filteredOut: 500 })),
    ).toBeUndefined();
  });
});

describe("discoverQueryParams", () => {
  const search = {
    topic: "  photo booth template  ",
    location: 2826,
    language: "en",
    expand: 5 as const,
    sort: "estTraffic" as const,
    filters: { maxDomainScore: 30, minTraffic: 500 },
  };

  it("sends the trimmed topic and the whole market", () => {
    const params = discoverQueryParams("ws-1", search);
    expect(params.get("topic")).toBe("photo booth template");
    expect(params.get("location")).toBe("2826");
    expect(params.get("language")).toBe("en");
    expect(params.get("expand")).toBe("5");
    expect(params.get("workspace")).toBe("ws-1");
  });

  it("flattens the filters into query params", () => {
    const params = discoverQueryParams("ws-1", search);
    expect(params.get("maxDomainScore")).toBe("30");
    expect(params.get("minTraffic")).toBe("500");
  });

  it("omits filters that are not set", () => {
    const params = discoverQueryParams("ws-1", { ...search, filters: {} });
    expect(params.get("maxDomainScore")).toBeNull();
    expect(params.get("minTraffic")).toBeNull();
  });

  /*
   * maxDomainScore=0 is a real query ("only unmeasured sites"), so it has to
   * survive the loop that skips empty values.
   */
  it("keeps a zero cap, which is a filter and not an absence", () => {
    const params = discoverQueryParams("ws-1", {
      ...search,
      filters: { maxDomainScore: 0 },
    });
    expect(params.get("maxDomainScore")).toBe("0");
  });

  it("tolerates a missing workspace without throwing", () => {
    expect(discoverQueryParams(null, search).get("workspace")).toBe("");
  });
});
