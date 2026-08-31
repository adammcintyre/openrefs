import { describe, expect, it } from "vitest";

import type {
  AnchorRow,
  BacklinkRow,
  DofollowSplit,
  ReferringDomainRow,
} from "../../../shared/backlinks";
import { toCsv } from "../../lib/csv";
import {
  ANCHOR_CSV_HEADERS,
  BACKLINK_CSV_HEADERS,
  REFERRING_CSV_HEADERS,
  anchorCsvRows,
  backlinkCsvRows,
  csvFilename,
  referringCsvRows,
} from "./csv-rows";

const SPLIT: DofollowSplit = {
  dofollowPages: 30,
  nofollowPages: 20,
  dofollowRatio: 0.6,
};

const NO_SPLIT: DofollowSplit = {
  dofollowPages: null,
  nofollowPages: null,
  dofollowRatio: null,
};

const LINK: BacklinkRow = {
  domainFrom: "example.org",
  urlFrom: "https://example.org/blog/post",
  urlTo: "https://brandpacks.com/pricing",
  anchor: "brand packs",
  dofollow: true,
  isBroken: false,
  isNew: null,
  isLost: null,
  firstSeen: "2024-03-11 08-22-14 +00:00",
  lastSeen: "2026-08-01 00-00-00 +00:00",
  pageScore: 42,
  domainScore: 61,
  pageFromTitle: null,
  pageFromLanguage: null,
  linksCount: 1,
  groupCount: 7,
  itemType: "anchor",
  spamScore: 3,
};

/** Every optional field absent — the row shape the em-dash paths exist for. */
const EMPTY_LINK: BacklinkRow = {
  ...LINK,
  domainFrom: null,
  urlFrom: null,
  urlTo: null,
  anchor: null,
  dofollow: null,
  isBroken: null,
  firstSeen: null,
  lastSeen: null,
  pageScore: null,
  domainScore: null,
  groupCount: null,
};

describe("backlinkCsvRows", () => {
  it("exports raw values, not the table's formatting", () => {
    const [row] = backlinkCsvRows([LINK]);
    expect(row).toEqual([
      "https://example.org/blog/post",
      "example.org",
      42,
      61,
      "brand packs",
      "https://brandpacks.com/pricing",
      "true",
      "anchor",
      // The provider's number, raw. Ungraded and unrounded: the grading is a
      // reading aid for the table, and a spreadsheet wants to do its own.
      3,
      // The date half only: "first seen" is accurate to about a day.
      "2024-03-11",
      "2026-08-01",
      7,
      "false",
    ]);
  });

  /**
   * A spreadsheet handed "—" in a numeric column can no longer sum it, and
   * "false" for a link the provider said nothing about is a claim we cannot
   * make. Both become blank cells.
   */
  it("writes blanks, never em dashes and never a guessed false", () => {
    const [row] = backlinkCsvRows([EMPTY_LINK]);
    expect(row).not.toContain("—");
    // dofollow and isBroken are the two boolean columns.
    expect(row?.[6]).toBeNull();
    expect(row?.[11]).toBeNull();
  });

  it("lines up with its headers", () => {
    expect(backlinkCsvRows([LINK])[0]).toHaveLength(
      BACKLINK_CSV_HEADERS.length,
    );
  });

  it("survives an anchor containing a comma and a quote", () => {
    const csv = toCsv(
      BACKLINK_CSV_HEADERS,
      backlinkCsvRows([{ ...LINK, anchor: 'best, "free" packs' }]),
    );
    expect(csv).toContain('"best, ""free"" packs"');
  });
});

describe("referringCsvRows", () => {
  const DOMAIN: ReferringDomainRow = {
    domain: "example.org",
    domainScore: 61,
    backlinks: 12,
    referringPages: 50,
    dofollow: SPLIT,
    brokenBacklinks: 0,
    firstSeen: "2024-03-11 08-22-14 +00:00",
    lostDate: null,
    spamScore: 3,
  };

  it("exports the ratio as a fraction, not a percent string", () => {
    const [row] = referringCsvRows([DOMAIN]);
    expect(row?.[6]).toBe(0.6);
    expect(row).toHaveLength(REFERRING_CSV_HEADERS.length);
  });

  it("leaves a underivable dofollow share blank", () => {
    const [row] = referringCsvRows([{ ...DOMAIN, dofollow: NO_SPLIT }]);
    expect(row?.[6]).toBeNull();
  });
});

describe("anchorCsvRows", () => {
  const ANCHOR: AnchorRow = {
    anchor: "brand packs",
    score: 40,
    backlinks: 12,
    referringDomains: 5,
    referringPages: 9,
    dofollow: SPLIT,
    brokenBacklinks: 0,
    firstSeen: "2024-03-11 08-22-14 +00:00",
    lostDate: null,
  };

  it("lines up with its headers", () => {
    expect(anchorCsvRows([ANCHOR])[0]).toHaveLength(ANCHOR_CSV_HEADERS.length);
  });

  /**
   * The table labels an absent anchor "(no anchor text)" so it does not read as
   * missing data; the export must not, or a spreadsheet grouping by anchor
   * would grow a category that does not exist upstream.
   */
  it("keeps an absent anchor blank rather than exporting the table's label", () => {
    expect(anchorCsvRows([{ ...ANCHOR, anchor: "" }])[0]?.[0]).toBe("");
    expect(anchorCsvRows([{ ...ANCHOR, anchor: null }])[0]?.[0]).toBeNull();
  });
});

describe("csvFilename", () => {
  it("names the target and the report", () => {
    expect(csvFilename("anchors", "brandpacks.com")).toBe(
      "brandpacks-com-anchors.csv",
    );
    expect(csvFilename("backlinks", "https://brandpacks.com/pricing")).toBe(
      "brandpacks-com-pricing-backlinks.csv",
    );
  });

  it("has no market suffix — link profiles do not have one", () => {
    expect(csvFilename("anchors", "brandpacks.com")).not.toMatch(/2826|-en\./);
  });
});
