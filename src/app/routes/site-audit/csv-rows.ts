/**
 * CSV shaping for a category drill-down. Pure, so the columns can be pinned by
 * a test rather than eyeballed in a spreadsheet.
 *
 * **The export is the rows on screen, not the whole category.** Drill-downs are
 * paginated at 50 and the export button says "Export loaded rows" for that
 * reason — writing a file that silently contained page 1 of 9 would be worse
 * than not offering one.
 *
 * **Details are per-category and open-ended.** `AuditIssuePage.details` carries
 * whatever the section data had — a title and its length here, a redirect
 * target there — so the columns are derived from the rows themselves rather
 * than hardcoded. Every key present in any row becomes a column, in first-seen
 * order, and a row missing that key gets an empty cell rather than being
 * dropped or misaligned.
 */
import type { AuditIssuePage } from "../../../shared/audits";
import type { CsvCell } from "../../lib/csv";

/** The columns every drill-down has, before the per-category detail columns. */
export const AUDIT_ISSUES_CSV_BASE_HEADERS = [
  "URL",
  "Status code",
  "Failing checks",
] as const;

/**
 * Every detail key present in these rows, in the order they first appear.
 *
 * First-seen rather than sorted: the Worker builds `details` in a deliberate
 * order per category (the failing value, then its context), and alphabetising
 * would scatter that.
 */
export function detailKeys(
  pages: ReadonlyArray<AuditIssuePage>,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const key of Object.keys(page.details)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * A detail key as a column header: `titleLength` to `Title length`.
 *
 * Handles camelCase *and* snake_case because the payload uses both — the
 * section data comes back with keys like `titleLength` and `statusCode`, while
 * anything we synthesise reads more naturally as `redirect_target`. A header of
 * "TitleLength" is the giveaway that only one of the two was considered.
 *
 * An all-capitals word is left alone, so a key containing `URL` does not come
 * back as "Url".
 */
export function humanizeDetailKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (spaced === "") return key;

  return spaced
    .split(/\s+/)
    .map((word, index) => {
      if (word.length > 1 && word === word.toUpperCase()) return word;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

export function auditIssuesCsvHeaders(
  pages: ReadonlyArray<AuditIssuePage>,
): string[] {
  return [
    ...AUDIT_ISSUES_CSV_BASE_HEADERS,
    ...detailKeys(pages).map(humanizeDetailKey),
  ];
}

export function auditIssuesCsvRows(
  pages: ReadonlyArray<AuditIssuePage>,
): CsvCell[][] {
  const keys = detailKeys(pages);
  return pages.map((page) => [
    page.url,
    page.statusCode,
    // Space-separated: a comma would be quoted by the writer and then read
    // back as one field containing commas, which no spreadsheet splits usefully.
    page.checks.join(" "),
    ...keys.map((key) => page.details[key] ?? null),
  ]);
}

/** `brandpacks-com-titles-2026-08-29.csv`. */
export function auditIssuesCsvFilename(
  domain: string,
  category: string,
): string {
  const slug = domain.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${category}-${date}.csv`;
}
