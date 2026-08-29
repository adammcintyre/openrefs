/**
 * CSV serialisation for the export endpoints.
 *
 * RFC 4180, with the rules that actually bite:
 *
 *  - A field containing a quote, comma, CR or LF must be quoted, and each
 *    quote inside it doubled. Keywords legitimately contain commas ("shoes,
 *    mens") so this is a routine path, not an edge case.
 *  - Line endings are CRLF, which is what the RFC specifies and what Excel
 *    expects. A lone LF makes Excel on Windows read the file as one row.
 *  - A leading BOM, so Excel opens UTF-8 as UTF-8 rather than as the local
 *    code page — without it, any non-ASCII keyword renders as mojibake.
 */

/** RFC 4180 line ending. */
const CRLF = "\r\n";

/** Excel's "this file is UTF-8" marker. */
export const UTF8_BOM = "﻿";

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than
 * text. A keyword like `=cmd|'/c calc'!A1` in an export is the CSV-injection
 * attack, and the standard mitigation is to prefix the value with a single
 * quote — which Excel and Sheets consume as a "text follows" marker, so the
 * cell still displays the original string.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * One CSV field.
 *
 * `null` and `undefined` become empty (not the strings "null"/"undefined"),
 * which is how a missing metric should read in a spreadsheet.
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = typeof value === "string" ? value : String(value);

  // Neutralise formulas before quoting, so the guard is inside the quotes.
  if (text.length > 0 && FORMULA_PREFIXES.some((char) => text.startsWith(char))) {
    text = `'${text}`;
  }

  const needsQuoting =
    text.includes('"') ||
    text.includes(",") ||
    text.includes("\n") ||
    text.includes("\r") ||
    // Leading or trailing spaces survive only inside quotes.
    text !== text.trim();

  if (!needsQuoting) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** One row: fields escaped and comma-joined. */
export function toCsvRow(values: readonly unknown[]): string {
  return values.map(escapeCsvValue).join(",");
}

/**
 * A complete CSV document: header, rows, CRLF endings, trailing newline and a
 * BOM. The trailing newline matters to line-oriented tools (`wc -l`, `tail`)
 * that would otherwise miss the last row.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [toCsvRow(header), ...rows.map(toCsvRow)];
  return `${UTF8_BOM}${lines.join(CRLF)}${CRLF}`;
}

/**
 * A filesystem-safe stem derived from a collection name: lowercased, runs of
 * anything non-alphanumeric collapsed to a single hyphen, trimmed.
 *
 * Falls back to `fallback` when the name is entirely non-ASCII (a collection
 * named "キーワード" would otherwise slugify to nothing) — the download still
 * needs a name, and an empty one produces a file called ".csv".
 */
export function slugify(name: string, fallback = "collection"): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    // Long enough to stay recognisable, short enough for every filesystem.
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

/**
 * A `content-disposition` value that survives a non-ASCII name.
 *
 * Two filename parameters is not redundancy: the bare `filename=` is ASCII-only
 * per RFC 6266 and is what old clients read, while `filename*=` carries the
 * percent-encoded UTF-8 original for everyone else. Since our slug is already
 * ASCII the two usually agree, but the encoded form keeps the header correct
 * if the slug rules ever loosen.
 */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replaceAll('"', "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
