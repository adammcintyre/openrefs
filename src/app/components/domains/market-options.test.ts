import { describe, expect, it } from "vitest";

import type { MetaLocationOption } from "../../../shared/keywords";
import {
  languageOptionsFor,
  locationOptions,
  marketLabel,
  resolveLanguage,
} from "./market-options";

const LOCATIONS: MetaLocationOption[] = [
  {
    code: 2826,
    name: "United Kingdom",
    countryIsoCode: "GB",
    languages: [{ code: "en", name: "English" }],
  },
  {
    code: 2276,
    name: "Germany",
    countryIsoCode: "DE",
    languages: [{ code: "de", name: "German" }],
  },
  {
    code: 2124,
    name: "Canada",
    countryIsoCode: "CA",
    languages: [
      { code: "en", name: "English" },
      { code: "fr", name: "French" },
    ],
  },
];

describe("locationOptions", () => {
  it("sorts alphabetically", () => {
    expect(locationOptions(LOCATIONS, 2826).map((o) => o.label)).toEqual([
      "Canada",
      "Germany",
      "United Kingdom",
    ]);
  });

  /*
   * A <select> whose value matches no option silently displays the first one,
   * which would misreport which market produced the numbers on screen.
   */
  it("keeps the current selection present even if the list lacks it", () => {
    const options = locationOptions(LOCATIONS, 9999);
    expect(options[0]).toEqual({ value: "9999", label: "Location 9999" });
  });

  it("survives an empty list while /meta/locations is still loading", () => {
    expect(locationOptions([], 2826)).toEqual([
      { value: "2826", label: "Location 2826" },
    ]);
  });
});

describe("languageOptionsFor", () => {
  it("offers only the languages the chosen market supports", () => {
    expect(
      languageOptionsFor(LOCATIONS, 2124, "en").map((option) => option.value),
    ).toEqual(["en", "fr"]);
    expect(
      languageOptionsFor(LOCATIONS, 2276, "de").map((option) => option.value),
    ).toEqual(["de"]);
  });

  it("names a language from the global list when the location omits one", () => {
    const locations: MetaLocationOption[] = [
      {
        code: 1,
        name: "Nowhere",
        countryIsoCode: "XX",
        languages: [{ code: "en", name: null }],
      },
    ];
    expect(
      languageOptionsFor(locations, 1, "en", new Map([["en", "English"]]))[0],
    ).toEqual({ value: "en", label: "English" });
  });

  it("keeps an unsupported current value visible rather than blanking the select", () => {
    expect(languageOptionsFor(LOCATIONS, 2276, "en")[0]?.value).toBe("en");
  });
});

describe("resolveLanguage", () => {
  /*
   * The rule this exists for: a Labs location accepts only its own languages.
   * Carrying "en" into Germany is an upstream error, not an empty result.
   */
  it("keeps the requested language when the market supports it", () => {
    expect(resolveLanguage(LOCATIONS, 2124, "fr")).toBe("fr");
    expect(resolveLanguage(LOCATIONS, 2826, "en")).toBe("en");
  });

  it("falls back to the market's primary language when it does not", () => {
    expect(resolveLanguage(LOCATIONS, 2276, "en")).toBe("de");
  });

  it("leaves the value alone when the market is unknown", () => {
    expect(resolveLanguage(LOCATIONS, 9999, "en")).toBe("en");
    expect(resolveLanguage([], 2276, "en")).toBe("en");
  });
});

describe("marketLabel", () => {
  it("names the market and the language", () => {
    expect(marketLabel(LOCATIONS, 2826, "en")).toBe("United Kingdom · en");
  });

  it("degrades to the raw code", () => {
    expect(marketLabel(LOCATIONS, 9999, "en")).toBe("Location 9999 · en");
  });
});
