import { describe, expect, it } from "vitest";

import { CONTENT_PRESET_LOW_COMPETITION } from "../../../shared/content";
import {
  DEFAULT_EXPAND,
  DEFAULT_MARKET,
  DEFAULT_SORT,
  contentSearchKey,
  contentSearchParams,
  isContentSearchable,
  readContentSearch,
} from "./url-state";

const base = {
  topic: "photo booth template",
  location: 2826,
  language: "en",
  expand: 5 as const,
  sort: "estTraffic" as const,
  filters: {},
};

describe("readContentSearch", () => {
  it("falls back to the workspace market when the URL carries none", () => {
    const search = readContentSearch(new URLSearchParams("topic=x"), {
      location: 2840,
      language: "es",
    });
    expect(search.location).toBe(2840);
    expect(search.language).toBe("es");
  });

  it("defaults to the UK when there is no fallback either", () => {
    const search = readContentSearch(new URLSearchParams("topic=x"));
    expect(search.location).toBe(DEFAULT_MARKET.location);
    expect(search.language).toBe(DEFAULT_MARKET.language);
  });

  it("trims the topic", () => {
    expect(readContentSearch(new URLSearchParams("topic=%20cats%20")).topic).toBe(
      "cats",
    );
  });

  /*
   * A hand-edited expansion is a typo, and the dearest legal sweep is eleven
   * live SERPs. Clamping "50" up to 10 would spend real money on a guess, so it
   * falls back to the free-est option instead.
   */
  it("falls back rather than clamping an out-of-range expansion", () => {
    expect(
      readContentSearch(new URLSearchParams("topic=x&expand=50")).expand,
    ).toBe(DEFAULT_EXPAND);
    expect(
      readContentSearch(new URLSearchParams("topic=x&expand=7")).expand,
    ).toBe(DEFAULT_EXPAND);
  });

  it("accepts the expansions the UI offers", () => {
    expect(readContentSearch(new URLSearchParams("topic=x&expand=10")).expand).toBe(
      10,
    );
  });

  it("falls back on an unknown sort", () => {
    expect(readContentSearch(new URLSearchParams("topic=x&sort=cost")).sort).toBe(
      DEFAULT_SORT,
    );
    expect(
      readContentSearch(new URLSearchParams("topic=x&sort=domainScore")).sort,
    ).toBe("domainScore");
  });

  it("rejects a malformed language rather than sending it upstream", () => {
    expect(
      readContentSearch(new URLSearchParams("topic=x&language=english!")).language,
    ).toBe(DEFAULT_MARKET.language);
  });

  it("reads the filters out of the query string", () => {
    const search = readContentSearch(
      new URLSearchParams("topic=x&maxDomainScore=30&minTraffic=500"),
    );
    expect(search.filters).toEqual(CONTENT_PRESET_LOW_COMPETITION);
  });
});

describe("contentSearchParams", () => {
  it("writes nothing at all before a topic has been searched", () => {
    expect(contentSearchParams({ ...base, topic: "" }).toString()).toBe("");
  });

  it("leaves the defaults implicit so the common URL stays short", () => {
    const params = contentSearchParams({
      ...base,
      expand: DEFAULT_EXPAND,
      sort: DEFAULT_SORT,
    });
    expect(params.get("expand")).toBeNull();
    expect(params.get("sort")).toBeNull();
    expect(params.get("topic")).toBe("photo booth template");
  });

  it("writes non-default expansion and sort", () => {
    const params = contentSearchParams({ ...base, sort: "totalVolume" });
    expect(params.get("expand")).toBe("5");
    expect(params.get("sort")).toBe("totalVolume");
  });

  it("round-trips a fully specified search", () => {
    const search = {
      ...base,
      sort: "domainScore" as const,
      filters: { maxDomainScore: 30, minTraffic: 500, exclude: "pinterest" },
    };
    expect(readContentSearch(contentSearchParams(search))).toEqual(search);
  });
});

describe("isContentSearchable", () => {
  it("needs a topic and nothing else", () => {
    expect(isContentSearchable({ ...base, topic: "" })).toBe(false);
    expect(isContentSearchable({ ...base, topic: "   " })).toBe(false);
    expect(isContentSearchable(base)).toBe(true);
  });
});

describe("contentSearchKey", () => {
  /*
   * The key identifies a *composition* — what was actually bought. Filters and
   * sort are views over rows already paid for, so narrowing the table must not
   * read as a new search and must not clear a selection.
   */
  it("ignores filters and sort", () => {
    expect(
      contentSearchKey({
        ...base,
        sort: "domainScore",
        filters: { maxDomainScore: 30 },
      }),
    ).toBe(contentSearchKey(base));
  });

  it("changes with the expansion, which is a different purchase", () => {
    expect(contentSearchKey({ ...base, expand: 10 })).not.toBe(
      contentSearchKey(base),
    );
  });

  it("changes with the market", () => {
    expect(contentSearchKey({ ...base, location: 2840 })).not.toBe(
      contentSearchKey(base),
    );
  });

  it("is case-insensitive on the topic, as the Worker's cache key is", () => {
    expect(contentSearchKey({ ...base, topic: "Photo Booth Template" })).toBe(
      contentSearchKey(base),
    );
  });
});
