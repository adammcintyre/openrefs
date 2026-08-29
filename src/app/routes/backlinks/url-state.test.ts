import { describe, expect, it } from "vitest";

import {
  backlinksSearchParams,
  isSearchable,
  readBacklinksSearch,
} from "./url-state";

describe("readBacklinksSearch", () => {
  it("reads a full report", () => {
    expect(
      readBacklinksSearch(
        new URLSearchParams(
          "target=brandpacks.com&tab=anchors&mode=as_is&range=6m",
        ),
      ),
    ).toEqual({
      target: "brandpacks.com",
      tab: "anchors",
      mode: "as_is",
      range: "6m",
    });
  });

  it("defaults to the grouped backlinks tab over a year", () => {
    expect(readBacklinksSearch(new URLSearchParams())).toEqual({
      target: "",
      tab: "backlinks",
      mode: "one_per_domain",
      range: "1y",
    });
  });

  /** Total: a hand-edited URL must never strand the page in a state it cannot leave. */
  it("falls back on every unrecognised value", () => {
    expect(
      readBacklinksSearch(
        new URLSearchParams("target=brandpacks.com&tab=banana&mode=x&range=99y"),
      ),
    ).toEqual({
      target: "brandpacks.com",
      tab: "backlinks",
      mode: "one_per_domain",
      range: "1y",
    });
  });

  it("normalises the target, keeping a page path", () => {
    expect(
      readBacklinksSearch(new URLSearchParams("target=WWW.BrandPacks.com"))
        .target,
    ).toBe("brandpacks.com");
    expect(
      readBacklinksSearch(new URLSearchParams("target=brandpacks.com%2Fpricing"))
        .target,
    ).toBe("https://brandpacks.com/pricing");
  });

  /** There is no market on this screen; a stray one in the URL is just ignored. */
  it("carries no location or language", () => {
    const search = readBacklinksSearch(
      new URLSearchParams("target=brandpacks.com&location=2826&language=en"),
    );
    expect(Object.keys(search).sort()).toEqual([
      "mode",
      "range",
      "tab",
      "target",
    ]);
  });
});

describe("backlinksSearchParams", () => {
  it("writes nothing at all without a target", () => {
    expect(
      backlinksSearchParams({
        target: "",
        tab: "anchors",
        mode: "as_is",
        range: "6m",
      }).toString(),
    ).toBe("");
  });

  it("leaves defaults implicit so the common URL stays short", () => {
    expect(
      backlinksSearchParams({
        target: "brandpacks.com",
        tab: "backlinks",
        mode: "one_per_domain",
        range: "1y",
      }).toString(),
    ).toBe("target=brandpacks.com");
  });

  it("round-trips a non-default report", () => {
    const search = {
      target: "https://brandpacks.com/pricing",
      tab: "referring",
      mode: "as_is",
      range: "all",
    } as const;
    expect(readBacklinksSearch(backlinksSearchParams(search))).toEqual(search);
  });
});

describe("isSearchable", () => {
  const base = { tab: "backlinks", mode: "one_per_domain", range: "1y" } as const;

  it("is true for a domain or an absolute URL", () => {
    expect(isSearchable({ ...base, target: "brandpacks.com" })).toBe(true);
    expect(
      isSearchable({ ...base, target: "https://brandpacks.com/pricing" }),
    ).toBe(true);
  });

  it("is false for nothing, or for something that cannot be a target", () => {
    expect(isSearchable({ ...base, target: "" })).toBe(false);
    expect(isSearchable({ ...base, target: "nonsense" })).toBe(false);
  });
});
