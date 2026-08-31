/**
 * Top pages — which URLs on the domain actually earn the traffic.
 */
import { FileText } from "lucide-react";
import { useMemo } from "react";

import type { DomainPageRow } from "../../../shared/domains";
import {
  EM_DASH,
  aggregateMeta,
  formatCount,
  formatTraffic,
  urlPath,
} from "../../components/domains/format";
import {
  DataTable,
  EmptyState,
  createDataTableColumns,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { PAGE_CSV_HEADERS, csvFilename, pageCsvRows } from "./csv-rows";
import type { CacheMode } from "./queries";
import { PAGE_SIZE, useDomainPages } from "./queries";
import { LoadMoreBar, TabShell } from "./tab-shell";
import type { DomainSearch } from "./url-state";

const col = createDataTableColumns<DomainPageRow>();

/**
 * Every row shares the same origin, so the column shows the path and keeps the
 * absolute URL as the tooltip and the link target. Twenty rows of
 * "https://example.com/…" is twenty rows of the same nine characters pushing
 * the part that differs off the edge of the table.
 */
const columns = [
  col.accessor((row) => row.url, {
    id: "url",
    header: "Page",
    sortFn: "text",
    cell: (info) => {
      const url = info.getValue();
      if (url === null || url === "") {
        return <span className="text-muted-foreground">{EM_DASH}</span>;
      }
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          className="block max-w-[28rem] truncate font-medium text-primary hover:underline"
        >
          {urlPath(url)}
        </a>
      );
    },
  }),
  col.accessor((row) => row.organic.traffic, {
    id: "organicTraffic",
    header: "Est. traffic",
    sortFn: "alphanumeric",
    cell: (info) => (
      <span className="tabular-nums">{formatTraffic(info.getValue())}</span>
    ),
  }),
  col.accessor((row) => row.organic.keywordCount, {
    id: "organicKeywords",
    header: "Keywords",
    sortFn: "alphanumeric",
    cell: (info) => (
      <span className="tabular-nums">{formatCount(info.getValue())}</span>
    ),
  }),
];

export function PagesTab({
  workspaceId,
  search,
  cacheMode = "auto",
}: {
  workspaceId: string | null;
  search: DomainSearch;
  /** `stale` on the first load after a history click — see queries.ts. */
  cacheMode?: CacheMode;
}) {
  const query = useDomainPages(workspaceId, search, true, cacheMode);

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
      heading="Top pages"
      description="The domain's pages ranked by estimated organic traffic. Hover a path to see its full URL."
      meta={meta}
      error={query.error}
      onRetry={() => void query.refetch()}
      onExport={() =>
        downloadCsv(
          csvFilename("top-pages", search),
          PAGE_CSV_HEADERS,
          pageCsvRows(rows),
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
        caption={`Top pages for ${search.target}`}
        columns={columns}
        data={rows}
        loading={query.isPending}
        emptyState={
          <EmptyState
            icon={FileText}
            title="No pages found"
            description="DataForSEO has no ranking pages for this domain in this market."
          />
        }
      />
    </TabShell>
  );
}
