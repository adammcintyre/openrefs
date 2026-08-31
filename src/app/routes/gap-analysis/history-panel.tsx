/**
 * "Which comparisons have I run?"
 *
 * The trail for this module. A gap comparison is the most tedious search in the
 * app to rebuild by hand — your domain plus up to four rivals, in one market —
 * so having it one click away is worth more here than anywhere else, and the
 * click is free (`stale=true`; see `queries.ts`).
 *
 * **Only the keywords view is recorded.** The pages view is a different
 * endpoint with different inputs and no target, so the Worker does not write it
 * to the trail and nothing here pretends otherwise.
 */
import type { GapHistoryEntry } from "../../../shared/history";
import { formatCount } from "../../components/domains/format";
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
import type { GapMarket } from "./url-state";

/** What re-running this comparison needs. */
export interface GapHistoryOpen extends GapMarket {
  target: string;
  competitors: string[];
}

/** "yourdomain vs 3 competitors" — the row's own title. */
function title(entry: GapHistoryEntry): string {
  const count = entry.params.competitors.length;
  return `${entry.params.target} vs ${count} competitor${count === 1 ? "" : "s"}`;
}

/**
 * The keyword count, when there is one.
 *
 * `keywordCount` is what the comparison found *before* mode filtering, which is
 * why the label says "compared" rather than naming a mode the row does not
 * carry — the mode is a view over these rows, not part of the search.
 */
function summaryLine(entry: GapHistoryEntry): string | undefined {
  const count = entry.summary?.keywordCount;
  if (count === null || count === undefined) return undefined;
  return `${formatCount(count)} keywords compared`;
}

function toRows(
  entries: ReadonlyArray<GapHistoryEntry>,
  onOpen: (open: GapHistoryOpen) => void,
): HistoryPanelRow[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: title(entry),
    detail: summaryLine(entry),
    lastSearchedAt: entry.lastSearchedAt,
    onOpen: () =>
      onOpen({
        target: entry.params.target,
        competitors: entry.params.competitors,
        location: entry.params.location,
        language: entry.params.language,
      }),
  }));
}

/** The trail as the empty state's main content, before anything is compared. */
export function GapHistoryCard({
  workspaceId,
  onOpen,
}: {
  workspaceId: string | null;
  onOpen: (open: GapHistoryOpen) => void;
}) {
  const { rows, isPending, isError, remove, clear, busy } = useGapHistoryRows(
    workspaceId,
    onOpen,
  );

  if (!isPending && rows.length === 0) return null;

  return (
    <SearchHistoryCard
      heading="Recent comparisons"
      description="Gap analyses this workspace has run. Re-opening one is free."
    >
      <SearchHistoryPanel
        rows={rows}
        isPending={isPending}
        isError={isError}
        emptyTitle="No comparisons yet"
        emptyDescription="Comparisons you run show up here, competitor set and all."
        onDelete={remove}
        onClearAll={clear}
        busy={busy}
      />
    </SearchHistoryCard>
  );
}

/** The same trail, folded away, once a comparison is on screen. */
export function GapHistoryDisclosure({
  workspaceId,
  onOpen,
}: {
  workspaceId: string | null;
  onOpen: (open: GapHistoryOpen) => void;
}) {
  const { rows, isError, remove, clear, busy } = useGapHistoryRows(
    workspaceId,
    onOpen,
  );
  if (isError) return null;

  return (
    <SearchHistoryDisclosure label="Recent comparisons" count={rows.length}>
      <SearchHistoryPanel
        rows={rows}
        emptyTitle="No comparisons yet"
        emptyDescription="Comparisons you run show up here, competitor set and all."
        onDelete={remove}
        onClearAll={clear}
        busy={busy}
      />
    </SearchHistoryDisclosure>
  );
}

/** The list plus its two mutations, shared by both shells above. */
function useGapHistoryRows(
  workspaceId: string | null,
  onOpen: (open: GapHistoryOpen) => void,
) {
  const query = useSearchHistory(workspaceId, "gap");
  const deleteEntry = useDeleteHistoryEntry(workspaceId, "gap");
  const clearAll = useClearHistory(workspaceId, "gap");

  return {
    rows: toRows(query.data?.items ?? [], onOpen),
    isPending: query.isPending,
    isError: query.isError,
    remove: (id: string) => deleteEntry.mutate(id),
    clear: () => clearAll.mutate(),
    busy: deleteEntry.isPending || clearAll.isPending,
  };
}
