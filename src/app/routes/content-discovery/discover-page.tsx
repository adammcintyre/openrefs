/**
 * Content Discovery — the screen.
 *
 * The question: **which pages win traffic without much authority?** Those are
 * the topics a small site can realistically take, so the unit of the table is a
 * page rather than a keyword.
 *
 * The cost model shapes the layout, as it does in every research module, but in
 * the opposite direction to Gap Analysis. There, every control spends, so every
 * control is explicit and warned about. Here, exactly two things spend — the
 * Discover button and "Count words" — and *everything else is free*, because
 * the Worker composes the deduplicated set once per (topic, market, expansion)
 * and filters, sorts and pages over its own cache. So the filters invite
 * fiddling, "Load more" carries no price, and the two controls that do spend
 * are the two that carry figures.
 */
import { Compass, Download, FileText, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import type { ContentPageRow, ContentSort } from "../../../shared/content";
import {
  CONTENT_SORTS,
  CONTENT_WORDCOUNT_MAX_URLS,
} from "../../../shared/content";
import { formatWordCountHint } from "../../components/content/cost";
import type { ContentFilters } from "../../components/content/filters";
import { EMPTY_CONTENT_FILTERS } from "../../components/content/filters";
import { formatCount } from "../../components/domains/format";
import { marketLabel } from "../../components/domains/market-options";
import {
  readLastMarket,
  writeLastMarket,
} from "../../components/domains/market-storage";
import { useMetaLocations } from "../../components/domains/meta-queries";
import {
  ApiErrorNotice,
  isConfigurationError,
  useApiErrorToast,
} from "../../components/keywords/api-error-notice";
import { SerpPanel } from "../../components/serp-panel";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { useActiveWorkspace } from "../../lib/workspaces";
import { ContentTable } from "./content-table";
import {
  contentCsvFilename,
  contentCsvHeaders,
  contentCsvRows,
} from "./csv-rows";
import { ContentFilterRow } from "./filter-row";
import { PAGE_SIZE, useContentDiscover, useContentWordCount } from "./queries";
import { ContentSearchForm } from "./search-form";
import type { ContentSubmit } from "./search-form";
import { ContentSummaryStrip } from "./summary-strip";
import {
  DEFAULT_MARKET,
  contentSearchKey,
  contentSearchParams,
  isContentSearchable,
  readContentSearch,
} from "./url-state";

const SORT_LABELS: Record<ContentSort, string> = {
  estTraffic: "Most traffic",
  domainScore: "Highest Domain Score",
  totalVolume: "Most search volume",
};

export function ContentDiscoveryPage() {
  const [params, setParams] = useSearchParams();
  const { activeWorkspaceId, isPending: workspacesPending } =
    useActiveWorkspace();
  const { toast } = useToast();

  const fallbackMarket = useMemo(
    () => readLastMarket(activeWorkspaceId) ?? DEFAULT_MARKET,
    [activeWorkspaceId],
  );

  const search = readContentSearch(params, fallbackMarket);
  const ready = isContentSearchable(search);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [serpKeyword, setSerpKeyword] = useState<string | null>(null);
  /**
   * Word counts bought since the sweep, by URL.
   *
   * Component state rather than a patch into the query cache: the counts are a
   * different purchase from the composition, and writing them into the cached
   * discover pages would make a refetch silently drop them.
   */
  const [wordCounts, setWordCounts] = useState<ReadonlyMap<string, number | null>>(
    new Map(),
  );

  const query = useContentDiscover(activeWorkspaceId, search, ready);
  const wordCount = useContentWordCount(activeWorkspaceId);
  const locationsQuery = useMetaLocations(activeWorkspaceId);

  useApiErrorToast(query.error, "Content discovery failed");

  /*
   * A selection and a set of word counts only mean something against the
   * composition they were made from. A new topic, market or expansion is a
   * different set of pages, so both are dropped rather than silently carried
   * into a table where the URLs no longer appear. Filters and sort are
   * deliberately not part of this key — they are views over rows already paid
   * for, and losing your selection because you nudged a filter would be
   * infuriating.
   */
  const compositionKey = contentSearchKey(search);
  const [syncedKey, setSyncedKey] = useState(compositionKey);
  if (compositionKey !== syncedKey) {
    setSyncedKey(compositionKey);
    setSelected(new Set());
    setWordCounts(new Map());
  }

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const first = query.data?.pages[0];
  const pageScoresAvailable = first?.pageScoresAvailable ?? false;
  const filteredOut = first?.filteredOut ?? 0;
  const matchingCount =
    first === undefined ? null : first.totalCount - first.filteredOut;
  const filtersActive = Object.keys(search.filters).length > 0;

  /** The whole-set cost lives on every page; the first is as good as any. */
  const costs = first?.costs;

  const applySearch = useCallback(
    (next: ContentSubmit) => {
      writeLastMarket(activeWorkspaceId, {
        location: next.location,
        language: next.language,
      });
      // A new sweep starts unfiltered: a Domain Score cap carried silently onto
      // a different topic is a filtered report that looks like a thin one.
      setParams(
        contentSearchParams({
          ...next,
          sort: search.sort,
          filters: EMPTY_CONTENT_FILTERS,
        }),
      );
    },
    [activeWorkspaceId, setParams, search.sort],
  );

  /** Filters and sort `replace`: neither is a step anyone wants to unwind. */
  const patchSearch = useCallback(
    (patch: Partial<{ filters: ContentFilters; sort: ContentSort }>) => {
      setParams(contentSearchParams({ ...search, ...patch }), { replace: true });
    },
    [search, setParams],
  );

  const onToggle = useCallback((url: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  const onToggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((row) => row.url)) : new Set());
    },
    [rows],
  );

  const onViewSerp = useCallback((row: ContentPageRow) => {
    const best = row.keywords[0]?.keyword;
    if (best !== undefined) setSerpKeyword(best);
  }, []);

  const onCopyUrl = useCallback(
    (row: ContentPageRow) => {
      /*
       * `navigator.clipboard` needs a secure context and can be refused, so the
       * failure path says so rather than leaving the user believing they have
       * a URL on their clipboard.
       */
      void navigator.clipboard
        ?.writeText(row.url)
        .then(() => toast({ tone: "success", title: "URL copied" }))
        .catch(() =>
          toast({
            tone: "error",
            title: "Could not copy",
            description: "Your browser refused clipboard access. Select the URL and copy it manually.",
          }),
        );
    },
    [toast],
  );

  const selectedUrls = useMemo(() => [...selected], [selected]);
  const overWordCountCap = selectedUrls.length > CONTENT_WORDCOUNT_MAX_URLS;

  async function countWords() {
    const batch = selectedUrls.slice(0, CONTENT_WORDCOUNT_MAX_URLS);
    if (batch.length === 0) return;
    try {
      const result = await wordCount.mutateAsync(batch);
      setWordCounts((current) => {
        const next = new Map(current);
        for (const item of result.items) next.set(item.url, item.wordCount);
        return next;
      });
      toast({
        tone: result.counted === 0 ? "info" : "success",
        title: `Counted ${formatCount(result.counted)} of ${formatCount(result.submitted)} pages`,
        description:
          result.counted === result.submitted
            ? undefined
            : "The rest refused the crawler or had no parseable article body.",
      });
    } catch (error) {
      if (isConfigurationError(error)) {
        // Already surfaced as a blocking notice on the page; a toast as well
        // would read as two separate problems.
        return;
      }
      toast({
        tone: "error",
        title: "Could not count words",
        description: "That lookup failed. Nothing was added to the table.",
      });
    }
  }

  function exportCsv() {
    downloadCsv(
      contentCsvFilename(search),
      contentCsvHeaders(pageScoresAvailable),
      contentCsvRows(rows, { pageScoresAvailable, wordCounts }),
    );
  }

  const marketName = marketLabel(
    locationsQuery.data?.locations ?? [],
    search.location,
    search.language,
  );

  const blocking = isConfigurationError(query.error);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Content Discovery"
        description="Pages winning traffic without much authority — the topics a smaller site can realistically take."
        actions={ready ? <Badge variant="brand">{marketName}</Badge> : undefined}
      />

      {workspacesPending ? (
        <Skeleton className="h-28 w-full" />
      ) : activeWorkspaceId === null ? (
        <Card>
          <EmptyState
            title="No workspace"
            description="Create or join a workspace before running research."
          />
        </Card>
      ) : (
        <>
          <ContentSearchForm
            workspaceId={activeWorkspaceId}
            value={search}
            onSubmit={applySearch}
            busy={query.isFetching && !query.isFetchingNextPage}
          />

          {!ready ? (
            <Card>
              <EmptyState
                icon={Compass}
                title="Start with a topic"
                description="We fetch the search results for it — and, if you ask, for its top related searches — then deduplicate every ranking page and score it for authority and traffic. What comes back is the pages that are winning without a big site behind them."
              />
            </Card>
          ) : blocking ? (
            <ApiErrorNotice error={query.error} />
          ) : (
            <>
              <ContentSummaryStrip
                rows={rows}
                matchingCount={matchingCount}
                filteredOut={filteredOut}
                costs={costs}
                cached={first?.cached}
                stale={first?.stale}
                loading={query.isPending}
              />

              {/*
                What the sweep is made of. Shown because a page someone expected
                to see may simply not have been searched for — and that is a
                fact about the query, not a fault in the results.
              */}
              {first !== undefined && first.keywordsSearched.length > 1 ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {`Built from ${formatCount(first.keywordsSearched.length)} searches: ${first.keywordsSearched.join(", ")}.`}
                </p>
              ) : null}

              <ContentFilterRow
                filters={search.filters}
                onApply={(filters) => patchSearch({ filters })}
                disabled={query.isPending}
              />

              {query.error !== null && !blocking ? (
                <ApiErrorNotice
                  error={query.error}
                  onRetry={() => void query.refetch()}
                />
              ) : null}

              <div className="flex flex-wrap items-end justify-between gap-3">
                <Field label="Order by" className="w-56">
                  {(field) => (
                    <Select
                      {...field}
                      value={search.sort}
                      disabled={query.isPending}
                      onChange={(event) =>
                        patchSearch({ sort: event.target.value as ContentSort })
                      }
                    >
                      {CONTENT_SORTS.map((option) => (
                        <option key={option} value={option}>
                          {SORT_LABELS[option]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={exportCsv}
                  disabled={rows.length === 0}
                  title="Exports the rows loaded here, including any word counts you have bought."
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  {`Export ${formatCount(rows.length)} rows`}
                </Button>
              </div>

              {/* Bulk bar — present only when there is a selection. */}
              {selected.size > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-app border border-primary/40 bg-tint p-3">
                  <p
                    className="text-sm font-medium text-tint-foreground"
                    aria-live="polite"
                  >
                    {`${formatCount(selected.size)} page${selected.size === 1 ? "" : "s"} selected`}
                    {overWordCountCap
                      ? ` — counting is capped at ${CONTENT_WORDCOUNT_MAX_URLS}, so the first ${CONTENT_WORDCOUNT_MAX_URLS} will be counted`
                      : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      loading={wordCount.isPending}
                      onClick={() => void countWords()}
                      title={`Fetches each page and counts the words in its article body — headers, footers and comments excluded. One paid request per URL, ${formatWordCountHint()}.`}
                    >
                      <FileText className="size-3.5" aria-hidden="true" />
                      {`Count words (${formatWordCountHint()})`}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelected(new Set())}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                      Clear
                    </Button>
                  </div>
                </div>
              ) : null}

              <ContentTable
                rows={rows}
                pageScoresAvailable={pageScoresAvailable}
                loading={query.isPending}
                caption={`Pages ranking for ${search.topic}`}
                selected={selected}
                onToggle={onToggle}
                onToggleAll={onToggleAll}
                onViewSerp={onViewSerp}
                onCopyUrl={onCopyUrl}
                wordCounts={wordCounts}
                counting={wordCount.isPending}
                emptyState={
                  filtersActive ? (
                    <EmptyState
                      icon={SlidersHorizontal}
                      title="No pages matched — loosen the Domain Score cap?"
                      description={
                        filteredOut > 0
                          ? `${formatCount(filteredOut)} pages were found for this topic and every one of them was filtered out. Raising the cap or lowering the traffic floor costs nothing — these filters are applied to results already fetched.`
                          : "Nothing survived these filters. Widening them costs nothing — they are applied to results already fetched."
                      }
                      action={
                        <Button
                          size="sm"
                          onClick={() =>
                            patchSearch({ filters: EMPTY_CONTENT_FILTERS })
                          }
                        >
                          Clear filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={SearchX}
                      title="No pages found for this topic"
                      description="The search results for this topic came back empty in this market. Try a broader topic, or expand it into related searches to widen the net."
                    />
                  )
                }
              />

              {rows.length > 0 || query.hasNextPage ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {matchingCount === null
                      ? `${formatCount(rows.length)} pages loaded`
                      : `${formatCount(rows.length)} shown of ${formatCount(matchingCount)} matching`}
                  </p>
                  {query.hasNextPage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={query.isFetchingNextPage}
                      onClick={() => void query.fetchNextPage()}
                      // No cost hint, because there is no cost: the next page
                      // comes out of the same composed set the first one did.
                      title="Reads the next page from the set already fetched — no DataForSEO call, no charge."
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
        </>
      )}

      <SerpPanel
        workspaceId={activeWorkspaceId ?? ""}
        keyword={serpKeyword ?? ""}
        locationCode={search.location}
        languageCode={search.language}
        open={serpKeyword !== null}
        onClose={() => setSerpKeyword(null)}
      />
    </div>
  );
}
