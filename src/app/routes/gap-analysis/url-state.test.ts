import { describe, expect, it } from "vitest";

import { GAP_MAX_PAGES } from "../../../shared/gap";
import {
  DEFAULT_MARKET,
  gapPagesKey,
  gapSearchKey,
  gapSearchParams,
  isGapPagesSearchable,
  isGapSearchable,
  parsePageList,
  readGapSearch,
} from "./url-state";

const read = (query: string) => readGapSearch(new URLSearchParams(query));

describe("readGapSearch", () => {
  it("reads a whole comparison out of the URL", () => {
    const search = read(
      "target=brandpacks.com&competitors=templatesbooth.com,hikelist.com&location=2840&language=en&mode=weak",
    );
    expect(search).toEqual({
      target: "brandpacks.com",
      competitors: ["templatesbooth.com", "hikelist.com"],
      location: 2840,
      language: "en",
      mode: "weak",
      view: "keywords",
      pages: [],
    });
  });

  it("normalises pasted URLs on both sides", () => {
    const search = read(
      "target=https://www.BrandPacks.com/pricing&competitors=https://www.hikelist.com/",
    );
    expect(search.target).toBe("brandpacks.com");
    expect(search.competitors).toEqual(["hikelist.com"]);
  });

  it("falls back to the workspace market and the default mode", () => {
    const search = read("target=brandpacks.com&competitors=hikelist.com");
    expect(search.location).toBe(DEFAULT_MARKET.location);
    expect(search.language).toBe(DEFAULT_MARKET.language);
    expect(search.mode).toBe("missing");
  });

  it("prefers the caller's fallback market over the module default", () => {
    const search = readGapSearch(new URLSearchParams("target=brandpacks.com"), {
      location: 2840,
      language: "de",
    });
    expect(search.location).toBe(2840);
    expect(search.language).toBe("de");
  });

  /** A hand-edited URL must never strand the user on an unusable screen. */
  it("survives garbage in every field", () => {
    const search = read(
      "target=brandpacks.com&competitors=banana,hikelist.com&location=banana&language=%21%21&mode=sideways",
    );
    expect(search.competitors).toEqual(["hikelist.com"]);
    expect(search.location).toBe(DEFAULT_MARKET.location);
    expect(search.language).toBe(DEFAULT_MARKET.language);
    expect(search.mode).toBe("missing");
  });

  it("drops the target from its own competitor list", () => {
    const search = read(
      "target=brandpacks.com&competitors=brandpacks.com,hikelist.com",
    );
    expect(search.competitors).toEqual(["hikelist.com"]);
  });

  it("caps the competitor list at the ceiling", () => {
    const search = read(
      "target=brandpacks.com&competitors=a.com,b.com,c.com,d.com,e.com",
    );
    expect(search.competitors).toEqual(["a.com", "b.com", "c.com", "d.com"]);
  });

  it("is empty before anything is searched", () => {
    const search = read("");
    expect(search.target).toBe("");
    expect(search.competitors).toEqual([]);
  });
});

describe("gapSearchParams", () => {
  it("round-trips a search", () => {
    const search = read(
      "target=brandpacks.com&competitors=templatesbooth.com,hikelist.com&location=2840&language=en&mode=untapped",
    );
    expect(readGapSearch(gapSearchParams(search))).toEqual(search);
  });

  it("leaves the default mode implicit to keep the URL readable", () => {
    const params = gapSearchParams({
      target: "brandpacks.com",
      competitors: ["hikelist.com"],
      location: 2826,
      language: "en",
      mode: "missing",
      view: "keywords",
      pages: [],
    });
    expect(params.get("mode")).toBeNull();
    // The keyword view is the default too, so its URLs are unchanged by the
    // pages retrofit.
    expect(params.get("view")).toBeNull();
    expect(params.toString()).toBe(
      "target=brandpacks.com&competitors=hikelist.com&location=2826&language=en",
    );
  });

  it("writes nothing at all when there is nothing to describe", () => {
    expect(
      gapSearchParams({
        target: "",
        competitors: [],
        location: 2826,
        language: "en",
        mode: "missing",
        view: "keywords",
        pages: [],
      }).toString(),
    ).toBe("");
  });

  /*
   * The pages view has no target and no competitors, so the "nothing to
   * describe" early return has to count the page list too — otherwise a pages
   * comparison serialises to an empty URL and is lost on reload.
   */
  it("writes a pages comparison that has no target or competitors", () => {
    const params = gapSearchParams({
      target: "",
      competitors: [],
      location: 2826,
      language: "en",
      mode: "missing",
      view: "pages",
      pages: ["https://example.com/a", "https://rival.com/b"],
    });
    expect(params.get("pages")).toBe(
      "https://example.com/a,https://rival.com/b",
    );
    expect(params.get("view")).toBe("pages");
  });

  it("normalises on the way out, not only on the way in", () => {
    const params = gapSearchParams({
      target: "  HTTPS://WWW.BrandPacks.com/  ",
      competitors: ["https://www.hikelist.com/trails", "hikelist.com"],
      location: 2826,
      language: "en",
      mode: "all",
      view: "keywords",
      pages: [],
    });
    expect(params.get("target")).toBe("brandpacks.com");
    // The duplicate collapses rather than buying the same column twice.
    expect(params.get("competitors")).toBe("hikelist.com");
    expect(params.get("mode")).toBe("all");
  });
});

describe("isGapSearchable", () => {
  const base = {
    location: 2826,
    language: "en",
    mode: "missing" as const,
    view: "keywords" as const,
    pages: [] as string[],
  };

  it("needs a real domain and at least one competitor", () => {
    expect(
      isGapSearchable({ ...base, target: "brandpacks.com", competitors: ["a.com"] }),
    ).toBe(true);
  });

  it("refuses to spend without a competitor", () => {
    expect(
      isGapSearchable({ ...base, target: "brandpacks.com", competitors: [] }),
    ).toBe(false);
  });

  it("refuses a target that is not a domain", () => {
    expect(
      isGapSearchable({ ...base, target: "nonsense", competitors: ["a.com"] }),
    ).toBe(false);
    expect(isGapSearchable({ ...base, target: "", competitors: ["a.com"] })).toBe(
      false,
    );
  });
});

describe("parsePageList", () => {
  it("accepts newline- or comma-separated URLs", () => {
    expect(parsePageList("https://a.com/x\nhttps://b.com/y")).toEqual([
      "https://a.com/x",
      "https://b.com/y",
    ]);
    expect(parsePageList("https://a.com/x, https://b.com/y")).toEqual([
      "https://a.com/x",
      "https://b.com/y",
    ]);
  });

  /*
   * These strings become hrefs in the table's column headers. They came from
   * the user's own paste box rather than a scrape, but they reach the attribute
   * the same way — and `page_intersection` has nothing to say about them either.
   */
  it("drops anything that is not http(s)", () => {
    expect(parsePageList("javascript:alert(1)")).toEqual([]);
    expect(parsePageList("data:text/html,x")).toEqual([]);
    expect(parsePageList("example.com/no-scheme")).toEqual([]);
  });

  it("ignores blank lines and stray whitespace", () => {
    expect(parsePageList("\n  https://a.com/x  \n\n")).toEqual([
      "https://a.com/x",
    ]);
  });

  it("collapses duplicates rather than buying the same column twice", () => {
    expect(parsePageList("https://a.com/x\nhttps://a.com/x")).toEqual([
      "https://a.com/x",
    ]);
  });

  it("caps at the API's own ceiling instead of being refused upstream", () => {
    const many = Array.from(
      { length: GAP_MAX_PAGES + 5 },
      (_, i) => `https://a.com/${i}`,
    ).join("\n");
    expect(parsePageList(many)).toHaveLength(GAP_MAX_PAGES);
  });

  /*
   * Unlike a domain, a page URL is NOT normalised: page_intersection compares
   * exact addresses, so stripping a trailing slash or a query string would
   * quietly compare a different page from the one that was pasted.
   */
  it("preserves the exact address, query string and all", () => {
    expect(parsePageList("https://a.com/x?p=12")).toEqual([
      "https://a.com/x?p=12",
    ]);
  });
});

describe("readGapSearch — the pages view", () => {
  it("defaults to the keyword view", () => {
    expect(read("target=a.com").view).toBe("keywords");
    expect(read("target=a.com&view=nonsense").view).toBe("keywords");
  });

  it("reads the view and its page list", () => {
    const search = read("view=pages&pages=https://a.com/x,https://b.com/y");
    expect(search.view).toBe("pages");
    expect(search.pages).toEqual(["https://a.com/x", "https://b.com/y"]);
  });

  it("round-trips a pages comparison", () => {
    const search = read(
      "view=pages&pages=https://a.com/x,https://b.com/y&location=2840&language=en",
    );
    expect(readGapSearch(gapSearchParams(search))).toEqual(search);
  });
});

describe("isGapPagesSearchable", () => {
  const base = {
    target: "",
    competitors: [] as string[],
    location: 2826,
    language: "en",
    mode: "missing" as const,
    view: "pages" as const,
  };

  it("needs at least one URL", () => {
    expect(isGapPagesSearchable({ ...base, pages: [] })).toBe(false);
  });

  /*
   * One page is a legitimate question — "what does this page rank for?" — and
   * the API accepts it, so it is not refused. The screen explains what the view
   * is for instead.
   */
  it("accepts a single page rather than insisting on a comparison", () => {
    expect(isGapPagesSearchable({ ...base, pages: ["https://a.com/x"] })).toBe(
      true,
    );
  });
});

describe("gapPagesKey", () => {
  const base = {
    target: "brandpacks.com",
    competitors: ["a.com"],
    location: 2826,
    language: "en",
    mode: "missing" as const,
    view: "pages" as const,
    pages: ["https://a.com/x"],
  };

  /*
   * The two views share a market and nothing else. Changing the keyword
   * comparison must not read as a changed pages comparison, or switching tabs
   * would refetch the other view for no reason.
   */
  it("ignores the keyword view's target and competitors", () => {
    expect(
      gapPagesKey({ ...base, target: "other.com", competitors: ["z.com"] }),
    ).toBe(gapPagesKey(base));
  });

  it("changes with the page list and with the market", () => {
    expect(gapPagesKey({ ...base, pages: ["https://b.com/y"] })).not.toBe(
      gapPagesKey(base),
    );
    expect(gapPagesKey({ ...base, location: 2840 })).not.toBe(
      gapPagesKey(base),
    );
  });
});

describe("gapSearchKey", () => {
  it("changes with the competitor set", () => {
    const one = read("target=brandpacks.com&competitors=a.com");
    const two = read("target=brandpacks.com&competitors=a.com,b.com");
    expect(gapSearchKey(one)).not.toBe(gapSearchKey(two));
  });

  /** Switching tabs filters rows already paid for — it is not a new search. */
  it("ignores the mode", () => {
    const missing = read("target=brandpacks.com&competitors=a.com&mode=missing");
    const weak = read("target=brandpacks.com&competitors=a.com&mode=weak");
    expect(gapSearchKey(missing)).toBe(gapSearchKey(weak));
  });
});
