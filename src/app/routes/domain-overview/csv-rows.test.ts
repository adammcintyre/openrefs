import { describe, expect, it } from "vitest";

import type {
  CompetitorRow,
  PositionBuckets,
  RankMetrics,
} from "../../../shared/domains";
import { toCsv } from "../../lib/csv";
import {
  competitorCsvHeaders,
  competitorCsvRows,
  csvFilename,
  keywordCsvRows,
  pageCsvRows,
} from "./csv-rows";

const NO_POSITIONS: PositionBuckets = {
  pos1: null,
  pos2to3: null,
  pos4to10: null,
  pos11to20: null,
  pos21to30: null,
  pos31to40: null,
  pos41to50: null,
  pos51to60: null,
  pos61to70: null,
  pos71to80: null,
  pos81to90: null,
  pos91to100: null,
};

function metrics(
  traffic: number | null,
  keywordCount: number | null = null,
): RankMetrics {
  return {
    keywordCount,
    traffic,
    trafficValueUsd: null,
    positions: NO_POSITIONS,
    isNew: null,
    isUp: null,
    isDown: null,
    isLost: null,
  };
}

describe("keywordCsvRows", () => {
  it("exports raw values so the numbers stay summable", () => {
    expect(
      keywordCsvRows([
        {
          keyword: "photo templates",
          searchVolume: 1900,
          cpc: 0.42,
          competition: null,
          competitionLevel: null,
          keywordDifficulty: 31,
          position: 4,
          positionAbsolute: 4,
          url: "https://brandpacks.com/photo",
          title: null,
          serpItemType: "organic",
          traffic: 120.5,
        },
      ]),
    ).toEqual([
      ["photo templates", 4, 1900, 120.5, 0.42, "https://brandpacks.com/photo"],
    ]);
  });

  /*
   * The table shows an em dash for "not reported"; the CSV must not, or the
   * column stops being a number as soon as one row is missing.
   */
  it("leaves unreported values empty rather than dashed or zeroed", () => {
    const [row] = keywordCsvRows([
      {
        keyword: "x",
        searchVolume: null,
        cpc: null,
        competition: null,
        competitionLevel: null,
        keywordDifficulty: null,
        position: null,
        positionAbsolute: null,
        url: null,
        title: null,
        serpItemType: null,
        traffic: null,
      },
    ]);
    expect(row).toEqual(["x", null, null, null, null, null]);
    expect(toCsv(["a", "b"], [[null, 0]])).toBe("a,b\r\n,0");
  });
});

describe("pageCsvRows", () => {
  it("carries both sides of a page's metrics", () => {
    expect(
      pageCsvRows([
        {
          url: "https://brandpacks.com/",
          organic: metrics(900, 120),
          paid: metrics(null, null),
        },
      ]),
    ).toEqual([["https://brandpacks.com/", 900, 120, null, null]]);
  });
});

describe("competitorCsvRows", () => {
  /**
   * The trap the shared type exists to prevent: `organic` is the competitor's
   * own traffic, `sharedOrganic` is the SEARCHED domain's traffic on the
   * keywords they have in common. This test pins which column is which, so a
   * refactor that swaps them fails here rather than in front of a user.
   */
  it("keeps the competitor's own traffic separate from the target's shared traffic", () => {
    const row: CompetitorRow = {
      domain: "rival.com",
      commonKeywords: 42,
      avgPosition: 12.5,
      organic: metrics(50_000, 9000),
      paid: metrics(null),
      sharedOrganic: metrics(300),
      sharedPaid: metrics(null),
    };

    const [cells] = competitorCsvRows([row]);
    expect(cells).toEqual(["rival.com", 42, 9000, 50_000, 300, 12.5]);

    const headers = competitorCsvHeaders("brandpacks.com");
    expect(headers[3]).toBe("Their est. organic traffic");
    // The shared column names the domain it belongs to, in the file itself.
    expect(headers[4]).toBe("Est. traffic for brandpacks.com on the shared keywords");
  });
});

describe("csvFilename", () => {
  const search = {
    target: "brandpacks.com",
    location: 2826,
    language: "en",
    tab: "keywords",
  } as const;

  it("says which domain, which report and which market", () => {
    expect(csvFilename("top-pages", search)).toBe(
      "brandpacks-com-top-pages-2826-en.csv",
    );
  });

  it("carries a variant suffix", () => {
    expect(csvFilename("top-keywords", search, "paid")).toBe(
      "brandpacks-com-top-keywords-paid-2826-en.csv",
    );
  });

  it("stays a sane filename with no domain", () => {
    expect(csvFilename("countries", { ...search, target: "" })).toBe(
      "domain-countries-2826-en.csv",
    );
  });
});
