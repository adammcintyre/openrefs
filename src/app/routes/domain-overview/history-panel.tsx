/**
 * "Which domains have I looked at, and what did they score?"
 *
 * The trail for this module, mapped onto the shared panel. The summary the
 * Worker snapshots (`DomainHistorySummary`) is the whole reason the list is
 * worth reading rather than re-running: Domain Score, estimated traffic and
 * keyword count are on the row, so a user can pick the domain they meant
 * without paying to be reminded which one it was.
 *
 * Every row re-opens the search from the *server's* cache — see
 * `SearchHistoryPanel` and the `stale` path in `queries.ts`. Nothing here can
 * spend.
 */
import type { DomainHistoryEntry } from "../../../shared/history";
import { ScoreBadge } from "../../components/backlinks/badges";
import { formatCount, formatTraffic } from "../../components/domains/format";
import {
  SearchHistoryCard,
  SearchHistoryDisclosure,
  SearchHistoryPanel,
} from "../../components/history/search-history-panel";
import type { HistoryPanelRow } from "../../components/history/search-history-panel";
import {
  useClearHistory,
  useDeleteHistoryEntry,
  useSearchHistory,
} from "../../components/history/queries";
import type { Market } from "./url-state";

/** The compact metrics line under a row's domain. */
function summaryLine(entry: DomainHistoryEntry): string | undefined {
  const { summary } = entry;
  if (summary === null) return undefined;

  const parts: string[] = [];
  if (summary.organicTraffic !== null) {
    parts.push(`${formatTraffic(summary.organicTraffic)} traffic`);
  }
  if (summary.organicKeywords !== null) {
    parts.push(`${formatCount(summary.organicKeywords)} keywords`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function toRows(
  entries: ReadonlyArray<DomainHistoryEntry>,
  onOpen: (target: string, market: Market) => void,
): HistoryPanelRow[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.params.target,
    detail: summaryLine(entry),
    badge:
      entry.summary === null ? undefined : (
        <ScoreBadge score={entry.summary.domainScore} label="Domain Score" />
      ),
    lastSearchedAt: entry.lastSearchedAt,
    onOpen: () =>
      onOpen(entry.params.target, {
        location: entry.params.location,
        language: entry.params.language,
      }),
  }));
}

/**
 * The trail as the empty state's main content, when no domain is being viewed.
 */
export function DomainHistoryCard({
  workspaceId,
  onOpen,
}: {
  workspaceId: string | null;
  onOpen: (target: string, market: Market) => void;
}) {
  const { rows, isPending, isError, remove, clear, busy } = useDomainHistoryRows(
    workspaceId,
    onOpen,
  );

  // Nothing searched yet and nothing recorded: the module's own empty state is
  // already saying "analyze any domain", and a second empty box under it would
  // be noise.
  if (!isPending && rows.length === 0) return null;

  return (
    <SearchHistoryCard
      heading="Recent domains"
      description="Searches this workspace has run. Re-opening one is free."
    >
      <SearchHistoryPanel
        rows={rows}
        isPending={isPending}
        isError={isError}
        emptyTitle="No searches yet"
        emptyDescription="Domains you analyze show up here with their headline metrics."
        onDelete={remove}
        onClearAll={clear}
        busy={busy}
      />
    </SearchHistoryCard>
  );
}

/** The same trail, folded away, for when a report is already on screen. */
export function DomainHistoryDisclosure({
  workspaceId,
  onOpen,
}: {
  workspaceId: string | null;
  onOpen: (target: string, market: Market) => void;
}) {
  const { rows, isError, remove, clear, busy } = useDomainHistoryRows(
    workspaceId,
    onOpen,
  );
  if (isError) return null;

  return (
    <SearchHistoryDisclosure label="Recent domains" count={rows.length}>
      <SearchHistoryPanel
        rows={rows}
        emptyTitle="No searches yet"
        emptyDescription="Domains you analyze show up here with their headline metrics."
        onDelete={remove}
        onClearAll={clear}
        busy={busy}
      />
    </SearchHistoryDisclosure>
  );
}

/** The list plus its two mutations, shared by both shells above. */
function useDomainHistoryRows(
  workspaceId: string | null,
  onOpen: (target: string, market: Market) => void,
) {
  const query = useSearchHistory(workspaceId, "domains");
  const deleteEntry = useDeleteHistoryEntry(workspaceId, "domains");
  const clearAll = useClearHistory(workspaceId, "domains");

  return {
    rows: toRows(query.data?.items ?? [], onOpen),
    isPending: query.isPending,
    isError: query.isError,
    remove: (id: string) => deleteEntry.mutate(id),
    clear: () => clearAll.mutate(),
    busy: deleteEntry.isPending || clearAll.isPending,
  };
}
