import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKET,
  domainSearchParams,
  isSearchable,
  readDomainSearch,
  searchKey,
} from "./url-state";

const OTHER_MARKET = { location: 2840, language: "es" };

describe("readDomainSearch", () => {
  it("reads a full search", () => {
    expect(
      readDomainSearch(
        new URLSearchParams(
          "target=brandpacks.com&location=2840&language=en&tab=pages",
        ),
      ),
    ).toEqual({
      target: "brandpacks.com",
      location: 2840,
      language: "en",
      tab: "pages",
    });
  });

  it("normalises a pasted URL in the target", () => {
    const search = readDomainSearch(
      new URLSearchParams("target=https%3A%2F%2Fwww.BrandPacks.com%2Fshop"),
    );
    expect(search.target).toBe("brandpacks.com");
  });

  it("falls back to the workspace's last market when the URL says nothing", () => {
    expect(readDomainSearch(new URLSearchParams(), OTHER_MARKET)).toEqual({
      target: "",
      location: 2840,
      language: "es",
      tab: "keywords",
    });
  });

  it("defaults to UK / en with no fallback supplied", () => {
    const search = readDomainSearch(new URLSearchParams());
    expect(search.location).toBe(DEFAULT_MARKET.location);
    expect(search.location).toBe(2826);
    expect(search.language).toBe("en");
  });

  /*
   * A hand-edited URL must never be able to strand the page: every bad value
   * resolves to a usable one instead of an error state.
   */
  it("ignores a junk location code", () => {
    expect(readDomainSearch(new URLSearchParams("location=banana")).location).toBe(
      2826,
    );
    expect(readDomainSearch(new URLSearchParams("location=-5")).location).toBe(
      2826,
    );
    expect(readDomainSearch(new URLSearchParams("location=2.5")).location).toBe(
      2826,
    );
  });

  it("ignores a junk language and lowercases a valid one", () => {
    expect(readDomainSearch(new URLSearchParams("language=EN")).language).toBe(
      "en",
    );
    expect(
      readDomainSearch(new URLSearchParams("language=not-a-language-code-at-all"))
        .language,
    ).toBe("en");
    expect(readDomainSearch(new URLSearchParams("language=%20")).language).toBe(
      "en",
    );
  });

  it("falls back to the first tab for an unknown one", () => {
    expect(readDomainSearch(new URLSearchParams("tab=nope")).tab).toBe(
      "keywords",
    );
    expect(readDomainSearch(new URLSearchParams("tab=countries")).tab).toBe(
      "countries",
    );
  });
});

describe("domainSearchParams", () => {
  it("writes nothing when there is no target to describe", () => {
    expect(
      domainSearchParams({
        target: "",
        location: 2840,
        language: "en",
        tab: "pages",
      }).toString(),
    ).toBe("");
  });

  it("leaves the default tab implicit", () => {
    expect(
      domainSearchParams({
        target: "brandpacks.com",
        location: 2826,
        language: "en",
        tab: "keywords",
      }).toString(),
    ).toBe("target=brandpacks.com&location=2826&language=en");
  });

  it("writes a non-default tab", () => {
    const params = domainSearchParams({
      target: "brandpacks.com",
      location: 2826,
      language: "en",
      tab: "competitors",
    });
    expect(params.get("tab")).toBe("competitors");
  });

  it("normalises the target on the way out too", () => {
    const params = domainSearchParams({
      target: "https://www.BrandPacks.com/shop",
      location: 2826,
      language: "en",
      tab: "keywords",
    });
    expect(params.get("target")).toBe("brandpacks.com");
  });

  it("round-trips", () => {
    const search = {
      target: "brandpacks.com",
      location: 2840,
      language: "es",
      tab: "countries",
    } as const;
    expect(readDomainSearch(domainSearchParams(search))).toEqual(search);
  });
});

describe("isSearchable", () => {
  it("is false until there is a plausible hostname", () => {
    const base = { location: 2826, language: "en", tab: "keywords" } as const;
    expect(isSearchable({ ...base, target: "" })).toBe(false);
    expect(isSearchable({ ...base, target: "nonsense" })).toBe(false);
    expect(isSearchable({ ...base, target: "brandpacks.com" })).toBe(true);
  });
});

describe("searchKey", () => {
  const base = { target: "brandpacks.com", location: 2826, language: "en" };

  it("changes with the domain or the market", () => {
    expect(searchKey({ ...base, tab: "keywords" })).not.toBe(
      searchKey({ ...base, location: 2840, tab: "keywords" }),
    );
    expect(searchKey({ ...base, tab: "keywords" })).not.toBe(
      searchKey({ ...base, target: "example.com", tab: "keywords" }),
    );
  });

  // The country breakdown's cost consent is keyed on this: switching tabs must
  // not look like a new search and re-trigger ten paid calls.
  it("does not change with the tab", () => {
    expect(searchKey({ ...base, tab: "keywords" })).toBe(
      searchKey({ ...base, tab: "countries" }),
    );
  });
});
