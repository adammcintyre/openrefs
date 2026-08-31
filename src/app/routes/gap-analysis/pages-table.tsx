/**
 * The page-gap table: one row per keyword, one column per compared URL.
 *
 * The same convention as `gap-table.tsx` and for the same reason — **a missing
 * position is a dash, never a 0.** `position: null` means "this page does not
 * rank for this keyword in the results DataForSEO holds", and 0 would be the
 * best possible rank: the exact inversion.
 *
 * What differs from the keyword table is that there is **no "you"**. Every URL
 * here is just one of the compared set, which is why this view carries no mode
 * tabs: `missing` and `weak` are defined against a target, and there isn't one.
 *
 * Column headers are the page's path rather than its whole URL — twenty
 * absolute URLs across a header row is unreadable — with the full URL in a
 * title, since two compared pages can easily share a path across two domains.
 */
import type { ReactNode } from "react";
import { useMemo } from "react";

import type { GapPageRow } from "../../../shared/gap";
import { displayPath, safeHttpUrl } from "../../components/content/safe-url";
import { EM_DASH, formatCount, formatTraffic } from "../../components/domains/format";
import { DifficultyBadge, IntentBadge } from "../../components/keywords/chips";
import { formatCpc } from "../../components/keywords/format";
import { Button, DataTable, createDataTableColumns } from "../../components/ui";

const col = createDataTableColumns<GapPageRow>();

/** A rank, or the fact that there isn't one. */
function PositionCell({ position }: { position: number | null }) {
  if (position === null) {
    return (
      <span
        className="text-muted-foreground"
        title="This page does not rank for this keyword"
      >
        {EM_DASH}
      </span>
    );
  }
  return <span className="tabular-nums">{formatCount(position)}</span>;
}

/**
 * The header for one compared page.
 *
 * A link, because the whole point of this table is comparing real pages and the
 * fastest way to understand a column is to open it. Safe-schemed like every
 * other third-party URL in the app — these came from the user's paste box, but
 * they reach an `href` the same way a scraped one would.
 */
function PageHeaderCell({ url, index }: { url: string; index: number }) {
  const href = safeHttpUrl(url);
  const label = displayPath(url);

  return (
    <span className="inline-flex flex-col" title={url}>
      <span className="text-[0.65rem] font-normal uppercase tracking-wide opacity-70">
        {`Page ${index + 1}`}
      </span>
      {href === null ? (
        <span className="max-w-40 truncate">{label}</span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-40 truncate underline-offset-2 hover:text-primary hover:underline"
        >
          {label}
        </a>
      )}
    </span>
  );
}

export function GapPagesTable({
  rows,
  pages,
  loading,
  caption,
  onViewSerp,
  emptyState,
}: {
  rows: ReadonlyArray<GapPageRow>;
  /** The requested page URLs, in column order. */
  pages: ReadonlyArray<string>;
  loading: boolean;
  caption: string;
  onViewSerp: (row: GapPageRow) => void;
  emptyState?: ReactNode;
}) {
  const columns = useMemo(
    () => [
      col.accessor((row) => row.keyword, {
        id: "keyword",
        header: "Keyword",
        sortFn: "text",
        cell: (info) => (
          <span className="font-medium text-foreground">
            {info.getValue() ?? EM_DASH}
          </span>
        ),
      }),
      col.accessor((row) => row.searchVolume, {
        id: "searchVolume",
        header: "Volume",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatCount(info.getValue())}</span>
        ),
      }),
      col.accessor((row) => row.cpc, {
        id: "cpc",
        header: "CPC",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatCpc(info.getValue())}</span>
        ),
      }),
      col.accessor((row) => row.keywordDifficulty, {
        id: "difficulty",
        header: "Difficulty",
        sortFn: "alphanumeric",
        cell: (info) => <DifficultyBadge value={info.getValue()} />,
      }),
      col.accessor((row) => row.intent, {
        id: "intent",
        header: "Intent",
        sortFn: "text",
        cell: (info) => <IntentBadge intent={info.getValue()} />,
      }),
      /*
       * One column per compared page, keyed by index into the row's own `pages`
       * array — the API guarantees that array is in the order the URLs were
       * requested, which is the order these headers are in. A page that ranks
       * for nothing still gets its column: an absent one would read as "this
       * page was not part of the comparison", a different and wrong claim.
       */
      ...pages.map((url, index) =>
        col.accessor((row) => row.pages[index]?.position ?? null, {
          id: `page-${index}`,
          header: () => <PageHeaderCell url={url} index={index} />,
          sortFn: "alphanumeric",
          cell: (info) => (
            <div className="flex flex-col gap-0.5">
              <PositionCell position={info.getValue()} />
              {/*
                Traffic under the rank, because a position means little without
                it: #4 on a keyword worth 12 visits is not the same find as #4
                on one worth 1,200.
              */}
              {info.row.original.pages[index]?.traffic == null ? null : (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatTraffic(info.row.original.pages[index]?.traffic)}
                </span>
              )}
            </div>
          ),
        }),
      ),
      col.display({
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: (info) => {
          const row = info.row.original;
          if (row.keyword === "") return null;
          return (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onViewSerp(row)}
              aria-label={`View SERP for ${row.keyword}`}
            >
              View SERP
            </Button>
          );
        },
      }),
    ],
    [pages, onViewSerp],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      caption={caption}
      emptyState={emptyState}
      maxHeight="40rem"
    />
  );
}
