import { describe, expect, it } from "vitest";

import {
  isLikelyTarget,
  normalizeTarget,
  targetHost,
  targetKind,
  targetSlug,
} from "./target";

describe("normalizeTarget", () => {
  it("lowercases a host and drops www., matching the Worker", () => {
    expect(normalizeTarget("  WWW.BrandPacks.com  ")).toBe("brandpacks.com");
  });

  it("drops a trailing slash and trailing dots from a bare host", () => {
    expect(normalizeTarget("brandpacks.com/")).toBe("brandpacks.com");
    expect(normalizeTarget("brandpacks.com.")).toBe("brandpacks.com");
  });

  /**
   * The difference from Domain Overview that this whole module hangs on: a
   * path means a page query, and throwing it away would answer a different
   * question with a much bigger number.
   */
  it("keeps a path, adding the scheme the API requires", () => {
    expect(normalizeTarget("brandpacks.com/pricing")).toBe(
      "https://brandpacks.com/pricing",
    );
  });

  it("preserves path case and query, which are significant", () => {
    expect(normalizeTarget("HTTPS://Example.com/Docs/Guide?ref=Foo")).toBe(
      "https://example.com/Docs/Guide?ref=Foo",
    );
  });

  it("drops the fragment — it never reaches the server", () => {
    expect(normalizeTarget("https://example.com/page#section")).toBe(
      "https://example.com/page",
    );
  });

  it("collapses an origin-only URL to its bare host", () => {
    expect(normalizeTarget("https://example.com/")).toBe("example.com");
    expect(normalizeTarget("https://example.com")).toBe("example.com");
  });

  it("keeps www. on a URL, because the Worker does", () => {
    expect(normalizeTarget("https://www.example.com/a")).toBe(
      "https://www.example.com/a",
    );
  });

  it("returns empty for empty or whitespace input", () => {
    expect(normalizeTarget("")).toBe("");
    expect(normalizeTarget("   ")).toBe("");
  });

  it("hands back an unparseable string rather than mangling it", () => {
    expect(normalizeTarget("https://")).toBe("https://");
  });
});

describe("isLikelyTarget", () => {
  it("accepts bare domains and absolute URLs", () => {
    expect(isLikelyTarget("brandpacks.com")).toBe(true);
    expect(isLikelyTarget("blog.brandpacks.com")).toBe(true);
    expect(isLikelyTarget("https://brandpacks.com/pricing")).toBe(true);
  });

  it("rejects what the Worker would reject", () => {
    expect(isLikelyTarget("nonsense")).toBe(false);
    expect(isLikelyTarget("")).toBe(false);
    // A path with no scheme: normalizeTarget adds one before this is asked.
    expect(isLikelyTarget("brandpacks.com/pricing")).toBe(false);
    expect(isLikelyTarget("ftp://example.com/x")).toBe(false);
  });
});

describe("targetKind", () => {
  it("tells a page query from a domain query", () => {
    expect(targetKind("brandpacks.com")).toBe("domain");
    expect(targetKind("https://brandpacks.com/pricing")).toBe("url");
  });
});

describe("targetHost", () => {
  it("reduces either shape to a host", () => {
    expect(targetHost("brandpacks.com")).toBe("brandpacks.com");
    expect(targetHost("https://brandpacks.com/a/b")).toBe("brandpacks.com");
  });
});

describe("targetSlug", () => {
  it("flattens a target into a filename fragment", () => {
    expect(targetSlug("brandpacks.com")).toBe("brandpacks-com");
    expect(targetSlug("https://brandpacks.com/pricing")).toBe(
      "brandpacks-com-pricing",
    );
  });

  it("never produces an empty or dangling-dash slug", () => {
    expect(targetSlug("")).toBe("target");
    expect(targetSlug("///")).toBe("target");
    expect(targetSlug(`a.com/${"x".repeat(200)}`)).not.toMatch(/-$/);
  });
});
