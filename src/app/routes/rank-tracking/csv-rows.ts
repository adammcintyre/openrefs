/**
 * The tracking table as CSV.
 *
 * Exports the rows currently loaded, which for this table is every tracked
 * keyword in the project — there is no paging against the server here, so
 * "loaded" and "all" are the same set.
 *
 * The spreadsheet keeps the *raw* values, not the screen's formatting. A
 * position column of numbers is sortable and chartable; one containing
 * "Awaiting first check" is neither. The two absent states are therefore
 * distinguished by a separate `status` column rather than by prose in the
 * number column — empty means no value, and `status` says which kind of
 * nothing it was.
 */
import type { TrackedKeywordRow } from "../../../shared/tracking";
import type { CsvCell } from "../../lib/csv";

export const TRACKING_CSV_HEADERS = [
  "keyword",
  "device",
  "location_code",
  "language_code",
  "status",
  "position",
  "change_1d",
  "change_7d",
  "change_30d",
  "best_position",
  "ai_overview",
  "ranking_url",
  "checked_on",
] as const;

/** Which of the three position states a row is in. */
export type RowStatus = "ranked" | "not_in_top_100" | "awaiting_first_check";

export function rowStatus(row: TrackedKeywordRow): RowStatus {
  if (row.latest === null) return "awaiting_first_check";
  return row.latest.position === null ? "not_in_top_100" : "ranked";
}

/**
 * The AI Overview column, as three values rather than a boolean.
 *
 * `aiOverview` is `false` both when the last SERP had no overview and when no
 * SERP has ever been fetched, so writing the raw boolean would export "no" for
 * keywords nobody has looked at yet — a measurement we never took. An empty
 * cell says "unknown", exactly as the position column does, and the `status`
 * column beside it already names which kind of nothing this row is.
 */
export function aiOverviewCell(row: TrackedKeywordRow): "yes" | "no" | null {
  if (row.latest === null) return null;
  return row.aiOverview ? "yes" : "no";
}

export function trackingCsvRows(
  rows: ReadonlyArray<TrackedKeywordRow>,
): CsvCell[][] {
  return rows.map((row) => [
    row.keyword,
    row.device,
    row.locationCode,
    row.languageCode,
    rowStatus(row),
    // Null throughout rather than a sentinel: `toCsv` writes an empty cell,
    // which every spreadsheet reads as "no value" instead of as a number.
    row.latest?.position ?? null,
    row.change1d,
    row.change7d,
    row.change30d,
    row.bestPosition,
    aiOverviewCell(row),
    row.latest?.url ?? null,
    row.latest?.date ?? null,
  ]);
}

/** `rank-tracking-brandpacks-com-2026-08-29`. Safe as a filename anywhere. */
export function trackingCsvFilename(domain: string, today = new Date()): string {
  const slug = domain.replaceAll(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `rank-tracking-${slug.toLowerCase()}-${today.toISOString().slice(0, 10)}`;
}
