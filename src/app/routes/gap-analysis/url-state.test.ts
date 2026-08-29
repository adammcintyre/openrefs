import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKET,
  gapSearchKey,
  gapSearchParams,
  isGapSearchable,
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
    });
    expect(params.get("mode")).toBeNull();
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
      }).toString(),
    ).toBe("");
  });

  it("normalises on the way out, not only on the way in", () => {
    const params = gapSearchParams({
      target: "  HTTPS://WWW.BrandPacks.com/  ",
      competitors: ["https://www.hikelist.com/trails", "hikelist.com"],
      location: 2826,
      language: "en",
      mode: "all",
    });
    expect(params.get("target")).toBe("brandpacks.com");
    // The duplicate collapses rather than buying the same column twice.
    expect(params.get("competitors")).toBe("hikelist.com");
    expect(params.get("mode")).toBe("all");
  });
});

describe("isGapSearchable", () => {
  const base = { location: 2826, language: "en", mode: "missing" } as const;

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
