/**
 * "Export the rows I've loaded", client-side.
 *
 * Two decisions differ from what the table shows, and both exist so the file is
 * useful in a spreadsheet rather than merely a screenshot of one:
 *
 * - **Raw values, not formatted ones.** `null` becomes an empty cell rather
 *   than an em dash, and numbers keep their precision. A traffic column full of
 *   "—" cannot be summed, and summing it elsewhere is the whole point.
 * - **The expandable keyword list is flattened into a column.** On screen the
 *   keywords a page ranks for live behind a disclosure, because twenty of them
 *   would wreck the row height. In a file there is no row height, and dropping
 *   them would throw away the evidence for every other number — `totalVolume`
 *   is a sum over exactly that list.
 *
 * The Page Score column is included only when the sweep actually produced page
 * scores. See `pageScoresAvailable` on the response: `bulk_ranks` holds far
 * fewer pages than domains, so an all-null column is normal and exporting it
 * would put a column of blanks in front of someone who then has to work out
 * whether it means zero.
 */
import type { ContentPageRow } from "../../../shared/content";
import type { CsvCell } from "../../lib/csv";
import type { ContentSearch } from "./url-state";

const BASE_HEADERS = [
  "Page title",
  "URL",
  "Domain",
  "Domain Score",
] as const;

const TAIL_HEADERS = [
  "Est. monthly traffic",
  "Ranking keywords",
  "Total volume",
  "Best position",
  "Word count",
  "Keywords (position)",
] as const;

export function contentCsvHeaders(pageScoresAvailable: boolean): string[] {
  return [
    ...BASE_HEADERS,
    ...(pageScoresAvailable ? ["Page Score"] : []),
    ...TAIL_HEADERS,
  ];
}

/**
 * `"photo booth template (3); booth strips (11)"`.
 *
 * Semicolon-separated because a comma is the field separator and quoting every
 * one of these cells would make the file harder to read in a plain editor for
 * no gain. Positions travel with the keywords: "ranks for twelve keywords" is a
 * very different page depending on whether those are positions 2–5 or 17–20.
 */
export function formatKeywordList(row: ContentPageRow): string {
  return row.keywords
    .map((entry) => `${entry.keyword} (${entry.position})`)
    .join("; ");
}

export function contentCsvRows(
  rows: ReadonlyArray<ContentPageRow>,
  options: {
    pageScoresAvailable: boolean;
    /**
     * Word counts fetched since the sweep, by URL.
     *
     * They are not on the row: `/content/discover` always reports
     * `wordCount: null` because counting is a separate paid call per URL. The
     * export takes whatever the user has actually bought, so a file taken after
     * counting ten rows carries those ten.
     */
    wordCounts?: ReadonlyMap<string, number | null>;
  },
): CsvCell[][] {
  return rows.map((row) => {
    const wordCount = options.wordCounts?.get(row.url) ?? row.wordCount;
    return [
      row.title,
      row.url,
      row.domain,
      row.domainScore,
      ...(options.pageScoresAvailable ? [row.pageScore] : []),
      row.estTraffic,
      row.keywords.length,
      row.totalVolume,
      Number.isFinite(row.bestPosition) ? row.bestPosition : null,
      wordCount,
      formatKeywordList(row),
    ];
  });
}

/**
 * A filename that still means something in a downloads folder six months on:
 * which topic, which market, how far it was expanded.
 */
export function contentCsvFilename(search: ContentSearch): string {
  const topic = search.topic
    .replaceAll(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return [
    topic === "" ? "topic" : topic,
    "content-discovery",
    `expand${search.expand}`,
    String(search.location),
    search.language,
  ].join("-").concat(".csv");
}
