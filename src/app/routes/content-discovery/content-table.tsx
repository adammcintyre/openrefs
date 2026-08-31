/**
 * The results table: one row per deduplicated page.
 *
 * Two columns behave unusually, and both are deliberate.
 *
 * **Page Score is conditional and quiet.** `bulk_ranks` accepts URL targets but
 * its index holds far fewer pages than domains, so a whole sweep can come back
 * with every page score null. When the response says `pageScoresAvailable:
 * false` the column is *removed* rather than filled with dashes — a column of
 * dashes reads as a bug in us rather than a gap in their index. Even when it is
 * present the coverage is thin, so it renders de-emphasised: it is a bonus
 * signal, not a peer of Domain Score, and styling it as one would invite people
 * to compare rows on a column that is populated for a third of them.
 *
 * **Word count is empty until bought.** `/content/discover` always reports it
 * as null because counting is a separate per-URL call. The column exists
 * anyway, holding an em dash and a bulk action, because a column you can fill
 * explains the feature better than a button with no column to point at.
 */
import { Copy, ExternalLink, Search } from "lucide-react";
import { createContext, useContext, useMemo } from "react";

import type { ContentPageRow } from "../../../shared/content";
import { KeywordsCell } from "../../components/content/keywords-cell";
import { displayPath, safeHttpUrl } from "../../components/content/safe-url";
import { EM_DASH, formatCount, formatTraffic } from "../../components/domains/format";
import { DomainScoreCell } from "../../components/gap/score-cell";
import {
  Button,
  DataTable,
  createDataTableColumns,
} from "../../components/ui";
import type { DataTableColumn } from "../../components/ui";

/* ------------------------------- row context ------------------------------- */

interface RowContextValue {
  rows: ReadonlyArray<ContentPageRow>;
  selected: ReadonlySet<string>;
  onToggle: (url: string) => void;
  onToggleAll: (checked: boolean) => void;
  onViewSerp: (row: ContentPageRow) => void;
  onCopyUrl: (row: ContentPageRow) => void;
  /** Counts bought since the sweep, by URL. */
  wordCounts: ReadonlyMap<string, number | null>;
  /** True while a count for these URLs is in flight. */
  counting: boolean;
}

const RowContext = createContext<RowContextValue | null>(null);

function useRowContext(): RowContextValue {
  const context = useContext(RowContext);
  if (context === null) {
    throw new Error("Content rows must render inside <ContentTable>");
  }
  return context;
}

const CHECKBOX_CLASS = "size-4 shrink-0 cursor-pointer accent-primary";

function SelectAllHeader() {
  const { rows, selected, onToggleAll } = useRowContext();
  const total = rows.length;
  const chosen = rows.filter((row) => selected.has(row.url)).length;
  const allChosen = total > 0 && chosen === total;

  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={allChosen}
      disabled={total === 0}
      ref={(node) => {
        if (node) node.indeterminate = chosen > 0 && !allChosen;
      }}
      onChange={(event) => onToggleAll(event.target.checked)}
      aria-label={
        allChosen ? `Clear selection of ${total} pages` : `Select all ${total} pages`
      }
    />
  );
}

function SelectCell({ row }: { row: ContentPageRow }) {
  const { selected, onToggle } = useRowContext();
  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={selected.has(row.url)}
      onChange={() => onToggle(row.url)}
      aria-label={`Select ${row.title ?? row.url}`}
    />
  );
}

/** Title over path, with the title linking out when the scheme is safe. */
function PageCell({ row }: { row: ContentPageRow }) {
  const href = safeHttpUrl(row.url);
  const title = row.title ?? "Untitled page";

  return (
    <div className="flex min-w-0 max-w-md flex-col gap-0.5">
      {href === null ? (
        <span className="font-medium text-foreground">{title}</span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
        >
          {title}
        </a>
      )}
      <span className="truncate text-xs text-muted-foreground" title={row.url}>
        {displayPath(row.url)}
      </span>
    </div>
  );
}

function WordCountCell({ row }: { row: ContentPageRow }) {
  const { wordCounts, counting, selected } = useRowContext();
  const bought = wordCounts.get(row.url);

  if (bought === undefined) {
    return (
      <span
        className="text-muted-foreground"
        title={
          counting && selected.has(row.url)
            ? "Counting…"
            : "Not counted yet — select rows and use “Count words”. Each URL is a separate paid fetch of the page."
        }
      >
        {EM_DASH}
      </span>
    );
  }

  if (bought === null) {
    return (
      <span
        className="text-muted-foreground"
        title="Could not count: the page refused the crawler, answered an error, or had no parseable body. Different from a page that really has no text."
      >
        n/a
      </span>
    );
  }

  return <span className="tabular-nums">{formatCount(bought)}</span>;
}

function RowActions({ row }: { row: ContentPageRow }) {
  const { onViewSerp, onCopyUrl } = useRowContext();
  const href = safeHttpUrl(row.url);
  const bestKeyword = row.keywords[0]?.keyword;

  return (
    <div className="flex items-center gap-1">
      {href === null ? null : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex size-7 items-center justify-center rounded-app text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={`Open ${row.url} in a new tab`}
          title="Open the page"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      )}

      <Button
        size="sm"
        variant="ghost"
        onClick={() => onViewSerp(row)}
        // The best keyword is the row's strongest ranking, and the SERP panel
        // takes exactly one keyword — so the action names which it will open
        // rather than silently picking for you.
        disabled={bestKeyword === undefined}
        aria-label={
          bestKeyword === undefined
            ? "No keyword to open a SERP for"
            : `View SERP for ${bestKeyword}`
        }
        title={
          bestKeyword === undefined
            ? undefined
            : `View the SERP for “${bestKeyword}” — this page's best ranking.`
        }
      >
        <Search className="size-3.5" aria-hidden="true" />
        SERP
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => onCopyUrl(row)}
        aria-label={`Copy the URL of ${row.title ?? row.url}`}
        title="Copy URL"
      >
        <Copy className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

/* --------------------------------- columns --------------------------------- */

const col = createDataTableColumns<ContentPageRow>();

/**
 * Built per `pageScoresAvailable` rather than declared once at module scope,
 * because one column's existence depends on the response. Memoised by the
 * caller: rebuilding the array every render would reset the table's sort state
 * on each keystroke elsewhere on the page.
 */
function buildColumns(
  pageScoresAvailable: boolean,
): Array<DataTableColumn<ContentPageRow>> {
  return [
    col.display({
      id: "select",
      header: () => <SelectAllHeader />,
      cell: (info) => <SelectCell row={info.row.original} />,
    }),
    col.accessor((row) => row.title ?? row.url, {
      id: "page",
      header: "Page",
      cell: (info) => <PageCell row={info.row.original} />,
    }),
    col.accessor("domain", {
      header: "Domain",
      cell: (info) => (
        <span className="text-muted-foreground">{info.getValue<string>()}</span>
      ),
    }),
    // null must sort apart from a real 0, so the accessor hands v9's
    // sortUndefined an undefined and the cell reads the original.
    col.accessor((row) => row.domainScore ?? undefined, {
      id: "domainScore",
      header: "Domain Score",
      cell: (info) => <DomainScoreCell score={info.row.original.domainScore} />,
    }),
    ...(pageScoresAvailable
      ? [
          col.accessor((row) => row.pageScore ?? undefined, {
            id: "pageScore",
            header: "Page Score",
            cell: (info) => {
              const score = info.row.original.pageScore;
              return (
                <span
                  className="text-xs tabular-nums text-muted-foreground"
                  title={
                    score === null
                      ? "DataForSEO's index holds no rank for this exact URL. Common, and not the same as a score of zero."
                      : `Page Score ${Math.round(score)} of 100 for this URL.`
                  }
                >
                  {score === null ? EM_DASH : Math.round(score)}
                </span>
              );
            },
          }),
        ]
      : []),
    col.accessor((row) => row.estTraffic ?? undefined, {
      id: "estTraffic",
      header: "Est. traffic",
      cell: (info) => {
        const traffic = info.row.original.estTraffic;
        return traffic === null ? (
          <span
            className="text-muted-foreground"
            title="No traffic estimate for this page. A min-traffic filter drops these rows, since an unmeasured page cannot be said to meet a floor."
          >
            {EM_DASH}
          </span>
        ) : (
          <span className="tabular-nums">{formatTraffic(traffic)}</span>
        );
      },
    }),
    col.accessor((row) => row.keywords.length, {
      id: "keywords",
      header: "Keywords",
      cell: (info) => (
        <KeywordsCell
          keywords={info.row.original.keywords}
          label={displayPath(info.row.original.url)}
        />
      ),
    }),
    col.accessor("totalVolume", {
      header: "Total volume",
      cell: (info) => (
        <span className="tabular-nums">{formatCount(info.getValue<number>())}</span>
      ),
    }),
    col.display({
      id: "wordCount",
      header: "Words",
      cell: (info) => <WordCountCell row={info.row.original} />,
    }),
    col.display({
      id: "actions",
      header: "",
      cell: (info) => <RowActions row={info.row.original} />,
    }),
  ];
}

/* ---------------------------------- table ---------------------------------- */

export function ContentTable({
  rows,
  pageScoresAvailable,
  loading,
  caption,
  emptyState,
  selected,
  onToggle,
  onToggleAll,
  onViewSerp,
  onCopyUrl,
  wordCounts,
  counting,
}: {
  rows: ReadonlyArray<ContentPageRow>;
  pageScoresAvailable: boolean;
  loading: boolean;
  caption: string;
  emptyState: React.ReactNode;
  selected: ReadonlySet<string>;
  onToggle: (url: string) => void;
  onToggleAll: (checked: boolean) => void;
  onViewSerp: (row: ContentPageRow) => void;
  onCopyUrl: (row: ContentPageRow) => void;
  wordCounts: ReadonlyMap<string, number | null>;
  counting: boolean;
}) {
  const columns = useMemo(
    () => buildColumns(pageScoresAvailable),
    [pageScoresAvailable],
  );

  return (
    <RowContext.Provider
      value={{
        rows,
        selected,
        onToggle,
        onToggleAll,
        onViewSerp,
        onCopyUrl,
        wordCounts,
        counting,
      }}
    >
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        caption={caption}
        emptyState={emptyState}
        pageSize={25}
        maxHeight="40rem"
      />
    </RowContext.Provider>
  );
}
