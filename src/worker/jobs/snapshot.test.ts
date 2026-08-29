import { describe, expect, it } from "vitest";

import type { RankableItem } from "./snapshot";
import {
  bestPositionFor,
  hostFromUrl,
  isProjectDomain,
  normalizeHost,
} from "./snapshot";

function item(
  position: number | null,
  domain: string | null,
  url: string | null = null,
): RankableItem {
  return { position, domain, url };
}

describe("normalizeHost", () => {
  it("lowercases and strips www. and a trailing dot", () => {
    expect(normalizeHost("WWW.Example.com.")).toBe("example.com");
    expect(normalizeHost("  example.com  ")).toBe("example.com");
  });

  it("only strips a leading www., not one in the middle", () => {
    expect(normalizeHost("shop.www.example.com")).toBe("shop.www.example.com");
  });
});

describe("hostFromUrl", () => {
  it("reads the hostname", () => {
    expect(hostFromUrl("https://shop.example.com/a/b?c=d")).toBe(
      "shop.example.com",
    );
  });

  it("returns null rather than throwing on rubbish", () => {
    expect(hostFromUrl("not a url")).toBeNull();
    expect(hostFromUrl("")).toBeNull();
  });
});

describe("isProjectDomain", () => {
  it("matches the domain exactly", () => {
    expect(isProjectDomain("example.com", null, "example.com")).toBe(true);
  });

  it("is www-insensitive on both sides", () => {
    expect(isProjectDomain("www.example.com", null, "example.com")).toBe(true);
    expect(isProjectDomain("example.com", null, "www.example.com")).toBe(true);
    expect(isProjectDomain("WWW.EXAMPLE.COM", null, "example.com")).toBe(true);
  });

  it("counts subdomains as the project's site", () => {
    expect(isProjectDomain("shop.example.com", null, "example.com")).toBe(true);
    expect(isProjectDomain("a.b.example.com", null, "example.com")).toBe(true);
    expect(isProjectDomain("www.shop.example.com", null, "example.com")).toBe(
      true,
    );
  });

  it("does not match a different site that merely ends the same way", () => {
    // The two ways a bare endsWith would be wrong, and they are not rare:
    // someone owns notexample.com, and example.com.au is a real TLD.
    expect(isProjectDomain("notexample.com", null, "example.com")).toBe(false);
    expect(isProjectDomain("example.com.au", null, "example.com")).toBe(false);
    expect(isProjectDomain("myexample.com", null, "example.com")).toBe(false);
  });

  it("does not match a parent when tracking a subdomain", () => {
    expect(isProjectDomain("example.com", null, "shop.example.com")).toBe(false);
  });

  it("falls back to the URL host when domain is missing", () => {
    expect(
      isProjectDomain(null, "https://www.example.com/pricing", "example.com"),
    ).toBe(true);
    expect(isProjectDomain("", "https://other.com/x", "example.com")).toBe(
      false,
    );
  });

  it("is false when there is nothing to compare", () => {
    expect(isProjectDomain(null, null, "example.com")).toBe(false);
    expect(isProjectDomain("example.com", null, "")).toBe(false);
  });
});

describe("bestPositionFor", () => {
  it("returns the lowest matching position and its url", () => {
    const items = [
      item(1, "other.com", "https://other.com/a"),
      item(4, "www.example.com", "https://www.example.com/deep"),
      item(2, "example.com", "https://example.com/home"),
    ];
    expect(bestPositionFor(items, "example.com")).toEqual({
      position: 2,
      url: "https://example.com/home",
    });
  });

  it("counts a subdomain as the project ranking", () => {
    const items = [item(7, "shop.example.com", "https://shop.example.com/x")];
    expect(bestPositionFor(items, "example.com")).toEqual({
      position: 7,
      url: "https://shop.example.com/x",
    });
  });

  it("reports null — not 0 — when the domain is absent from the results", () => {
    // The distinction the whole feature rests on: null is "checked, not in the
    // top 100"; 0 would read as a ranking better than first place.
    const result = bestPositionFor(
      [item(1, "other.com"), item(2, "another.com")],
      "example.com",
    );
    expect(result).toEqual({ position: null, url: null });
    expect(result.position).not.toBe(0);
  });

  it("reports null for an empty SERP", () => {
    expect(bestPositionFor([], "example.com")).toEqual({
      position: null,
      url: null,
    });
  });

  it("skips a matching row that carries no rank", () => {
    // It tells us the page appeared but not where; inventing a position from
    // it would corrupt the series.
    expect(
      bestPositionFor(
        [item(null, "example.com", "https://example.com/")],
        "example.com",
      ),
    ).toEqual({ position: null, url: null });
  });

  it("prefers a ranked row over an unranked one for the same site", () => {
    expect(
      bestPositionFor(
        [
          item(null, "example.com", "https://example.com/unranked"),
          item(9, "example.com", "https://example.com/ranked"),
        ],
        "example.com",
      ),
    ).toEqual({ position: 9, url: "https://example.com/ranked" });
  });

  it("is order-independent", () => {
    const items = [
      item(30, "example.com", "https://example.com/c"),
      item(3, "example.com", "https://example.com/a"),
      item(12, "example.com", "https://example.com/b"),
    ];
    expect(bestPositionFor(items, "example.com").position).toBe(3);
    expect(bestPositionFor([...items].reverse(), "example.com").position).toBe(
      3,
    );
  });
});
