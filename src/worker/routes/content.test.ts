/**
 * Content Discovery's composition arithmetic.
 *
 * The paid fan-out is not tested here — it is four wrappers this repo already
 * tests. What is worth pinning is everything that happens *after* the money is
 * spent, because those are the parts a user can turn a knob on and get a wrong
 * answer from: how pages are deduplicated across SERPs, how the filters treat
 * a missing value, and that sorting stays stable so paging over a cached set
 * does not shuffle rows between requests.
 */
import { describe, expect, it } from "vitest";

import type { ContentPageRow } from "../../shared/content";
import { normalizeContentUrl } from "../../shared/content";
import { batch, filterContentRows, mergeSerpPages, sortContentRows } from "./content";

/** A SERP item, trimmed to what the merge reads. */
function item(
  url: string,
  position: number,
  extra: { domain?: string; title?: string | null } = {},
) {
  return {
    url,
    position,
    domain: extra.domain ?? new URL(url).hostname.replace(/^www\./, ""),
    title: extra.title === undefined ? `Title for ${url}` : extra.title,
  };
}

/** A row, defaulted to the boring case so a test states only what it varies. */
function row(overrides: Partial<ContentPageRow> = {}): ContentPageRow {
  return {
    url: "https://example.com/a",
    domain: "example.com",
    title: null,
    domainScore: 20,
    pageScore: null,
    estTraffic: 1000,
    keywords: [],
    totalVolume: 500,
    bestPosition: 3,
    wordCount: null,
    ...overrides,
  };
}

describe("normalizeContentUrl", () => {
  it("collapses the three spellings of one page", () => {
    const canonical = "https://example.com/blog/post";
    expect(normalizeContentUrl("https://example.com/blog/post")).toBe(canonical);
    expect(normalizeContentUrl("https://example.com/blog/post/")).toBe(canonical);
    expect(normalizeContentUrl("https://example.com/blog/post#intro")).toBe(
      canonical,
    );
  });

  it("keeps the root slash, which is the path there", () => {
    expect(normalizeContentUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("keeps a query — ?p=12 really can be a different article", () => {
    expect(normalizeContentUrl("https://example.com/x?p=12")).not.toBe(
      normalizeContentUrl("https://example.com/x?p=13"),
    );
  });

  it("strips the click-tracking parameters Google appends to results", () => {
    // Observed live: photoboothtemplates.com arrived twice under two srsltid
    // values and took two of seven low-authority slots in one table.
    expect(
      normalizeContentUrl("https://example.com/x?srsltid=AfmBOopABC"),
    ).toBe(normalizeContentUrl("https://example.com/x?srsltid=AfmBOopXYZ"));
    expect(normalizeContentUrl("https://example.com/x?gclid=abc")).toBe(
      "https://example.com/x",
    );
    expect(
      normalizeContentUrl("https://example.com/x?utm_source=a&utm_medium=b"),
    ).toBe("https://example.com/x");
  });

  it("leaves no bare ? behind when the query was all tracking", () => {
    // Otherwise "…/x?" and "…/x" survive as two spellings of one page, which
    // is the bug this normaliser exists to prevent.
    expect(normalizeContentUrl("https://example.com/x?fbclid=1")).toBe(
      normalizeContentUrl("https://example.com/x"),
    );
  });

  it("keeps a real parameter alongside a stripped one", () => {
    expect(normalizeContentUrl("https://example.com/x?p=12&gclid=abc")).toBe(
      "https://example.com/x?p=12",
    );
  });

  it("keeps path case, because servers may distinguish it", () => {
    expect(normalizeContentUrl("https://example.com/About")).not.toBe(
      normalizeContentUrl("https://example.com/about"),
    );
  });

  it("keeps www — it is part of the host the SERP reported", () => {
    expect(normalizeContentUrl("https://www.example.com/a")).not.toBe(
      normalizeContentUrl("https://example.com/a"),
    );
  });

  it("returns an unparseable string as itself, not as a collision", () => {
    expect(normalizeContentUrl("  not a url  ")).toBe("not a url");
    expect(normalizeContentUrl("not a url")).not.toBe(
      normalizeContentUrl("also not a url"),
    );
  });
});

describe("mergeSerpPages", () => {
  it("makes one row per page carrying every keyword it ranked for", () => {
    // The entire point of expanding a topic: a page found on three keywords is
    // one opportunity, not three rows.
    const pages = mergeSerpPages([
      {
        keyword: "photo booth template",
        volume: 1000,
        items: [item("https://a.com/one", 1), item("https://b.com/two", 2)],
      },
      {
        keyword: "photo booth backdrop",
        volume: 500,
        items: [item("https://a.com/one", 4)],
      },
    ]);

    expect(pages).toHaveLength(2);
    const first = pages.find((page) => page.url === "https://a.com/one");
    expect(first?.keywords).toEqual([
      { keyword: "photo booth template", position: 1, volume: 1000 },
      { keyword: "photo booth backdrop", position: 4, volume: 500 },
    ]);
  });

  it("deduplicates across SERPs through the URL normaliser", () => {
    const pages = mergeSerpPages([
      { keyword: "a", volume: 10, items: [item("https://a.com/x", 1)] },
      { keyword: "b", volume: 10, items: [item("https://a.com/x/", 2)] },
      { keyword: "c", volume: 10, items: [item("https://a.com/x#top", 3)] },
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.keywords).toHaveLength(3);
  });

  it("counts a keyword once per page, keeping the better position", () => {
    // A page can appear twice on one SERP. Recording it twice would double its
    // volume and make `totalVolume` a number nothing in the world matches.
    const pages = mergeSerpPages([
      {
        keyword: "a",
        volume: 900,
        items: [item("https://a.com/x", 7), item("https://a.com/x", 2)],
      },
    ]);
    expect(pages[0]?.keywords).toEqual([
      { keyword: "a", position: 2, volume: 900 },
    ]);
  });

  it("skips items with no URL or no rank", () => {
    const pages = mergeSerpPages([
      {
        keyword: "a",
        volume: 10,
        items: [
          { url: null, domain: "a.com", title: null, position: 1 },
          { url: "https://a.com/y", domain: "a.com", title: null, position: null },
          item("https://a.com/z", 1),
        ],
      },
    ]);
    expect(pages.map((page) => page.url)).toEqual(["https://a.com/z"]);
  });

  it("keeps the first title it sees, so a rebuild is stable", () => {
    const pages = mergeSerpPages([
      { keyword: "a", volume: 1, items: [item("https://a.com/x", 1, { title: null })] },
      { keyword: "b", volume: 1, items: [item("https://a.com/x", 1, { title: "Real" })] },
      { keyword: "c", volume: 1, items: [item("https://a.com/x", 1, { title: "Other" })] },
    ]);
    expect(pages[0]?.title).toBe("Real");
  });
});

describe("filterContentRows", () => {
  it("keeps an unknown Domain Score under a cap", () => {
    // The judgement call that decides whether this feature works: unknown
    // authority is not high authority. A site DataForSEO has never crawled is
    // usually a small one — exactly what someone capping the score wants.
    const rows = [row({ domainScore: null }), row({ domainScore: 80 })];
    const kept = filterContentRows(rows, { maxDomainScore: 30 });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.domainScore).toBeNull();
  });

  it("drops an unknown traffic estimate under a floor", () => {
    // The opposite call, for the opposite reason: "at least 500 visits" is a
    // claim an unknown page cannot be said to meet.
    const rows = [row({ estTraffic: null }), row({ estTraffic: 900 })];
    const kept = filterContentRows(rows, { minTraffic: 500 });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.estTraffic).toBe(900);
  });

  it("applies the cap and the floor inclusively at the boundary", () => {
    expect(
      filterContentRows([row({ domainScore: 30 })], { maxDomainScore: 30 }),
    ).toHaveLength(1);
    expect(
      filterContentRows([row({ estTraffic: 500 })], { minTraffic: 500 }),
    ).toHaveLength(1);
  });

  it("matches include/exclude case-insensitively against the URL", () => {
    const rows = [
      row({ url: "https://example.com/Blog/Post" }),
      row({ url: "https://example.com/shop/item" }),
    ];
    expect(filterContentRows(rows, { include: "blog" })).toHaveLength(1);
    expect(filterContentRows(rows, { exclude: "BLOG" })).toHaveLength(1);
    // Both together, which is how the filter row is actually used.
    expect(
      filterContentRows(rows, { include: "example.com", exclude: "shop" }),
    ).toHaveLength(1);
  });

  it("returns everything when nothing is asked for", () => {
    const rows = [row(), row({ url: "https://b.com/x" })];
    expect(filterContentRows(rows, {})).toHaveLength(2);
  });

  it("supports the low-competition preset end to end", () => {
    const rows = [
      row({ url: "https://small.com/a", domainScore: 12, estTraffic: 2400 }),
      row({ url: "https://big.com/a", domainScore: 78, estTraffic: 90000 }),
      row({ url: "https://quiet.com/a", domainScore: 9, estTraffic: 20 }),
    ];
    const kept = filterContentRows(rows, { maxDomainScore: 30, minTraffic: 500 });
    expect(kept.map((r) => r.url)).toEqual(["https://small.com/a"]);
  });
});

describe("sortContentRows", () => {
  it("orders descending and floats unknowns to the bottom", () => {
    // A page with no estimate is not a zero-traffic page; putting nulls first
    // in a "most traffic" table would bury the answer.
    const rows = [
      row({ url: "https://a.com/1", estTraffic: null }),
      row({ url: "https://b.com/2", estTraffic: 100 }),
      row({ url: "https://c.com/3", estTraffic: 5000 }),
    ];
    expect(sortContentRows(rows, "estTraffic").map((r) => r.estTraffic)).toEqual([
      5000, 100, null,
    ]);
  });

  it("is stable across repeated calls over one cached set", () => {
    // Paging reads the same cached composition each time, so equal values must
    // break the same way or row 50 differs between page 1 and page 2.
    const rows = [
      row({ url: "https://c.com/x", estTraffic: 100 }),
      row({ url: "https://a.com/x", estTraffic: 100 }),
      row({ url: "https://b.com/x", estTraffic: 100 }),
    ];
    const once = sortContentRows(rows, "estTraffic").map((r) => r.url);
    const again = sortContentRows(rows, "estTraffic").map((r) => r.url);
    expect(once).toEqual(again);
    expect(once).toEqual([
      "https://a.com/x",
      "https://b.com/x",
      "https://c.com/x",
    ]);
  });

  it("sorts on each supported column", () => {
    const rows = [
      row({ url: "https://a.com/x", domainScore: 10, totalVolume: 100 }),
      row({ url: "https://b.com/x", domainScore: 90, totalVolume: 900 }),
    ];
    expect(sortContentRows(rows, "domainScore")[0]?.domainScore).toBe(90);
    expect(sortContentRows(rows, "totalVolume")[0]?.totalVolume).toBe(900);
  });

  it("does not mutate the cached set it is given", () => {
    // The rows come straight out of KV and are reused for `totalCount` and
    // `filteredOut`; sorting in place would reorder the cached composition.
    const rows = [
      row({ url: "https://a.com/x", estTraffic: 1 }),
      row({ url: "https://b.com/x", estTraffic: 2 }),
    ];
    sortContentRows(rows, "estTraffic");
    expect(rows.map((r) => r.estTraffic)).toEqual([1, 2]);
  });
});

describe("batch", () => {
  it("splits at the ceiling and keeps the remainder", () => {
    expect(batch([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one batch when everything fits — the normal case", () => {
    expect(batch([1, 2, 3], 1000)).toEqual([[1, 2, 3]]);
  });

  it("returns nothing for nothing, so no empty call is ever made", () => {
    expect(batch([], 100)).toEqual([]);
  });
});
