/**
 * Gap Analysis — the screen.
 *
 * The URL owns the comparison (`?target=&competitors=&location=&language=&mode=`)
 * so this component is mostly a translator: query string in, four mode tabs out.
 *
 * The cost model is what shapes the layout. One comparison is one upstream call
 * **per competitor** — two per competitor in `all` mode — so every control that
 * spends is explicit (Compare, Load more, a filter Apply), the running total is
 * on screen next to the rows it paid for, and the expensive tab says so before
 * you open it rather than after.
 */
import { Download, GitCompareArrows, Layers, Search, SearchX, SlidersHorizontal, Users, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import type { GapKeywordRow, GapPageRow } from "../../../shared/gap";
import { GAP_MODES, GAP_MODE_DESCRIPTIONS } from "../../../shared/gap";
import type { GapMode } from "../../../shared/gap";
import { aggregateMeta, formatCount } from "../../components/domains/format";
import { marketLabel } from "../../components/domains/market-options";
import {
  readLastMarket,
  writeLastMarket,
} from "../../components/domains/market-storage";
import { useMetaLocations } from "../../components/domains/meta-queries";
import { ResultMetaChip } from "../../components/domains/result-meta-chip";
import { AddToCollectionDialog } from "../../components/keywords/add-to-collection-dialog";
import {
  ApiErrorNotice,
  isConfigurationError,
  useApiErrorToast,
} from "../../components/keywords/api-error-notice";
import { AnchorButton } from "../../components/keywords/link-button";
import type { KeywordToAdd } from "../../components/keywords/queries";
import { SerpPanel } from "../../components/serp-panel";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Tabs,
} from "../../components/ui";
import type { TabItem } from "../../components/ui";
import { useActiveWorkspace } from "../../lib/workspaces";
import type { GapFilterDraft, GapFilters } from "./gap-filters";
import {
  EMPTY_GAP_DRAFT,
  EMPTY_GAP_FILTERS,
  activeGapFilterCount,
  isGapDraftEmpty,
  parseGapFilterDraft,
} from "./gap-filters";
import { GapTable } from "./gap-table";
import type { GapPagesSubmit } from "./pages-form";
import { GapPagesView } from "./pages-view";
import {
  GAP_CSV_MAX_ROWS,
  PAGE_SIZE,
  gapExportUrl,
  useGapKeywords,
} from "./queries";
import { GapSearchForm } from "./search-form";
import type { GapSubmit } from "./search-form";
import type { GapView } from "./url-state";
import {
  DEFAULT_MARKET,
  GAP_VIEWS,
  gapSearchKey,
  gapSearchParams,
  isGapSearchable,
  readGapSearch,
} from "./url-state";

const MODE_LABELS: Record<GapMode, string> = {
  missing: "Missing",
  weak: "Weak",
  untapped: "Untapped",
  all: "All",
};

const VIEW_LABELS: Record<GapView, string> = {
  keywords: "Keywords",
  pages: "Pages",
};

const VIEW_ICONS: Record<GapView, typeof Search> = {
  keywords: Search,
  pages: Layers,
};

/**
 * The view switch.
 *
 * A segmented control rather than two more tabs, because the four mode tabs
 * below already *are* tabs and nesting one tablist inside another is a
 * genuinely confusing thing to hand a screen reader. This is a radio group:
 * two mutually exclusive views of the module, announced as such.
 */
function ViewSwitch({
  value,
  onChange,
}: {
  value: GapView;
  onChange: (view: GapView) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Compare"
      className="inline-flex rounded-app border border-border bg-surface-muted p-1"
    >
      {GAP_VIEWS.map((view) => {
        const Icon = VIEW_ICONS[view];
        const active = view === value;
        return (
          <button
            key={view}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(view)}
            className={
              active
                ? "inline-flex items-center gap-1.5 rounded-app bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-sm"
                : "inline-flex items-center gap-1.5 rounded-app px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {VIEW_LABELS[view]}
          </button>
        );
      })}
    </div>
  );
}

/** Volume travels with the keyword so a collection snapshot means something. */
function toKeywordsToAdd(rows: ReadonlyArray<GapKeywordRow>): KeywordToAdd[] {
  return rows.map((row) => ({
    keyword: row.keyword,
    volumeSnapshot: row.searchVolume,
  }));
}

export function GapAnalysisPage() {
  const [params, setParams] = useSearchParams();
  const { activeWorkspaceId, isPending: workspacesPending } =
    useActiveWorkspace();

  // The workspace's last market, so a bare /app/gap-analysis opens where this
  // user works rather than resetting to the UK on every visit.
  const fallbackMarket = useMemo(
    () => readLastMarket(activeWorkspaceId) ?? DEFAULT_MARKET,
    [activeWorkspaceId],
  );

  const search = readGapSearch(params, fallbackMarket);
  const ready = isGapSearchable(search);

  const [filters, setFilters] = useState<GapFilters>(EMPTY_GAP_FILTERS);
  const [draft, setDraft] = useState<GapFilterDraft>(EMPTY_GAP_DRAFT);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [serpKeyword, setSerpKeyword] = useState<string | null>(null);
  const [addTargets, setAddTargets] = useState<KeywordToAdd[] | null>(null);

  /*
   * A selection is a set of keyword strings, which only means something
   * against the rows it was made from. Changing the comparison or the mode
   * changes those rows, so the selection is dropped rather than silently
   * carried into a table where it selects different keywords — or none.
   */
  const selectionKey = `${gapSearchKey(search)}|${search.mode}`;
  const [syncedKey, setSyncedKey] = useState(selectionKey);
  if (selectionKey !== syncedKey) {
    setSyncedKey(selectionKey);
    setSelected(new Set());
  }

  const query = useGapKeywords(activeWorkspaceId, search, filters, ready);
  const locationsQuery = useMetaLocations(activeWorkspaceId);

  useApiErrorToast(query.error, "Gap analysis failed");

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const meta = useMemo(
    () => aggregateMeta(query.data?.pages ?? []),
    [query.data],
  );
  const total = query.data?.pages[0]?.totalCount ?? null;
  const filterCount = activeGapFilterCount(filters);

  /**
   * Rows this comparison fetched and then dropped because they did not match
   * the mode.
   *
   * Worth surfacing because a mode filter can legitimately empty a whole page:
   * `missing` needs *every* competitor to rank, which against unrelated rivals
   * is rare. Without this number, "0 rows" next to a total of 51 reads as a
   * broken screen rather than as "none of the first 20 qualified".
   */
  const filteredOut = useMemo(
    () =>
      (query.data?.pages ?? []).reduce((sum, page) => sum + page.filteredOut, 0),
    [query.data],
  );

  const applySearch = useCallback(
    (next: GapSubmit) => {
      writeLastMarket(activeWorkspaceId, {
        location: next.location,
        language: next.language,
      });
      // A keyword comparison keeps whatever the pages view had in it, so
      // flicking back and forth does not throw away either side's work.
      setParams(
        gapSearchParams({
          ...next,
          mode: search.mode,
          view: "keywords",
          pages: search.pages,
        }),
      );
    },
    [activeWorkspaceId, setParams, search.mode, search.pages],
  );

  const selectMode = useCallback(
    (mode: string) => {
      // replace: a tab flick is not a navigation step anyone wants to unwind
      // one press at a time on the way back.
      setParams(gapSearchParams({ ...search, mode: mode as GapMode }), {
        replace: true,
      });
    },
    [search, setParams],
  );

  /**
   * Switching views keeps everything else in the URL.
   *
   * Deliberate: someone who has compared four rivals and flicks to Pages should
   * find their comparison still there when they flick back, and the market they
   * chose should carry across — it is the one input both views share.
   */
  const selectView = useCallback(
    (view: GapView) => {
      setParams(gapSearchParams({ ...search, view }), { replace: true });
    },
    [search, setParams],
  );

  const applyPagesSearch = useCallback(
    (next: GapPagesSubmit) => {
      writeLastMarket(activeWorkspaceId, {
        location: next.location,
        language: next.language,
      });
      setParams(
        gapSearchParams({
          ...search,
          pages: next.pages,
          location: next.location,
          language: next.language,
          view: "pages",
        }),
      );
    },
    [activeWorkspaceId, search, setParams],
  );

  const onToggle = useCallback((keyword: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }, []);

  const onToggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((row) => row.keyword)) : new Set());
    },
    [rows],
  );

  const onViewSerp = useCallback((row: GapKeywordRow) => {
    setSerpKeyword(row.keyword);
  }, []);

  const onAddToCollection = useCallback((targets: GapKeywordRow[]) => {
    setAddTargets(toKeywordsToAdd(targets));
  }, []);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.keyword)),
    [rows, selected],
  );

  const marketName = marketLabel(
    locationsQuery.data?.locations ?? [],
    search.location,
    search.language,
  );

  const blocking = isConfigurationError(query.error);

  /*
   * One panel, rendered under whichever tab is selected. The mode lives in the
   * URL and drives the query, so the four tabs really are four views of the
   * same screen rather than four screens.
   */
  const panel = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {GAP_MODE_DESCRIPTIONS[search.mode]}
          </p>
          {search.mode === "all" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {`All is the expensive view: two DataForSEO queries per competitor instead of one — ${formatCount(
                search.competitors.length * 2,
              )} upstream calls for ${formatCount(search.competitors.length)} competitor${
                search.competitors.length === 1 ? "" : "s"
              } here.`}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ResultMetaChip meta={meta} />
          <AnchorButton
            href={gapExportUrl(activeWorkspaceId, search, filters)}
            variant="secondary"
            size="sm"
            title={`Exports this comparison from the server with the filters above — up to ${formatCount(
              GAP_CSV_MAX_ROWS,
            )} rows, not just the ones loaded here.`}
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export CSV
          </AnchorButton>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(parseGapFilterDraft(draft));
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
          <Field label="Min difficulty">
            {(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                value={draft.minDifficulty}
                onChange={(event) =>
                  setDraft({ ...draft, minDifficulty: event.target.value })
                }
              />
            )}
          </Field>
          <Field label="Max difficulty">
            {(field) => (
              <Input
                {...field}
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                value={draft.maxDifficulty}
                onChange={(event) =>
                  setDraft({ ...draft, maxDifficulty: event.target.value })
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
            onClick={() => {
              setDraft(EMPTY_GAP_DRAFT);
              setFilters(EMPTY_GAP_FILTERS);
            }}
            disabled={filterCount === 0 && isGapDraftEmpty(draft)}
          >
            Clear
          </Button>
          <p className="text-xs text-muted-foreground">
            Filters are applied by DataForSEO, so each change is a new query —
            one call per competitor.
          </p>
        </div>
      </form>

      {query.error !== null && !blocking ? (
        <ApiErrorNotice
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {/* Bulk bar. Present only when there is a selection, so it never takes
          vertical space it has not earned. */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-app border border-primary/40 bg-tint p-3">
          <p className="text-sm font-medium text-tint-foreground" aria-live="polite">
            {`${formatCount(selected.size)} keyword${selected.size === 1 ? "" : "s"} selected`}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => onAddToCollection(selectedRows)}>
              Add to collection
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="size-3.5" aria-hidden="true" />
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <GapTable
        rows={rows}
        competitors={search.competitors}
        target={search.target}
        loading={query.isPending}
        caption={`${MODE_LABELS[search.mode]} keywords for ${search.target} versus ${search.competitors.join(", ")}`}
        selected={selected}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
        onViewSerp={onViewSerp}
        onAddToCollection={onAddToCollection}
        emptyState={
          filterCount > 0 ? (
            <EmptyState
              icon={SlidersHorizontal}
              title="No keywords match these filters"
              description="Nothing in this comparison survived the filters. Widen a bound or clear them to see the gaps again."
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title={`No ${MODE_LABELS[search.mode].toLowerCase()} keywords`}
              description={
                search.mode === "missing"
                  ? "No keyword is covered by every one of these competitors while you are absent. Untapped is the broader view — it only needs one of them to rank."
                  : "DataForSEO found no keywords matching this view for these domains in this market."
              }
              /*
               * An empty `missing` is the most common dead end on this screen:
               * it requires *every* rival to rank, which against an
               * imperfectly-matched peer set is rare. The fix is one tab away
               * and the description already names it, so the button just does
               * it — same comparison, same market, same competitors, broader
               * rule.
               *
               * And it really is free, which is why the title says so:
               * `upstreamQueriesForMode` (src/worker/routes/gap.ts) returns the
               * identical `{ intersections: false, requireOutranking: false }`
               * query for both modes. They differ only in the row filter
               * applied afterwards, so the switch is a cache hit rather than a
               * second purchase.
               */
              action={
                search.mode === "missing" ? (
                  <Button
                    size="sm"
                    onClick={() => selectMode("untapped")}
                    title="Same comparison, broader rule — Untapped needs only one competitor to rank. It reuses this query's cached results, so it costs nothing."
                  >
                    Show Untapped instead
                  </Button>
                ) : undefined
              }
            />
          )
        }
      />

      {/*
        The pager stays available even when this page matched nothing, because
        paging runs against the *unfiltered* set: a `missing` page can drop all
        fifty of its rows and the next fifty can still hold matches. Hiding the
        button there would strand the user on an empty table with more results
        sitting behind it.

        "Load more" is a purchase, not a scroll — each press is another billed
        request per competitor — so it stays an explicit button.
      */}
      {rows.length > 0 || query.hasNextPage ? (
        <div className="flex flex-col gap-2">
          {filteredOut > 0 ? (
            <p className="text-xs text-muted-foreground">
              {`${formatCount(filteredOut)} of the ${formatCount(
                rows.length + filteredOut,
              )} keywords fetched didn't match ${MODE_LABELS[search.mode]} and aren't shown${
                query.hasNextPage
                  ? " — paging works through everything these domains rank for, so the next page may hold more."
                  : "."
              }`}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {total === null
                ? `${formatCount(rows.length)} rows loaded`
                : `${formatCount(rows.length)} shown of ${formatCount(total)} compared`}
            </p>
            {query.hasNextPage ? (
              <Button
                size="sm"
                variant="secondary"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
                title="Fetches the next page from DataForSEO — one call per competitor."
              >
                Load {PAGE_SIZE} more
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                Everything loaded
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );

  const tabs: TabItem[] = GAP_MODES.map((mode) => ({
    id: mode,
    label: MODE_LABELS[mode],
    content: panel,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gap Analysis"
        description="Keywords your competitors rank for and you don't — plus the ones where they simply rank higher."
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
          <ViewSwitch value={search.view} onChange={selectView} />

          {search.view === "pages" ? (
            <GapPagesView
              workspaceId={activeWorkspaceId}
              search={search}
              onSubmit={applyPagesSearch}
              onViewSerp={(row: GapPageRow) => setSerpKeyword(row.keyword)}
            />
          ) : (
        <>
          <GapSearchForm
            workspaceId={activeWorkspaceId}
            value={search}
            onSubmit={applySearch}
            busy={query.isFetching}
          />

          {search.target === "" ? (
            <Card>
              <EmptyState
                icon={GitCompareArrows}
                title="Compare yourself against up to four rivals"
                description="Enter your domain and the competitors you care about. Missing shows what all of them cover and you don't, Weak where you are already present but behind."
              />
            </Card>
          ) : !ready && search.competitors.length === 0 ? (
            <Card>
              <EmptyState
                icon={Users}
                title="Add a competitor"
                description="A gap needs someone to be on the other side of it. Add at least one competitor domain to compare against."
              />
            </Card>
          ) : !ready ? (
            <Card>
              <EmptyState
                icon={SearchX}
                title={`"${search.target}" isn't a domain`}
                description="Enter a hostname like example.com — a full URL is fine too."
              />
            </Card>
          ) : blocking ? (
            <ApiErrorNotice error={query.error} />
          ) : (
            <Tabs tabs={tabs} value={search.mode} onValueChange={selectMode} />
          )}
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

      <AddToCollectionDialog
        workspaceId={activeWorkspaceId}
        open={addTargets !== null}
        onClose={() => setAddTargets(null)}
        market={{ location: search.location, language: search.language }}
        keywords={addTargets ?? []}
      />
    </div>
  );
}
