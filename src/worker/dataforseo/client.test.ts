import { describe, expect, it } from "vitest";

import {
  CACHE_TTL_SECONDS,
  canonicalJson,
  computeCacheKey,
  DFS_BASE_URL,
  DFS_SANDBOX_BASE_URL,
} from "./client";

describe("canonicalJson", () => {
  it("sorts object keys at every depth", () => {
    const a = { b: 1, a: { z: [1, 2], y: { q: true, p: null } } };
    const b = { a: { y: { p: null, q: true }, z: [1, 2] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("preserves array order — a reordered keyword list is a different request", () => {
    expect(canonicalJson(["b", "a"])).not.toBe(canonicalJson(["a", "b"]));
  });

  it("drops undefined object values, matching what would go on the wire", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("does not confuse values with their string forms", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: "1" }));
  });

  it("survives top-level null and undefined", () => {
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(null)).toBe("null");
  });
});

describe("computeCacheKey", () => {
  const payload = [{ keywords: ["seo tools"], location_code: 2826 }];

  it("uses the documented ws:<id>:dfs:<endpoint>:<sha256> shape", async () => {
    const key = await computeCacheKey("ws-1", "keywords_data/x/live", payload);
    expect(key).toMatch(/^ws:ws-1:dfs:keywords_data\/x\/live:[0-9a-f]{64}$/);
  });

  it("is invariant to payload key order", async () => {
    const ordered = await computeCacheKey("ws-1", "e", [
      { a: 1, b: { c: 2, d: 3 } },
    ]);
    const shuffled = await computeCacheKey("ws-1", "e", [
      { b: { d: 3, c: 2 }, a: 1 },
    ]);
    expect(ordered).toBe(shuffled);
  });

  it("isolates workspaces — the same query never shares an entry", async () => {
    const one = await computeCacheKey("ws-1", "e", payload);
    const two = await computeCacheKey("ws-2", "e", payload);
    expect(one).not.toBe(two);
    // Both must stay under their own purgeable prefix.
    expect(one.startsWith("ws:ws-1:")).toBe(true);
    expect(two.startsWith("ws:ws-2:")).toBe(true);
  });

  it("separates endpoints that happen to take the same payload", async () => {
    const volume = await computeCacheKey("ws-1", "a/live", payload);
    const ideas = await computeCacheKey("ws-1", "b/live", payload);
    expect(volume).not.toBe(ideas);
  });

  it("changes when any payload value changes", async () => {
    const uk = await computeCacheKey("ws-1", "e", [{ location_code: 2826 }]);
    const us = await computeCacheKey("ws-1", "e", [{ location_code: 2840 }]);
    expect(uk).not.toBe(us);
  });

  it("cannot be collided by a workspace id containing the delimiter", async () => {
    // "a" + ":dfs:e" vs workspace "a:dfs:e" — the hash suffix keeps these apart
    // even if a future workspace id were not a UUID.
    const one = await computeCacheKey("a", "e", payload);
    const two = await computeCacheKey("a:dfs:e:x", "e", payload);
    expect(one).not.toBe(two);
  });
});

describe("CACHE_TTL_SECONDS", () => {
  it("matches the TTL table in docs/ARCHITECTURE.md", () => {
    const day = 24 * 60 * 60;
    expect(CACHE_TTL_SECONDS).toEqual({
      long: 30 * day,
      medium: 14 * day,
      short: 7 * day,
      live: 1 * day,
      none: 0,
    });
  });

  it("orders the buckets from longest to shortest", () => {
    const { long, medium, short, live, none } = CACHE_TTL_SECONDS;
    expect(long).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(short);
    expect(short).toBeGreaterThan(live);
    expect(live).toBeGreaterThan(none);
  });

  it("keeps every cached bucket above KV's 60-second minimum", () => {
    for (const [bucket, seconds] of Object.entries(CACHE_TTL_SECONDS)) {
      if (bucket === "none") continue;
      expect(seconds, `${bucket} would be rejected by KV`).toBeGreaterThanOrEqual(60);
    }
  });
});

describe("base URLs", () => {
  it("point at v3 and end in a slash so `new URL(endpoint, base)` keeps the path", () => {
    for (const base of [DFS_BASE_URL, DFS_SANDBOX_BASE_URL]) {
      expect(base.endsWith("/v3/")).toBe(true);
      expect(new URL("keywords_data/x/live", base).toString()).toBe(
        `${base}keywords_data/x/live`,
      );
    }
  });
});
