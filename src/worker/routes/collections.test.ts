import { describe, expect, it } from "vitest";

import { dedupeKeywordEntries, normalizeKeyword } from "./collections";

describe("normalizeKeyword", () => {
  it("lowercases and trims to the form the primary key dedupes on", () => {
    expect(normalizeKeyword("  SEO Tools  ")).toBe("seo tools");
  });

  it("leaves internal spacing alone — it is part of the keyword", () => {
    expect(normalizeKeyword("best seo  tools")).toBe("best seo  tools");
  });
});

describe("dedupeKeywordEntries", () => {
  it("keeps distinct keywords, normalised", () => {
    expect(
      dedupeKeywordEntries([
        { keyword: "SEO Tools", volumeSnapshot: 1000 },
        { keyword: "rank tracker", volumeSnapshot: 500 },
      ]),
    ).toEqual([
      { keyword: "seo tools", volumeSnapshot: 1000 },
      { keyword: "rank tracker", volumeSnapshot: 500 },
    ]);
  });

  it("collapses case variants that would collide on the primary key", () => {
    // SQLite rejects an INSERT whose own VALUES list repeats a primary key,
    // and ON CONFLICT DO NOTHING does not rescue it — the conflict is inside
    // the statement. Without this, one such pair fails the whole batch.
    const entries = dedupeKeywordEntries([
      { keyword: "seo tools" },
      { keyword: "SEO TOOLS" },
      { keyword: "  Seo Tools " },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.keyword).toBe("seo tools");
  });

  it("keeps the FIRST snapshot, so a re-add cannot move it", () => {
    const entries = dedupeKeywordEntries([
      { keyword: "seo tools", volumeSnapshot: 1000 },
      { keyword: "seo tools", volumeSnapshot: 9999 },
    ]);
    expect(entries).toEqual([{ keyword: "seo tools", volumeSnapshot: 1000 }]);
  });

  it("preserves input order", () => {
    const entries = dedupeKeywordEntries([
      { keyword: "b" },
      { keyword: "a" },
      { keyword: "c" },
    ]);
    expect(entries.map((e) => e.keyword)).toEqual(["b", "a", "c"]);
  });

  it("normalises a missing snapshot to null, never undefined", () => {
    // Drizzle would omit an undefined column; null is what the schema wants.
    expect(dedupeKeywordEntries([{ keyword: "seo tools" }])).toEqual([
      { keyword: "seo tools", volumeSnapshot: null },
    ]);
    expect(
      dedupeKeywordEntries([{ keyword: "seo tools", volumeSnapshot: null }]),
    ).toEqual([{ keyword: "seo tools", volumeSnapshot: null }]);
  });

  it("keeps a zero snapshot — zero volume is a fact, not a missing value", () => {
    expect(
      dedupeKeywordEntries([{ keyword: "seo tools", volumeSnapshot: 0 }]),
    ).toEqual([{ keyword: "seo tools", volumeSnapshot: 0 }]);
  });

  it("drops entries that normalise to nothing", () => {
    expect(dedupeKeywordEntries([{ keyword: "   " }])).toEqual([]);
  });

  it("is idempotent — deduping twice changes nothing", () => {
    const once = dedupeKeywordEntries([
      { keyword: "SEO Tools", volumeSnapshot: 10 },
      { keyword: "seo tools", volumeSnapshot: 20 },
      { keyword: "rank tracker" },
    ]);
    expect(dedupeKeywordEntries(once)).toEqual(once);
  });

  it("makes added + skipped === submitted arithmetic hold", () => {
    // The response contract: `submitted` counts distinct keywords after
    // normalisation, not raw array length, so a caller sending duplicates is
    // told how many rows their request actually represented.
    const submitted = dedupeKeywordEntries([
      { keyword: "a" },
      { keyword: "A" },
      { keyword: "b" },
    ]);
    expect(submitted).toHaveLength(2);
  });
});
