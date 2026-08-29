import { describe, expect, it } from "vitest";

import {
  EM_DASH,
  formatGscCount,
  formatGscCtr,
  formatGscDate,
  formatGscPermission,
  formatGscPosition,
  formatGscProperty,
  formatGscShare,
  gscPropertyKind,
  isReadableGscSite,
  pluralGscRows,
} from "./format";

/*
 * The mistake this suite exists to prevent: Google returns `ctr` as a fraction.
 * Rendering 0.0423 as "0.04%" turns a healthy click-through rate into an
 * apparent catastrophe, and nothing about the page would look broken.
 */
describe("formatGscCtr", () => {
  it("reads the fraction as a percentage, to one decimal", () => {
    expect(formatGscCtr(0.0423)).toBe("4.2%");
    expect(formatGscCtr(0.5)).toBe("50.0%");
    expect(formatGscCtr(1)).toBe("100.0%");
  });

  it("keeps small rates visible rather than rounding them to nothing", () => {
    expect(formatGscCtr(0.001)).toBe("0.1%");
    expect(formatGscCtr(0.0004)).toBe("0.0%");
  });

  it("renders zero as a real measurement, not as absent", () => {
    expect(formatGscCtr(0)).toBe("0.0%");
  });

  /*
   * Rounding is `toFixed`'s, which operates on the binary double rather than
   * the decimal literal: 0.1235 * 100 is 12.349999999999998, so it rounds down.
   * Pinned rather than corrected — a real `ctr` is a ratio of two integers and
   * essentially never lands on a display tie, and the fix would be a decimal
   * library for a difference of one tenth of a percentage point.
   */
  it("rounds to one decimal", () => {
    expect(formatGscCtr(0.12361)).toBe("12.4%");
    expect(formatGscCtr(0.12341)).toBe("12.3%");
  });

  it("has nothing to say about absent or nonsense input", () => {
    expect(formatGscCtr(null)).toBe(EM_DASH);
    expect(formatGscCtr(undefined)).toBe(EM_DASH);
    expect(formatGscCtr(Number.NaN)).toBe(EM_DASH);
    expect(formatGscCtr(Number.POSITIVE_INFINITY)).toBe(EM_DASH);
  });
});

describe("formatGscPosition", () => {
  /*
   * Average position is fractional and down-is-good. Rounding to an integer
   * would erase the difference between 10.4 and 9.6 — page two and page one.
   */
  it("keeps one decimal", () => {
    expect(formatGscPosition(8.4)).toBe("8.4");
    expect(formatGscPosition(9.62)).toBe("9.6");
    expect(formatGscPosition(1)).toBe("1.0");
  });

  /* Position 0 is Search Console's "never shown", not a rank above number one. */
  it("does not render zero or negatives as impossibly good rankings", () => {
    expect(formatGscPosition(0)).toBe(EM_DASH);
    expect(formatGscPosition(-3)).toBe(EM_DASH);
  });

  it("has nothing to say about absent input", () => {
    expect(formatGscPosition(null)).toBe(EM_DASH);
    expect(formatGscPosition(Number.NaN)).toBe(EM_DASH);
  });
});

describe("formatGscCount", () => {
  it("separates thousands", () => {
    expect(formatGscCount(1234567)).toBe("1,234,567");
    expect(formatGscCount(0)).toBe("0");
  });

  it("rounds the fractional counts an average can produce", () => {
    expect(formatGscCount(12.6)).toBe("13");
  });

  it("has nothing to say about absent input", () => {
    expect(formatGscCount(null)).toBe(EM_DASH);
    expect(formatGscCount(Number.NaN)).toBe(EM_DASH);
  });
});

describe("formatGscShare", () => {
  it("renders a click share as a whole percentage", () => {
    expect(formatGscShare(0.2)).toBe("20%");
    expect(formatGscShare(0.5)).toBe("50%");
    expect(formatGscShare(0.333)).toBe("33%");
  });

  it("has nothing to say about absent input", () => {
    expect(formatGscShare(null)).toBe(EM_DASH);
  });
});

/*
 * `new Date("2026-08-20")` is UTC midnight. Formatted in a negative-offset
 * local zone it renders the day *before*, so every date here is read as UTC.
 */
describe("formatGscDate", () => {
  it("renders an ISO date as a short absolute date", () => {
    expect(formatGscDate("2026-08-20")).toBe("20 Aug 2026");
  });

  /*
   * The day rendered must always be the day in the string. That is what the
   * formatter's `timeZone: "UTC"` buys: without it, UTC midnight formatted in
   * a negative-offset zone renders the previous day, and a whole report would
   * silently be labelled one day early for every viewer in the Americas.
   */
  it("renders the day that is in the string, including at boundaries", () => {
    expect(formatGscDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatGscDate("2026-12-31")).toBe("31 Dec 2026");
    expect(formatGscDate("2024-02-29")).toBe("29 Feb 2024");
  });

  it("passes unparseable input through rather than inventing a date", () => {
    expect(formatGscDate("not-a-date")).toBe("not-a-date");
    expect(formatGscDate(null)).toBe(EM_DASH);
    expect(formatGscDate("")).toBe(EM_DASH);
  });
});

describe("property names", () => {
  it("reads a domain property as the bare domain", () => {
    expect(formatGscProperty("sc-domain:example.com")).toBe("example.com");
    expect(gscPropertyKind("sc-domain:example.com")).toBe("Domain");
  });

  it("reads a URL-prefix property without scheme or trailing slash", () => {
    expect(formatGscProperty("https://example.com/")).toBe("example.com");
    expect(formatGscProperty("https://example.com/shop/")).toBe(
      "example.com/shop",
    );
    expect(gscPropertyKind("https://example.com/")).toBe("URL prefix");
  });

  it("has nothing to say about no property", () => {
    expect(formatGscProperty(null)).toBe(EM_DASH);
    expect(gscPropertyKind(null)).toBe("");
  });
});

describe("permission levels", () => {
  it("names Google's enum in plain words", () => {
    expect(formatGscPermission("siteOwner")).toBe("Owner");
    expect(formatGscPermission("siteFullUser")).toBe("Full access");
    expect(formatGscPermission("siteRestrictedUser")).toBe("Restricted");
    expect(formatGscPermission("siteUnverifiedUser")).toBe("Unverified");
  });

  it("passes an unknown level through rather than hiding it", () => {
    expect(formatGscPermission("siteSomethingNew")).toBe("siteSomethingNew");
  });

  /*
   * Unverified properties are listed by the API but return no data. Picking one
   * would produce an empty report with no explanation.
   */
  it("marks unverified properties as unreadable", () => {
    expect(isReadableGscSite("siteUnverifiedUser")).toBe(false);
    expect(isReadableGscSite("siteOwner")).toBe(true);
  });
});

describe("pluralGscRows", () => {
  it("pluralises regular nouns", () => {
    expect(pluralGscRows(1, "row")).toBe("1 row");
    expect(pluralGscRows(2, "row")).toBe("2 rows");
    expect(pluralGscRows(1200, "page")).toBe("1,200 pages");
  });

  it("pluralises 'query' correctly", () => {
    expect(pluralGscRows(1, "query")).toBe("1 query");
    expect(pluralGscRows(43, "query")).toBe("43 queries");
  });
});
