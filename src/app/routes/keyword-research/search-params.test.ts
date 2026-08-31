import { describe, expect, it } from "vitest";

import { DEFAULT_MARKET } from "../../components/keywords/market";
import {
  DEFAULT_TAB,
  KEYWORD_TABS,
  TAB_LABELS,
  buildSearchParams,
  buildSearchString,
  parseSearchParams,
} from "./search-params";
import type { KeywordSearchState } from "./search-params";

const state = (patch: Partial<KeywordSearchState> = {}): KeywordSearchState => ({
  keyword: "seo tools",
  locationCode: 2826,
  languageCode: "en",
  tab: "suggestions",
  ...patch,
});

/*
 * Phase 9 feedback: Ideas returns the seed's *category*, not the seed, so it
 * led with the loosest of the three lists. The order and the single label
 * source are the whole change, so they are pinned here rather than left
 * implicit in the parser tests below.
 */
describe("tab order", () => {
  it("leads with Suggestions and trails with Ideas", () => {
    expect(KEYWORD_TABS).toEqual(["suggestions", "related", "ideas"]);
  });

  it("defaults to the first tab", () => {
    expect(DEFAULT_TAB).toBe("suggestions");
    expect(KEYWORD_TABS[0]).toBe(DEFAULT_TAB);
  });

  it("labels every tab, and only the tabs", () => {
    expect(Object.keys(TAB_LABELS).sort()).toEqual([...KEYWORD_TABS].sort());
    expect(TAB_LABELS.ideas).toBe("Ideas");
    expect(TAB_LABELS.suggestions).toBe("Suggestions");
    expect(TAB_LABELS.related).toBe("Related");
  });
});

describe("parseSearchParams", () => {
  it("reads a fully specified URL", () => {
    const params = new URLSearchParams(
      "q=seo%20tools&location=2840&language=en&tab=related",
    );
    expect(parseSearchParams(params)).toEqual({
      keyword: "seo tools",
      locationCode: 2840,
      languageCode: "en",
      tab: "related",
    });
  });

  it("falls back to the caller's market when the URL omits it", () => {
    const fallback = { locationCode: 2276, languageCode: "de" };
    expect(parseSearchParams(new URLSearchParams("q=schuhe"), fallback)).toEqual({
      keyword: "schuhe",
      locationCode: 2276,
      languageCode: "de",
      tab: "suggestions",
    });
  });

  it("defaults to an empty keyword and the UK/en market", () => {
    expect(parseSearchParams(new URLSearchParams(""))).toEqual({
      keyword: "",
      locationCode: DEFAULT_MARKET.locationCode,
      languageCode: DEFAULT_MARKET.languageCode,
      tab: "suggestions",
    });
  });

  it("trims the keyword", () => {
    expect(parseSearchParams(new URLSearchParams("q=%20%20padded%20%20")).keyword)
      .toBe("padded");
  });

  /*
   * The guard that matters: a junk location must not reach a paid endpoint.
   * "2826abc" is the specific trap — parseInt() would have accepted it as 2826
   * and silently queried a market the user never asked for.
   */
  it.each([
    ["location=abc", "not a number"],
    ["location=2826abc", "trailing junk"],
    ["location=-5", "negative"],
    ["location=0", "zero"],
    ["location=12.5", "not an integer"],
    ["location=", "empty"],
  ])("rejects %s (%s) and uses the fallback", (query) => {
    expect(parseSearchParams(new URLSearchParams(query)).locationCode).toBe(
      DEFAULT_MARKET.locationCode,
    );
  });

  it.each([
    ["language=e", "too short"],
    ["language=englishlang", "too long"],
    ["language=en_GB", "underscore is not allowed"],
    ["language=12", "digits are not a language code"],
  ])("rejects %s (%s) and uses the fallback", (query) => {
    expect(parseSearchParams(new URLSearchParams(query)).languageCode).toBe(
      DEFAULT_MARKET.languageCode,
    );
  });

  it("accepts a region-suffixed language", () => {
    expect(parseSearchParams(new URLSearchParams("language=pt-BR")).languageCode)
      .toBe("pt-BR");
  });

  it("falls back to the default tab for an unknown tab", () => {
    expect(parseSearchParams(new URLSearchParams("tab=backlinks")).tab).toBe(
      "suggestions",
    );
  });
});

describe("buildSearchParams", () => {
  it("writes the market alongside the keyword", () => {
    expect(buildSearchParams(state()).toString()).toBe(
      "q=seo+tools&location=2826&language=en",
    );
  });

  it("omits the default tab and keeps a non-default one", () => {
    expect(buildSearchParams(state()).has("tab")).toBe(false);
    expect(buildSearchParams(state({ tab: "ideas" })).get("tab")).toBe("ideas");
  });

  // A URL with no search in it should be the bare route, not `?q=`.
  it("produces empty params for an empty keyword", () => {
    expect(buildSearchParams(state({ keyword: "   " })).toString()).toBe("");
    expect(buildSearchString(state({ keyword: "" }))).toBe("");
  });

  it("prefixes a non-empty query string with ?", () => {
    expect(buildSearchString(state())).toBe(
      "?q=seo+tools&location=2826&language=en",
    );
  });
});

describe("round trip", () => {
  it.each([
    state(),
    state({ tab: "related", locationCode: 2840 }),
    state({ keyword: "café & crème", languageCode: "fr", locationCode: 2250 }),
    state({ keyword: "a+b=c?d#e", tab: "ideas" }),
  ])("survives build -> parse unchanged (%#)", (original) => {
    expect(parseSearchParams(buildSearchParams(original))).toEqual(original);
  });
});
