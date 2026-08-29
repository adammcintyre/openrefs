import { describe, expect, it } from "vitest";

import type {
  GscCannibalizationOpportunity,
  GscLowCtrOpportunity,
  GscQueryRow,
  GscStrikingDistanceOpportunity,
} from "../../../shared/gsc";
import { toCsv } from "../../lib/csv";
import {
  GSC_CANNIBALIZATION_CSV_HEADERS,
  GSC_QUERY_CSV_HEADERS,
  gscCannibalizationCsvRows,
  gscCsvFilename,
  gscLowCtrCsvRows,
  gscQueryCsvRows,
  gscStrikingCsvRows,
} from "./csv-rows";

const QUERY_ROWS: GscQueryRow[] = [
  { query: "photo booth templates", clicks: 300, impressions: 4000, ctr: 0.075, position: 6.2 },
  // A comma and a quote, to prove the escaping in lib/csv is actually reached.
  { query: 'props, "printable"', clicks: 12, impressions: 900, ctr: 0.0133, position: 14.8 },
];

describe("query rows", () => {
  /*
   * The decision this suite is really pinning: numbers go out raw. A cell
   * holding "7.5%" is a string a spreadsheet cannot average or sort
   * numerically; a cell holding 0.075 is a number it can do both with, and the
   * header says which unit it is in.
   */
  it("exports ctr as the fraction, not as a formatted percentage", () => {
    const rows = gscQueryCsvRows(QUERY_ROWS);
    expect(rows[0]).toEqual(["photo booth templates", 300, 4000, 0.075, 6.2]);
    expect(rows[0]?.[3]).toBe(0.075);
    expect(String(rows[0]?.[3])).not.toContain("%");
  });

  it("names the unit in the header so the raw number is readable", () => {
    expect(GSC_QUERY_CSV_HEADERS).toContain("CTR (fraction)");
  });

  it("has one cell per header", () => {
    for (const row of gscQueryCsvRows(QUERY_ROWS)) {
      expect(row).toHaveLength(GSC_QUERY_CSV_HEADERS.length);
    }
  });

  it("escapes queries containing commas and quotes", () => {
    const csv = toCsv([...GSC_QUERY_CSV_HEADERS], gscQueryCsvRows(QUERY_ROWS));
    expect(csv).toContain('"props, ""printable"""');
    // The escaped field must not have split its row into extra columns.
    const dataLine = csv.split("\r\n")[2] ?? "";
    expect(dataLine.startsWith('"props, ""printable""",12,900')).toBe(true);
  });
});

describe("striking distance rows", () => {
  const items: GscStrikingDistanceOpportunity[] = [
    {
      rule: "striking_distance",
      query: "booth props",
      page: "https://example.com/a",
      clicks: 12,
      impressions: 900,
      ctr: 0.0133,
      position: 14.8,
    },
    {
      rule: "striking_distance",
      query: "rare query",
      // Search Console anonymises rare queries, so the page breakdown can be
      // missing a row even though the query's own totals are real.
      page: null,
      clicks: 3,
      impressions: 400,
      ctr: 0.0075,
      position: 11.2,
    },
  ];

  it("exports the page and the metrics", () => {
    expect(gscStrikingCsvRows(items)[0]).toEqual([
      "booth props",
      "https://example.com/a",
      14.8,
      900,
      12,
      0.0133,
    ]);
  });

  /* An empty cell reads as "no page"; "" reads as a page named nothing. */
  it("leaves an unreported page empty rather than inventing one", () => {
    expect(gscStrikingCsvRows(items)[1]?.[1]).toBeNull();
    expect(toCsv(["a", "b"], [[null, 1]])).toContain(",1");
  });
});

describe("low CTR rows", () => {
  const items: GscLowCtrOpportunity[] = [
    {
      rule: "low_ctr",
      query: "photo booth templates",
      page: "https://example.com/t",
      clicks: 300,
      impressions: 4000,
      ctr: 0.075,
      position: 3.1,
      expectedCtr: 0.32,
      ctrRatio: 0.234,
    },
  ];

  it("carries the expected rate and the shortfall, both as fractions", () => {
    const row = gscLowCtrCsvRows(items)[0];
    expect(row?.[3]).toBe(0.075);
    expect(row?.[4]).toBe(0.32);
    expect(row?.[5]).toBe(0.234);
  });
});

describe("cannibalization rows", () => {
  const items: GscCannibalizationOpportunity[] = [
    {
      rule: "cannibalization",
      query: "booth props",
      page: "https://example.com/a",
      clicks: 100,
      impressions: 2000,
      ctr: 0.05,
      position: 12,
      pages: [
        {
          page: "https://example.com/a",
          shareOfClicks: 0.6,
          clicks: 60,
          impressions: 1200,
          ctr: 0.05,
          position: 11,
        },
        {
          page: "https://example.com/b",
          shareOfClicks: 0.4,
          clicks: 40,
          impressions: 800,
          ctr: 0.05,
          position: 14,
        },
      ],
    },
  ];

  /*
   * One row per competing page, not per query. Packing the pages into a single
   * cell would make the one thing this export is for — sorting by share,
   * filtering to a section of the site — impossible in a spreadsheet.
   */
  it("flattens to one row per competing page", () => {
    const rows = gscCannibalizationCsvRows(items);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[0]).toBe("booth props");
    expect(rows[1]?.[0]).toBe("booth props");
    expect(rows[0]?.[2]).toBe("https://example.com/a");
    expect(rows[1]?.[2]).toBe("https://example.com/b");
  });

  it("keeps the query's own totals on every one of its rows", () => {
    for (const row of gscCannibalizationCsvRows(items)) {
      expect(row).toHaveLength(GSC_CANNIBALIZATION_CSV_HEADERS.length);
      expect(row[7]).toBe(100);
      expect(row[8]).toBe(2000);
    }
  });

  it("exports the share as a fraction", () => {
    expect(gscCannibalizationCsvRows(items)[0]?.[3]).toBe(0.6);
  });
});

describe("gscCsvFilename", () => {
  /*
   * The property and the window are both in the name because these files get
   * emailed around, and two exports of the same table over different ranges
   * are otherwise indistinguishable in a downloads folder.
   */
  it("names the property, the report and the window", () => {
    expect(gscCsvFilename("sc-domain:brandpacks.com", "queries", "2026-08-27")).toBe(
      "searchconsole-brandpacks.com-queries-2026-08-27.csv",
    );
  });

  it("flattens a URL-prefix property into a safe filename", () => {
    expect(gscCsvFilename("https://example.com/shop/", "pages", "2026-08-27")).toBe(
      "searchconsole-example.com-shop-pages-2026-08-27.csv",
    );
  });

  it("never produces a path separator or a leading dash", () => {
    const name = gscCsvFilename("https://a.example/b/c/", "x", "2026-01-01");
    expect(name).not.toContain("/");
    expect(name.startsWith("searchconsole-")).toBe(true);
  });

  it("falls back rather than producing a nameless file", () => {
    expect(gscCsvFilename("///", "queries", "2026-08-27")).toBe(
      "searchconsole-property-queries-2026-08-27.csv",
    );
  });
});
