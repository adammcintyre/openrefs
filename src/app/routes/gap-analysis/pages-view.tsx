/**
 * The Pages view: which keywords a set of URLs rank for together.
 *
 * Kept out of `gap-page.tsx` because it shares almost nothing with the keyword
 * view but the market — different endpoint, different input, different table,
 * and no mode. What it does *not* own is the SERP panel: the parent holds one,
 * and both views raise a keyword to it rather than each mounting their own.
 *
 * One upstream call per comparison, not one per compared page —
 * `page_intersection` takes the whole set at once. So this view is materially
 * cheaper than the keyword view and its "Load more" says so.
 */
import { Layers, SearchX } from "lucide-react";
import { useMemo } from "react";

import type { GapPageRow } from "../../../shared/gap";
import { aggregateMeta, formatCount } from "../../components/domains/format";
import { ResultMetaChip } from "../../components/domains/result-meta-chip";
import {
  ApiErrorNotice,
  isConfigurationError,
  useApiErrorToast,
} from "../../components/keywords/api-error-notice";
import { Button, Card, EmptyState } from "../../components/ui";
import { GapPagesForm } from "./pages-form";
import type { GapPagesSubmit } from "./pages-form";
import { GapPagesTable } from "./pages-table";
import { PAGE_SIZE, useGapPages } from "./queries";
import type { GapSearch } from "./url-state";
import { isGapPagesSearchable } from "./url-state";

export function GapPagesView({
  workspaceId,
  search,
  onSubmit,
  onViewSerp,
}: {
  workspaceId: string | null;
  search: GapSearch;
  onSubmit: (next: GapPagesSubmit) => void;
  onViewSerp: (row: GapPageRow) => void;
}) {
  const ready = isGapPagesSearchable(search);
  const query = useGapPages(workspaceId, search, ready);

  useApiErrorToast(query.error, "Page comparison failed");

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const meta = useMemo(
    () => aggregateMeta(query.data?.pages ?? []),
    [query.data],
  );
  const total = query.data?.pages[0]?.totalCount ?? null;
  const blocking = isConfigurationError(query.error);

  return (
    <div className="flex flex-col gap-4">
      <GapPagesForm
        workspaceId={workspaceId}
        value={search}
        onSubmit={onSubmit}
        busy={query.isFetching && !query.isFetchingNextPage}
      />

      {!ready ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="Compare pages, not domains"
            description="Paste the URLs of a few pages competing for the same subject — yours and your rivals' — and see every keyword they rank for side by side. Unlike the keyword views this one has no “you”: each page is simply one of the set, so there is no Missing or Weak to filter by."
          />
        </Card>
      ) : blocking ? (
        <ApiErrorNotice error={query.error} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {`Keywords these ${formatCount(search.pages.length)} pages rank for, in one comparison — one DataForSEO call for the whole set, however many pages are in it.`}
            </p>
            <ResultMetaChip meta={meta} />
          </div>

          {query.error !== null && !blocking ? (
            <ApiErrorNotice
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          ) : null}

          <GapPagesTable
            rows={rows}
            pages={search.pages}
            loading={query.isPending}
            caption={`Keywords shared by ${search.pages.join(", ")}`}
            onViewSerp={onViewSerp}
            emptyState={
              <EmptyState
                icon={SearchX}
                title="No shared keywords"
                description="DataForSEO holds no keywords that these pages rank for in this market. Pages that compete on the same subject usually overlap — if these do not, check that the URLs are the exact addresses that rank, redirects and all."
              />
            }
          />

          {rows.length > 0 || query.hasNextPage ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {total === null
                  ? `${formatCount(rows.length)} keywords loaded`
                  : `${formatCount(rows.length)} shown of ${formatCount(total)}`}
              </p>
              {query.hasNextPage ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                  title="Fetches the next page from DataForSEO — one call for the whole set of pages."
                >
                  {`Load ${PAGE_SIZE} more`}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Everything loaded
                </span>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
