/**
 * CSV shapes for the three tabs — "export what I have loaded", client-side.
 *
 * The same two rules as Domain Overview's `csv-rows.ts`, for the same reasons:
 *
 * - **Raw values, not formatted ones.** `null` becomes an empty cell rather than
 *   an em dash, and numbers keep their precision. A spreadsheet handed "—" in a
 *   backlinks column can no longer sum it, and doing arithmetic somewhere else
 *   is the entire point of the export.
 * - **Headers say whose number this is.** "Domain Score" in a backlinks export
 *   is the *linking* domain's score, not the searched target's — a column
 *   labelled just "score" is a misread waiting to happen three weeks later.
 *
 * The dofollow ratio is exported as a 0–1 fraction, not "62%": a percent sign
 * turns the column into text in every spreadsheet application.
 */
import type {
  AnchorRow,
  BacklinkRow,
  ReferringDomainRow,
} from "../../../shared/backlinks";
import { seenDate } from "../../components/backlinks/format";
import { targetSlug } from "../../components/backlinks/target";
import type { CsvCell } from "../../lib/csv";

export const BACKLINK_CSV_HEADERS = [
  "Source URL",
  "Source domain",
  "Page Score (source page)",
  "Domain Score (source domain)",
  "Anchor",
  "Target URL",
  "Dofollow",
  "Link type",
  "First seen",
  "Last seen",
  "Links from this domain",
  "Broken",
];

export function backlinkCsvRows(
  rows: ReadonlyArray<BacklinkRow>,
): CsvCell[][] {
  return rows.map((row) => [
    row.urlFrom,
    row.domainFrom,
    row.pageScore,
    row.domainScore,
    row.anchor,
    row.urlTo,
    // Blank, not "false", when the provider did not say.
    row.dofollow === null ? null : String(row.dofollow),
    row.itemType,
    seenDate(row.firstSeen),
    seenDate(row.lastSeen),
    row.groupCount,
    row.isBroken === null ? null : String(row.isBroken),
  ]);
}

export const REFERRING_CSV_HEADERS = [
  "Referring domain",
  "Domain Score",
  "Backlinks",
  "Referring pages",
  "Dofollow pages",
  "Nofollow pages",
  "Dofollow ratio (0-1)",
  "Broken backlinks",
  "First seen",
];

export function referringCsvRows(
  rows: ReadonlyArray<ReferringDomainRow>,
): CsvCell[][] {
  return rows.map((row) => [
    row.domain,
    row.domainScore,
    row.backlinks,
    row.referringPages,
    row.dofollow.dofollowPages,
    row.dofollow.nofollowPages,
    row.dofollow.dofollowRatio,
    row.brokenBacklinks,
    seenDate(row.firstSeen),
  ]);
}

export const ANCHOR_CSV_HEADERS = [
  "Anchor",
  "Backlinks",
  "Referring domains",
  "Referring pages",
  "Dofollow pages",
  "Nofollow pages",
  "Dofollow ratio (0-1)",
  "First seen",
];

export function anchorCsvRows(rows: ReadonlyArray<AnchorRow>): CsvCell[][] {
  return rows.map((row) => [
    row.anchor,
    row.backlinks,
    row.referringDomains,
    row.referringPages,
    row.dofollow.dofollowPages,
    row.dofollow.nofollowPages,
    row.dofollow.dofollowRatio,
    seenDate(row.firstSeen),
  ]);
}

/**
 * A filename that still means something in a downloads folder six months on:
 * which target, which report. No market suffix — link profiles do not have one.
 */
export function csvFilename(kind: string, target: string): string {
  return `${targetSlug(target)}-${kind}.csv`;
}
