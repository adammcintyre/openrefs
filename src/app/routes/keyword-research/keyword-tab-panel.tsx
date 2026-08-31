/**
 * One keyword tab: Ideas, Suggestions or Related.
 *
 * Mounted only while its tab is selected — `Tabs` renders the active panel
 * alone — which is deliberate rather than incidental. Each of these is a
 * billed DataForSEO call, so switching tabs is what authorises the spend for
 * that tab, and opening the page does not quietly fetch all three.
 */
import {
  Download,
  FolderPlus,
  SearchX,
  SlidersHorizontal,
  TrendingUp,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  ApiErrorNotice,
  useApiErrorToast,
} from "../../components/keywords/api-error-notice";
import {
  AddToCollectionDialog,
  toKeywordsToAdd,
} from "../../components/keywords/add-to-collection-dialog";
import { CostChip } from "../../components/keywords/chips";
import { KeywordFilterRow } from "../../components/keywords/filter-row";
import { EMPTY_FILTERS, filterKeywordRows, isFilterActive } from "../../components/keywords/filters";
import type { KeywordFilterState } from "../../components/keywords/filters";
import { formatVolume } from "../../components/keywords/format";
import { KeywordTable } from "../../components/keywords/keyword-table";
import type { MarketSelection } from "../../components/keywords/market";
import { useKeywordList } from "../../components/keywords/queries";
import type { KeywordToAdd } from "../../components/keywords/queries";
import { SerpPanel } from "../../components/serp-panel";
import { TrackKeywordsDialog } from "../../components/tracking/track-keywords-dialog";
import { Button, EmptyState } from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import type { KeywordRow } from "../../../shared/keywords";
import type { KeywordTabId } from "./search-params";
import { TAB_LABELS } from "./search-params";

/**
 * What Ideas actually is, said once and quietly.
 *
 * It is the honest answer to the complaint that demoted the tab: the endpoint
 * expands the seed's *category*, so a term here can share a topic without
 * sharing much else. A muted line rather than a banner — a caveat that shouts
 * gets dismissed, and this one is worth reading once.
 */
const IDEAS_NOTE =
  "Broad matches from the seed's category — often loosely related. Suggestions and Related stay closer to the phrase.";

const CSV_HEADERS = ["keyword", "search_volume", "difficulty", "cpc_usd", "intent"];

export function KeywordTabPanel({
  workspaceId,
  tab,
  keyword,
  market,
}: {
  workspaceId: string | null;
  tab: KeywordTabId;
  keyword: string;
  market: MarketSelection;
}) {
  const query = useKeywordList(workspaceId, tab, keyword, market);

  const [filters, setFilters] = useState<KeywordFilterState>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [serpRow, setSerpRow] = useState<KeywordRow | null>(null);
  const [addTargets, setAddTargets] = useState<KeywordToAdd[] | null>(null);
  /**
   * Phase 3 retrofit: the keywords queued for "Track in a project". Held as
   * plain strings rather than rows because a tracked keyword carries none of
   * the research metrics — volume and difficulty belong to a collection
   * snapshot, not to a rank check.
   */
  const [trackTargets, setTrackTargets] = useState<string[] | null>(null);

  useApiErrorToast(query.error, `Could not load ${TAB_LABELS[tab].toLowerCase()}`);

  const loadedRows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const rows = useMemo(
    () => filterKeywordRows(loadedRows, filters),
    [loadedRows, filters],
  );

  /**
   * What this tab has cost so far, across every page loaded. Summed rather
   * than showing only the last page, because "Load more" is the button that
   * spends and the running total is the honest number.
   */
  const meta = useMemo(() => {
    const pages = query.data?.pages ?? [];
    if (pages.length === 0) return undefined;
    return {
      costUsd: pages.reduce((total, page) => total + page.costUsd, 0),
      cached: pages.every((page) => page.cached),
    };
  }, [query.data]);

  const totalCount = query.data?.pages[0]?.totalCount ?? null;

  const onToggle = useCallback((target: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }, []);

  // Acts on the rows currently visible, i.e. after filtering — selecting "all"
  // must not quietly include rows the filter is hiding.
  const onToggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((row) => row.keyword)) : new Set());
    },
    [rows],
  );

  const onViewSerp = useCallback((row: KeywordRow) => setSerpRow(row), []);

  const onAddToCollection = useCallback((targets: KeywordRow[]) => {
    setAddTargets(toKeywordsToAdd(targets));
  }, []);

  const onTrack = useCallback((targets: KeywordRow[]) => {
    setTrackTargets(targets.map((row) => row.keyword));
  }, []);

  const selectedRows = useMemo(
    () => loadedRows.filter((row) => selected.has(row.keyword)),
    [loadedRows, selected],
  );

  function exportCsv() {
    downloadCsv(
      `${keyword}-${tab}`,
      CSV_HEADERS,
      rows.map((row) => [
        row.keyword,
        row.searchVolume,
        row.keywordDifficulty,
        row.cpc,
        row.intent,
      ]),
    );
  }

  const isLoading = query.isPending;
  const filtersActive = isFilterActive(filters);

  if (query.isError) {
    return (
      <ApiErrorNotice error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {tab === "ideas" ? (
        <p className="text-xs text-muted-foreground">{IDEAS_NOTE}</p>
      ) : null}

      <KeywordFilterRow
        filters={filters}
        onChange={setFilters}
        shownCount={rows.length}
        loadedCount={loadedRows.length}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CostChip meta={meta} />
          {totalCount !== null ? (
            <span className="text-xs text-muted-foreground">
              {`${formatVolume(loadedRows.length)} of ${formatVolume(totalCount)} available`}
            </span>
          ) : null}
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {/* Bulk bar. Present only when there is a selection, so it never takes
          vertical space it has not earned. */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-app border border-primary/40 bg-tint p-3">
          <p className="text-sm font-medium text-tint-foreground" aria-live="polite">
            {`${formatVolume(selected.size)} keyword${selected.size === 1 ? "" : "s"} selected`}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => onAddToCollection(selectedRows)}>
              <FolderPlus className="size-3.5" aria-hidden="true" />
              Add to collection
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onTrack(selectedRows)}
            >
              <TrendingUp className="size-3.5" aria-hidden="true" />
              Track
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

      <KeywordTable
        rows={rows}
        loading={isLoading}
        caption={`${TAB_LABELS[tab]} for ${keyword}`}
        selected={selected}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
        onViewSerp={onViewSerp}
        onAddToCollection={onAddToCollection}
        onTrack={onTrack}
        emptyState={
          filtersActive && loadedRows.length > 0 ? (
            <EmptyState
              icon={SlidersHorizontal}
              title="No keywords match these filters"
              description="Every loaded keyword was filtered out. Widen a bound or clear the filters to see them again."
              action={
                <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title={`No ${TAB_LABELS[tab].toLowerCase()} found`}
              description="DataForSEO returned nothing for this keyword in this market. Try a broader seed keyword or a different location."
            />
          )
        }
      />

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void query.fetchNextPage()}
            loading={query.isFetchingNextPage}
          >
            Load more
          </Button>
        </div>
      ) : null}

      {serpRow !== null && workspaceId !== null ? (
        <SerpPanel
          workspaceId={workspaceId}
          keyword={serpRow.keyword}
          locationCode={market.locationCode}
          languageCode={market.languageCode}
          open
          onClose={() => setSerpRow(null)}
        />
      ) : null}

      <AddToCollectionDialog
        workspaceId={workspaceId}
        open={addTargets !== null}
        onClose={() => setAddTargets(null)}
        market={{ location: market.locationCode, language: market.languageCode }}
        keywords={addTargets ?? []}
      />

      <TrackKeywordsDialog
        workspaceId={workspaceId}
        open={trackTargets !== null}
        onClose={() => setTrackTargets(null)}
        keywords={trackTargets ?? []}
      />
    </div>
  );
}
