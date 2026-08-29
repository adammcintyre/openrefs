import { describe, expect, it } from "vitest";

import { COUNTRY_BREAKDOWN_MARKETS, marketLanguage } from "./domains";

describe("COUNTRY_BREAKDOWN_MARKETS", () => {
  it("covers the ten markets the spec names", () => {
    expect(COUNTRY_BREAKDOWN_MARKETS.map((m) => m.countryIsoCode)).toEqual([
      "US", "GB", "DE", "FR", "ES", "IT", "AU", "CA", "NL", "IN",
    ]);
  });

  it("pins the codes verified against the live Labs locations list", () => {
    // Re-derived from `dataforseo_labs/locations_and_languages` on 2026-08-29.
    // If DataForSEO ever renumbers a market, this is the test that says so.
    expect(
      Object.fromEntries(
        COUNTRY_BREAKDOWN_MARKETS.map((m) => [m.countryIsoCode, m.locationCode]),
      ),
    ).toEqual({
      US: 2840, GB: 2826, DE: 2276, FR: 2250, ES: 2724,
      IT: 2380, AU: 2036, CA: 2124, NL: 2528, IN: 2356,
    });
  });

  it("gives every market at least one language to fall back to", () => {
    for (const market of COUNTRY_BREAKDOWN_MARKETS) {
      expect(market.languages.length, market.countryIsoCode).toBeGreaterThan(0);
    }
  });

  it("has no duplicate location codes", () => {
    const codes = COUNTRY_BREAKDOWN_MARKETS.map((m) => m.locationCode);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("marketLanguage", () => {
  const germany = COUNTRY_BREAKDOWN_MARKETS[2];
  const canada = COUNTRY_BREAKDOWN_MARKETS[7];

  it("uses the requested language when the market supports it", () => {
    expect(marketLanguage({ languages: ["en", "es"] }, "es")).toBe("es");
  });

  it("falls back to the market's own language when it does not", () => {
    // The bug this prevents: asking for all ten markets in English silently
    // fails Germany, France, Spain, Italy and the Netherlands, and an empty
    // row reads as "no presence here" rather than "we asked wrongly".
    expect(germany).toBeDefined();
    expect(marketLanguage(germany!, "en")).toBe("de");
    expect(marketLanguage({ languages: ["fr"] }, "en")).toBe("fr");
    expect(marketLanguage({ languages: ["nl"] }, "en")).toBe("nl");
  });

  it("prefers the requested language in a multilingual market", () => {
    expect(canada).toBeDefined();
    expect(marketLanguage(canada!, "fr")).toBe("fr");
    expect(marketLanguage(canada!, "en")).toBe("en");
  });

  it("is case-insensitive about the request", () => {
    expect(marketLanguage({ languages: ["de"] }, "DE")).toBe("de");
  });

  it("resolves every market to a language it actually supports", () => {
    for (const market of COUNTRY_BREAKDOWN_MARKETS) {
      const resolved = marketLanguage(market, "en");
      expect(
        market.languages.includes(resolved as never),
        `${market.countryIsoCode} resolved to unsupported ${resolved}`,
      ).toBe(true);
    }
  });
});
