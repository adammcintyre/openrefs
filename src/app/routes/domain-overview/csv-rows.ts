/**
 * CSV shapes for the four tabs — "export what I have loaded", client-side.
 *
 * Two decisions worth stating, because they differ from what the tables show:
 *
 * - **Raw values, not formatted ones.** `null` becomes an empty cell rather
 *   than an em dash, and numbers keep their precision. A spreadsheet that
 *   receives "—" in a traffic column can no longer sum it, and the whole point
 *   of the export is to do arithmetic somewhere else.
 * - **Headers name the domain each number belongs to.** The competitors export
 *   is the one place in this module where two different sites' metrics sit side
 *   by side, and a column labelled just "traffic" in a file opened three weeks
 *   later is a genuine misread waiting to happen.
 */
import type {
  CompetitorRow,
  DomainCountryRow,
  DomainKeywordRow,
  DomainPageRow,
} from "../../../shared/domains";
import type { CsvCell } from "../../lib/csv";
import type { DomainSearch } from "./url-state";

export const KEYWORD_CSV_HEADERS = [
  "Keyword",
  "Position",
  "Search volume",
  "Est. traffic",
  "CPC (USD)",
  "URL",
];

export function keywordCsvRows(
  rows: ReadonlyArray<DomainKeywordRow>,
): CsvCell[][] {
  return rows.map((row) => [
    row.keyword,
    row.position,
    row.searchVolume,
    row.traffic,
    row.cpc,
    row.url,
  ]);
}

export const PAGE_CSV_HEADERS = [
  "URL",
  "Est. organic traffic",
  "Organic keywords",
  "Est. paid traffic",
  "Paid keywords",
];

export function pageCsvRows(rows: ReadonlyArray<DomainPageRow>): CsvCell[][] {
  return rows.map((row) => [
    row.url,
    row.organic.traffic,
    row.organic.keywordCount,
    row.paid.traffic,
    row.paid.keywordCount,
  ]);
}

/**
 * Competitor headers are built against the searched domain rather than being
 * constant, so the "whose number is this" question is answered by the file
 * itself. `organic` is the competitor's own total; `sharedOrganic` is the
 * *target's* performance on the keywords the two have in common.
 */
export function competitorCsvHeaders(target: string): string[] {
  return [
    "Competitor domain",
    "Common keywords",
    "Their organic keywords",
    "Their est. organic traffic",
    `Est. traffic for ${target} on the shared keywords`,
    `Avg. position for ${target} on the shared keywords`,
  ];
}

export function competitorCsvRows(
  rows: ReadonlyArray<CompetitorRow>,
): CsvCell[][] {
  return rows.map((row) => [
    row.domain,
    row.commonKeywords,
    row.organic.keywordCount,
    row.organic.traffic,
    row.sharedOrganic.traffic,
    row.avgPosition,
  ]);
}

export const COUNTRY_CSV_HEADERS = [
  "Country",
  "ISO code",
  "Location code",
  "Language queried",
  "Est. organic traffic",
  "Organic keywords",
  "Est. paid traffic",
  "Paid keywords",
];

export function countryCsvRows(
  rows: ReadonlyArray<DomainCountryRow>,
): CsvCell[][] {
  return rows.map((row) => [
    row.countryName,
    row.countryIsoCode,
    row.locationCode,
    row.languageCode,
    row.organic.traffic,
    row.organic.keywordCount,
    row.paid.traffic,
    row.paid.keywordCount,
  ]);
}

/**
 * A filename that still means something in a downloads folder six months on:
 * which domain, which report, which market. Dots and slashes in the domain
 * become dashes so the extension is unambiguous.
 */
export function csvFilename(
  kind: string,
  search: DomainSearch,
  suffix?: string,
): string {
  const domain = search.target.replaceAll(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const parts = [
    domain === "" ? "domain" : domain,
    kind,
    ...(suffix === undefined ? [] : [suffix]),
    String(search.location),
    search.language,
  ];
  return `${parts.join("-")}.csv`;
}
