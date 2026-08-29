import { describe, expect, it } from "vitest";

import type { GapKeywordRow, GapMode } from "../../shared/gap";
import type { DomainIntersectionRow, IntersectionSerpElement } from "../dataforseo";
import {
  competitorOutranksFilter,
  gapCsvHeader,
  gapCsvRow,
  gapKeywordFilters,
  matchesGapMode,
  mergeGapRows,
  upstreamQueriesForMode,
} from "./gap";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function serpElement(
  position: number,
  overrides: Partial<IntersectionSerpElement> = {},
): IntersectionSerpElement {
  return {
    type: "organic",
    position,
    positionAbsolute: position,
    domain: "example.com",
    mainDomain: "example.com",
    title: null,
    url: "https://example.com/page",
    description: null,
    etv: 100,
    estimatedPaidTrafficCostUsd: null,
    raw: null,
    ...overrides,
  };
}

/** One upstream row: the competitor is always `first`, you are always `second`. */
function intersectionRow(
  keyword: string,
  competitorPosition: number | null,
  targetPosition: number | null,
  options: { volume?: number | null; competitorEtv?: number } = {},
): DomainIntersectionRow {
  return {
    keyword: {
      keyword,
      locationCode: 2840,
      languageCode: "en",
      metrics: {
        searchVolume: options.volume ?? 100,
        cpc: 1.5,
        competition: 0.5,
        competitionLevel: "MEDIUM",
        lowTopOfPageBid: null,
        highTopOfPageBid: null,
        monthlySearches: [],
      },
      keywordDifficulty: 40,
      mainIntent: "commercial",
      secondaryIntents: [],
      raw: null,
    },
    first:
      competitorPosition === null
        ? null
        : serpElement(competitorPosition, { etv: options.competitorEtv ?? 100 }),
    second: targetPosition === null ? null : serpElement(targetPosition),
    raw: null,
  };
}

/** A merged row, built directly, for the mode predicate's own tests. */
function gapRow(
  targetPosition: number | null,
  competitorPositions: (number | null)[],
): GapKeywordRow {
  return {
    keyword: "widget",
    searchVolume: 100,
    cpc: null,
    competition: null,
    competitionLevel: null,
    keywordDifficulty: null,
    intent: null,
    target: {
      domain: "you.com",
      position: targetPosition,
      url: null,
      traffic: null,
    },
    competitors: competitorPositions.map((position, index) => ({
      domain: `rival${index}.com`,
      position,
      url: null,
      traffic: null,
    })),
    bestCompetitorTraffic: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Mode semantics                                                              */
/* -------------------------------------------------------------------------- */

describe("matchesGapMode", () => {
  describe("missing — you are absent AND every competitor ranks", () => {
    it("keeps a keyword the whole peer set ranks for and you do not", () => {
      expect(matchesGapMode("missing", gapRow(null, [4, 9]))).toBe(true);
    });

    it("drops it when only some competitors rank", () => {
      expect(matchesGapMode("missing", gapRow(null, [4, null]))).toBe(false);
    });

    it("drops it when you rank at all", () => {
      expect(matchesGapMode("missing", gapRow(50, [4, 9]))).toBe(false);
    });

    it("treats position 1 as ranking, not as a falsy absence", () => {
      // The bug this catches: `if (position)` instead of `!== null` would read
      // the best possible ranking as "does not rank".
      expect(matchesGapMode("missing", gapRow(null, [1, 1]))).toBe(true);
      expect(matchesGapMode("missing", gapRow(1, [2, 3]))).toBe(false);
    });
  });

  describe("untapped — you are absent AND at least one competitor ranks", () => {
    it("keeps a keyword only one competitor has found", () => {
      expect(matchesGapMode("untapped", gapRow(null, [4, null]))).toBe(true);
    });

    it("drops it when you rank", () => {
      expect(matchesGapMode("untapped", gapRow(30, [4, null]))).toBe(false);
    });

    it("drops it when nobody ranks", () => {
      expect(matchesGapMode("untapped", gapRow(null, [null, null]))).toBe(false);
    });
  });

  it("makes every missing keyword an untapped one, but not the reverse", () => {
    // The containment that defines the pair. If this ever inverts, the two
    // tabs are lying about which is the broader list.
    const rows = [
      gapRow(null, [4, 9]),
      gapRow(null, [4, null]),
      gapRow(null, [null, null]),
      gapRow(12, [4, 9]),
    ];
    for (const row of rows) {
      if (matchesGapMode("missing", row)) {
        expect(matchesGapMode("untapped", row)).toBe(true);
      }
    }
    // ...and the second row proves the containment is strict.
    const onlyOneRival = rows[1] as GapKeywordRow;
    expect(matchesGapMode("untapped", onlyOneRival)).toBe(true);
    expect(matchesGapMode("missing", onlyOneRival)).toBe(false);
  });

  describe("weak — you rank and every competitor is ahead of you", () => {
    it("keeps a keyword where all rivals outrank you", () => {
      expect(matchesGapMode("weak", gapRow(24, [2, 11]))).toBe(true);
    });

    it("drops it when one rival is behind you", () => {
      expect(matchesGapMode("weak", gapRow(10, [2, 40]))).toBe(false);
    });

    it("drops it when a rival does not rank at all", () => {
      // The strict reading: a competitor that is absent has not beaten you, so
      // this is not evidence you are behind the field.
      expect(matchesGapMode("weak", gapRow(10, [2, null]))).toBe(false);
    });

    it("drops it when you are absent — that is a missing/untapped keyword", () => {
      expect(matchesGapMode("weak", gapRow(null, [2, 4]))).toBe(false);
    });

    it("is strict: an equal position is not being outranked", () => {
      expect(matchesGapMode("weak", gapRow(5, [5]))).toBe(false);
      expect(matchesGapMode("weak", gapRow(5, [4]))).toBe(true);
    });
  });

  it("keeps everything in all mode", () => {
    const rows = [
      gapRow(null, [4, 9]),
      gapRow(3, [40, null]),
      gapRow(null, [null, null]),
    ];
    for (const row of rows) {
      expect(matchesGapMode("all", row)).toBe(true);
    }
  });

  it("never matches a mode when there are no competitors at all", () => {
    const noRivals = gapRow(null, []);
    for (const mode of ["missing", "untapped", "weak"] as GapMode[]) {
      expect(matchesGapMode(mode, noRivals), mode).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Upstream query planning                                                     */
/* -------------------------------------------------------------------------- */

describe("upstreamQueriesForMode", () => {
  it("asks DataForSEO for the non-intersecting set for missing and untapped", () => {
    // `intersections: false` IS the "they rank, you don't" query — the half of
    // both modes that costs nothing to evaluate worker-side.
    expect(upstreamQueriesForMode("missing")).toEqual([
      { intersections: false, requireOutranking: false },
    ]);
    expect(upstreamQueriesForMode("untapped")).toEqual([
      { intersections: false, requireOutranking: false },
    ]);
  });

  it("asks for the intersecting set plus the outranking filter for weak", () => {
    expect(upstreamQueriesForMode("weak")).toEqual([
      { intersections: true, requireOutranking: true },
    ]);
  });

  it("needs both halves for all — the only two-call-per-competitor mode", () => {
    expect(upstreamQueriesForMode("all")).toHaveLength(2);
    expect(upstreamQueriesForMode("all").map((q) => q.intersections)).toEqual([
      false,
      true,
    ]);
  });

  it("costs one call per competitor for every mode except all", () => {
    for (const mode of ["missing", "untapped", "weak"] as GapMode[]) {
      expect(upstreamQueriesForMode(mode), mode).toHaveLength(1);
    }
  });
});

describe("competitorOutranksFilter", () => {
  it("compares the competitor's rank against yours with the $item-> form", () => {
    // Verified live against domain_intersection (2026-08-29): the endpoint
    // accepts a field-to-field right-hand side. Lower rank_group is better, so
    // the competitor (first) must be strictly less than you (second).
    expect(competitorOutranksFilter()).toEqual({
      field: "first_domain_serp_element.rank_group",
      operator: "<",
      value: "$item->second_domain_serp_element.rank_group",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

describe("gapKeywordFilters", () => {
  it("builds nothing when no filter is set", () => {
    expect(gapKeywordFilters({})).toEqual([]);
  });

  it("uses the keyword_data nesting both intersection endpoints require", () => {
    const filters = gapKeywordFilters({ minVolume: 100, maxDifficulty: 40 });
    expect(filters).toEqual([
      {
        field: "keyword_data.keyword_info.search_volume",
        operator: ">=",
        value: 100,
      },
      {
        field: "keyword_data.keyword_properties.keyword_difficulty",
        operator: "<=",
        value: 40,
      },
    ]);
  });

  it("wraps include/exclude text in the wildcards `like` needs", () => {
    const filters = gapKeywordFilters({ include: "shoes", exclude: "free" });
    expect(filters).toEqual([
      { field: "keyword_data.keyword", operator: "like", value: "%shoes%" },
      { field: "keyword_data.keyword", operator: "not_like", value: "%free%" },
    ]);
  });

  it("leaves room under DataForSEO's 8-filter ceiling for the weak comparison", () => {
    // Six is the most this can produce; weak adds one more, so a fully
    // filtered weak query sits at seven of the eight allowed.
    const filters = gapKeywordFilters({
      minVolume: 1,
      maxVolume: 2,
      minDifficulty: 3,
      maxDifficulty: 4,
      include: "a",
      exclude: "b",
    });
    expect(filters).toHaveLength(6);
    expect(filters.length + 1).toBeLessThanOrEqual(8);
  });
});

/* -------------------------------------------------------------------------- */
/* Merge                                                                       */
/* -------------------------------------------------------------------------- */

describe("mergeGapRows", () => {
  const competitors = ["rival-a.com", "rival-b.com"];

  it("gives every row one slot per competitor, in the order requested", () => {
    const rows = mergeGapRows("you.com", competitors, [
      { competitorIndex: 0, rows: [intersectionRow("widget", 4, null)] },
    ]);

    expect(rows).toHaveLength(1);
    const row = rows[0] as GapKeywordRow;
    expect(row.competitors.map((c) => c.domain)).toEqual(competitors);
    expect(row.competitors[0]?.position).toBe(4);
    // Absent from the second competitor's result set, not dropped from the row.
    expect(row.competitors[1]?.position).toBeNull();
  });

  it("folds the same keyword from two competitors into one row", () => {
    const rows = mergeGapRows("you.com", competitors, [
      { competitorIndex: 0, rows: [intersectionRow("widget", 4, null)] },
      { competitorIndex: 1, rows: [intersectionRow("widget", 9, null)] },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.competitors.map((c) => c.position)).toEqual([4, 9]);
  });

  it("reads your position from `second`, which only the intersecting half carries", () => {
    const rows = mergeGapRows("you.com", competitors, [
      { competitorIndex: 0, rows: [intersectionRow("widget", 4, 22)] },
    ]);
    expect(rows[0]?.target.position).toBe(22);
    expect(rows[0]?.target.domain).toBe("you.com");
  });

  it("does not let a non-intersecting row erase a known position", () => {
    // In `all` mode both halves are fetched. A keyword appears in only one of
    // them, but the merge must not depend on which order they arrive in.
    const rows = mergeGapRows("you.com", competitors, [
      { competitorIndex: 0, rows: [intersectionRow("widget", 4, 22)] },
      { competitorIndex: 1, rows: [intersectionRow("widget", 9, null)] },
    ]);
    expect(rows[0]?.target.position).toBe(22);
  });

  it("takes the best-placed competitor's traffic, ignoring non-rankers", () => {
    const rows = mergeGapRows("you.com", competitors, [
      {
        competitorIndex: 0,
        rows: [intersectionRow("widget", 4, null, { competitorEtv: 250 })],
      },
      {
        competitorIndex: 1,
        rows: [intersectionRow("widget", 9, null, { competitorEtv: 30 })],
      },
    ]);
    expect(rows[0]?.bestCompetitorTraffic).toBe(250);
  });

  it("reports null traffic when no competitor ranks", () => {
    const rows = mergeGapRows("you.com", competitors, [
      { competitorIndex: 0, rows: [intersectionRow("widget", null, 5)] },
    ]);
    expect(rows[0]?.bestCompetitorTraffic).toBeNull();
  });

  it("sorts by volume, then alphabetically for a stable order", () => {
    const rows = mergeGapRows("you.com", competitors, [
      {
        competitorIndex: 0,
        rows: [
          intersectionRow("b keyword", 1, null, { volume: 100 }),
          intersectionRow("rare", 1, null, { volume: 10 }),
          intersectionRow("a keyword", 1, null, { volume: 100 }),
        ],
      },
    ]);
    expect(rows.map((row) => row.keyword)).toEqual([
      "a keyword",
      "b keyword",
      "rare",
    ]);
  });

  it("carries the keyword metrics through", () => {
    const rows = mergeGapRows("you.com", competitors, [
      { competitorIndex: 0, rows: [intersectionRow("widget", 4, null)] },
    ]);
    const row = rows[0] as GapKeywordRow;
    expect(row.searchVolume).toBe(100);
    expect(row.keywordDifficulty).toBe(40);
    expect(row.intent).toBe("commercial");
    expect(row.competitionLevel).toBe("MEDIUM");
  });
});

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

describe("gap CSV", () => {
  it("names one position column per competitor, in order", () => {
    expect(gapCsvHeader(["a.com", "b.com"])).toEqual([
      "keyword",
      "search_volume",
      "keyword_difficulty",
      "cpc",
      "intent",
      "your_position",
      "a.com_position",
      "b.com_position",
      "best_competitor_traffic",
    ]);
  });

  it("exports a row aligned with that header", () => {
    const row = gapRow(24, [2, 11]);
    expect(gapCsvRow(row)).toHaveLength(gapCsvHeader(["a.com", "b.com"]).length);
    expect(gapCsvRow(row)).toEqual([
      "widget",
      100,
      null,
      null,
      null,
      24,
      2,
      11,
      null,
    ]);
  });

  it("exports 'does not rank' as empty, never as zero", () => {
    // The distinction the whole feature rests on. `toCsv` renders null as an
    // empty cell; a 0 here would read as the best possible ranking.
    const cells = gapCsvRow(gapRow(null, [4, null]));
    expect(cells[5]).toBeNull();
    expect(cells[7]).toBeNull();
    expect(cells).not.toContain(0);
  });
});
