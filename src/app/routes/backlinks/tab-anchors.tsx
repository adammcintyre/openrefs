/**
 * Anchors — the words other people use when they link here.
 *
 * The column that earns its place beside "Backlinks" is "Referring domains": a
 * thousand links carrying the same anchor from one site is a footer, while
 * thirty from thirty sites is a reputation. Showing only the link count would
 * make those two look alike.
 *
 * An empty anchor is a real and common thing — image links and bare-URL links
 * both produce one — so it is labelled as such rather than rendered as an em
 * dash, which would read as data the provider failed to return.
 */
import { Quote } from "lucide-react";
import { useMemo } from "react";

import type { AnchorRow } from "../../../shared/backlinks";
import {
  dofollowTitle,
  formatAnchor,
  formatDofollow,
} from "../../components/backlinks/format";
import { aggregateMeta, formatCount } from "../../components/domains/format";
import {
  DataTable,
  EmptyState,
  cn,
  createDataTableColumns,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { ANCHOR_CSV_HEADERS, anchorCsvRows, csvFilename } from "./csv-rows";
import { PAGE_SIZE, useAnchors } from "./queries";
import { LoadMoreBar, TabShell } from "./tab-shell";

const col = createDataTableColumns<AnchorRow>();

const columns = [
  col.accessor((row) => row.anchor, {
    id: "anchor",
    header: "Anchor",
    sortFn: "text",
    cell: (info) => {
      const anchor = info.getValue();
      const text = formatAnchor(anchor);
      return (
        <span
          title={text}
          className={cn(
            "block max-w-[28rem] truncate",
            anchor === null || anchor.trim() === ""
              ? "text-muted-foreground italic"
              : "font-medium text-foreground",
          )}
        >
          {text}
        </span>
      );
    },
  }),
  col.accessor((row) => row.backlinks, {
    id: "backlinks",
    header: "Backlinks",
    sortFn: "alphanumeric",
    cell: (info) => (
      <span className="tabular-nums">{formatCount(info.getValue())}</span>
    ),
  }),
  col.accessor((row) => row.referringDomains, {
    id: "referringDomains",
    header: "Referring domains",
    sortFn: "alphanumeric",
    cell: (info) => (
      <span className="tabular-nums">{formatCount(info.getValue())}</span>
    ),
  }),
  col.accessor((row) => row.dofollow.dofollowRatio, {
    id: "dofollow",
    header: "Dofollow",
    sortFn: "alphanumeric",
    cell: (info) => (
      <span
        className="tabular-nums"
        title={dofollowTitle(info.row.original.dofollow)}
      >
        {formatDofollow(info.row.original.dofollow)}
      </span>
    ),
  }),
];

export function AnchorsTab({
  workspaceId,
  target,
}: {
  workspaceId: string | null;
  target: string;
}) {
  const query = useAnchors(workspaceId, target, true);

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const meta = useMemo(
    () => aggregateMeta(query.data?.pages ?? []),
    [query.data],
  );
  const total = query.data?.pages[0]?.totalCount ?? null;

  return (
    <TabShell
      heading="Anchors"
      description="The anchor text pointing at this target, most-linked first."
      meta={meta}
      error={query.error}
      onRetry={() => void query.refetch()}
      onExport={() =>
        downloadCsv(
          csvFilename("anchors", target),
          ANCHOR_CSV_HEADERS,
          anchorCsvRows(rows),
        )
      }
      exportDisabled={rows.length === 0}
      footer={
        <LoadMoreBar
          loaded={rows.length}
          total={total}
          hasMore={query.hasNextPage}
          isFetching={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          pageSize={PAGE_SIZE}
        />
      }
    >
      <DataTable
        caption={`Anchor text linking to ${target}`}
        columns={columns}
        data={rows}
        loading={query.isPending}
        emptyState={
          <EmptyState
            icon={Quote}
            title="No anchors found"
            description="DataForSEO has no anchor text on record for links to this target."
          />
        }
      />
    </TabShell>
  );
}
