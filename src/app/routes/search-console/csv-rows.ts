/**
 * CSV shapes for "export the rows I'm looking at".
 *
 * Client-side and loaded-rows-only, like every other module's export: what
 * lands in the file is exactly what was on screen, so a truncated list exports
 * truncated and the note above the button says so.
 *
 * **Numbers are exported raw, not formatted.** `ctr` goes out as the fraction
 * Google returned (`0.0423`), not as the string "4.2%". A spreadsheet can
 * format a number and average a column of them; it can do neither with a string
 * that has a percent sign glued to it. The header names the unit so nobody has
 * to guess.
 *
 * Everything here is pure — no DOM, no download — so the row shapes can be
 * asserted directly.
 */
import type {
  GscCannibalizationOpportunity,
  GscLowCtrOpportunity,
  GscPageRow,
  GscQueryRow,
  GscStrikingDistanceOpportunity,
} from "../../../shared/gsc";
import type { CsvCell } from "../../lib/csv";

export const GSC_QUERY_CSV_HEADERS = [
  "Query",
  "Clicks",
  "Impressions",
  "CTR (fraction)",
  "Average position",
] as const;

export function gscQueryCsvRows(
  rows: ReadonlyArray<GscQueryRow>,
): CsvCell[][] {
  return rows.map((row) => [
    row.query,
    row.clicks,
    row.impressions,
    row.ctr,
    row.position,
  ]);
}

export const GSC_PAGE_CSV_HEADERS = [
  "Page",
  "Clicks",
  "Impressions",
  "CTR (fraction)",
  "Average position",
] as const;

export function gscPageCsvRows(rows: ReadonlyArray<GscPageRow>): CsvCell[][] {
  return rows.map((row) => [
    row.page,
    row.clicks,
    row.impressions,
    row.ctr,
    row.position,
  ]);
}

export const GSC_STRIKING_CSV_HEADERS = [
  "Query",
  "Best page",
  "Average position",
  "Impressions",
  "Clicks",
  "CTR (fraction)",
] as const;

export function gscStrikingCsvRows(
  rows: ReadonlyArray<GscStrikingDistanceOpportunity>,
): CsvCell[][] {
  return rows.map((row) => [
    row.query,
    // Null rather than "" — Search Console anonymises rare queries, and an
    // empty cell reads as "no page" where "" reads as a page named nothing.
    row.page,
    row.position,
    row.impressions,
    row.clicks,
    row.ctr,
  ]);
}

export const GSC_LOW_CTR_CSV_HEADERS = [
  "Query",
  "Best page",
  "Average position",
  "CTR (fraction)",
  "Expected CTR (fraction)",
  "Share of expected",
  "Impressions",
  "Clicks",
] as const;

export function gscLowCtrCsvRows(
  rows: ReadonlyArray<GscLowCtrOpportunity>,
): CsvCell[][] {
  return rows.map((row) => [
    row.query,
    row.page,
    row.position,
    row.ctr,
    row.expectedCtr,
    row.ctrRatio,
    row.impressions,
    row.clicks,
  ]);
}

export const GSC_CANNIBALIZATION_CSV_HEADERS = [
  "Query",
  "Competing pages",
  "Page",
  "Share of clicks (fraction)",
  "Page clicks",
  "Page impressions",
  "Page position",
  "Query clicks",
  "Query impressions",
] as const;

/**
 * One row per competing *page*, not per query.
 *
 * A query with three pages is three rows sharing a query name. Packing the
 * pages into a single cell would make the one thing you export this list to do
 * — sort by share, filter to a section of the site — impossible in a
 * spreadsheet.
 */
export function gscCannibalizationCsvRows(
  rows: ReadonlyArray<GscCannibalizationOpportunity>,
): CsvCell[][] {
  return rows.flatMap((row) =>
    row.pages.map((page) => [
      row.query,
      row.pages.length,
      page.page,
      page.shareOfClicks,
      page.clicks,
      page.impressions,
      page.position,
      row.clicks,
      row.impressions,
    ]),
  );
}

/**
 * `searchconsole-brandpacks.com-queries-2026-08-27.csv`
 *
 * The property and the window are both in the name because these files are
 * emailed around, and two exports of the same table for different date ranges
 * are otherwise indistinguishable once they are in a downloads folder.
 */
export function gscCsvFilename(
  property: string,
  report: string,
  to: string,
): string {
  const slug = property
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9.-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `searchconsole-${slug || "property"}-${report}-${to}.csv`;
}
