/**
 * Top keywords — what the domain ranks for, and what that is worth.
 *
 * The organic/paid control looks like a filter and is not one. `paid=true`
 * changes `item_types` upstream, so the two sides are separate purchases with
 * separate cache entries; DataForSEO will not even sort or filter by a result
 * type that was not requested. The switch is therefore a query-key change, and
 * the note under it says so, because a control that silently spends is a
 * control users learn to distrust.
 */
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { DomainKeywordRow } from "../../../shared/domains";
import {
  EM_DASH,
  aggregateMeta,
  formatCount,
  formatCpc,
  formatTraffic,
  urlPath,
} from "../../components/domains/format";
import { SerpPanel } from "../../components/serp-panel";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  cn,
  createDataTableColumns,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { KEYWORD_CSV_HEADERS, csvFilename, keywordCsvRows } from "./csv-rows";
import type { FilterDraft, KeywordFilters } from "./keyword-filters";
import {
  EMPTY_DRAFT,
  EMPTY_FILTERS,
  activeFilterCount,
  isDraftEmpty,
  parseFilterDraft,
  toFilterDraft,
} from "./keyword-filters";
import { PAGE_SIZE, useDomainKeywords } from "./queries";
import { LoadMoreBar, TabShell } from "./tab-shell";
import type { DomainSearch } from "./url-state";

const col = createDataTableColumns<DomainKeywordRow>();

export function KeywordsTab({
  workspaceId,
  search,
  paid,
  onPaidChange,
  filters,
  onFiltersChange,
}: {
  workspaceId: string | null;
  search: DomainSearch;
  paid: boolean;
  onPaidChange: (paid: boolean) => void;
  filters: KeywordFilters;
  onFiltersChange: (filters: KeywordFilters) => void;
}) {
  const [draft, setDraft] = useState<FilterDraft>(() => toFilterDraft(filters));
  const [serpKeyword, setSerpKeyword] = useState<string | null>(null);

  const query = useDomainKeywords(workspaceId, search, {
    paid,
    filters,
    enabled: true,
  });

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const meta = useMemo(
    () => aggregateMeta(query.data?.pages ?? []),
    [query.data],
  );
  const total = query.data?.pages[0]?.totalCount ?? null;
  const filterCount = activeFilterCount(filters);

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
      col.accessor((row) => row.position, {
        id: "position",
        header: "Position",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatCount(info.getValue())}</span>
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
      col.accessor((row) => row.traffic, {
        id: "traffic",
        header: "Est. traffic",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatTraffic(info.getValue())}</span>
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
      col.accessor((row) => row.url, {
        id: "url",
        header: "Ranking URL",
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
              // The path is what differs between rows; the full URL stays
              // reachable as the tooltip and the link target.
              title={url}
              className="block max-w-[20rem] truncate text-primary hover:underline"
            >
              {urlPath(url)}
            </a>
          );
        },
      }),
      col.display({
        id: "serp",
        header: "SERP",
        enableSorting: false,
        cell: (info) => {
          const { keyword } = info.row.original;
          if (keyword === null || keyword === "") return null;
          return (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSerpKeyword(keyword)}
            >
              View SERP
            </Button>
          );
        },
      }),
    ],
    [],
  );

  const applyDraft = () => onFiltersChange(parseFilterDraft(draft));
  const clearDraft = () => {
    setDraft(EMPTY_DRAFT);
    onFiltersChange(EMPTY_FILTERS);
  };

  return (
    <>
      <TabShell
        heading={paid ? "Top paid keywords" : "Top organic keywords"}
        description={
          paid
            ? "Keywords this domain bids on, with the ad landing page."
            : "Keywords this domain ranks for organically, best positions first."
        }
        meta={meta}
        error={query.error}
        onRetry={() => void query.refetch()}
        onExport={() =>
          downloadCsv(
            csvFilename("top-keywords", search, paid ? "paid" : "organic"),
            KEYWORD_CSV_HEADERS,
            keywordCsvRows(rows),
          )
        }
        exportDisabled={rows.length === 0}
        controls={
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div
                role="group"
                aria-label="Keyword type"
                className="inline-flex rounded-app border border-border p-0.5"
              >
                {[
                  { id: "organic", label: "Organic", value: false },
                  { id: "paid", label: "Paid", value: true },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={paid === option.value}
                    onClick={() => onPaidChange(option.value)}
                    className={cn(
                      "rounded-app px-3 py-1 text-xs font-medium transition-colors",
                      paid === option.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Organic and paid are separate DataForSEO queries — the first
                switch each way fetches fresh data and bills a call.
              </p>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                applyDraft();
              }}
              className="rounded-app border border-border bg-surface-muted p-4"
            >
              <div className="flex items-center gap-2 pb-3">
                <p className="text-xs font-semibold text-foreground">Filters</p>
                {filterCount > 0 ? (
                  <Badge variant="brand">{filterCount} active</Badge>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Min volume">
                  {(field) => (
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draft.minVolume}
                      onChange={(event) =>
                        setDraft({ ...draft, minVolume: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label="Max volume">
                  {(field) => (
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draft.maxVolume}
                      onChange={(event) =>
                        setDraft({ ...draft, maxVolume: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label="Best position">
                  {(field) => (
                    <Input
                      {...field}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={draft.minPosition}
                      onChange={(event) =>
                        setDraft({ ...draft, minPosition: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label="Worst position">
                  {(field) => (
                    <Input
                      {...field}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={draft.maxPosition}
                      onChange={(event) =>
                        setDraft({ ...draft, maxPosition: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label="Keyword contains">
                  {(field) => (
                    <Input
                      {...field}
                      value={draft.include}
                      placeholder="e.g. template"
                      onChange={(event) =>
                        setDraft({ ...draft, include: event.target.value })
                      }
                    />
                  )}
                </Field>
                <Field label="Keyword excludes">
                  {(field) => (
                    <Input
                      {...field}
                      value={draft.exclude}
                      placeholder="e.g. free"
                      onChange={(event) =>
                        setDraft({ ...draft, exclude: event.target.value })
                      }
                    />
                  )}
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" type="submit">
                  Apply filters
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={clearDraft}
                  disabled={filterCount === 0 && isDraftEmpty(draft)}
                >
                  Clear
                </Button>
                <p className="text-xs text-muted-foreground">
                  Filters are applied by DataForSEO, so each change is a new
                  query.
                </p>
              </div>
            </form>
          </div>
        }
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
          caption={`${paid ? "Paid" : "Organic"} keywords for ${search.target}`}
          columns={columns}
          data={rows}
          loading={query.isPending}
          emptyState={
            <EmptyState
              icon={Search}
              title={
                paid
                  ? "No paid keywords found"
                  : "No organic keywords found"
              }
              description={
                filterCount > 0
                  ? "No keywords matched these filters in this market. Try widening them."
                  : paid
                    ? "DataForSEO has no record of this domain running ads in this market."
                    : "This domain has no tracked organic rankings in this market."
              }
            />
          }
        />
      </TabShell>

      <SerpPanel
        workspaceId={workspaceId ?? ""}
        keyword={serpKeyword ?? ""}
        locationCode={search.location}
        languageCode={search.language}
        open={serpKeyword !== null}
        onClose={() => setSerpKeyword(null)}
      />
    </>
  );
}
