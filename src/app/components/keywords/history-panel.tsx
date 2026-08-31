/**
 * The workspace's Keyword Research trail.
 *
 * Two surfaces over one list, because the question it answers changes with the
 * screen. On the landing screen "what have we looked at?" is the main thing a
 * returning user wants, so the list sits under the search box in full. With
 * results on screen it is a lookup, not a browse, so it collapses into a button.
 *
 * Everything here is $0. The rows are a D1 read, and opening one asks the
 * Worker for its stored copy however old it is (`stale=true`) rather than a
 * fresh search — see `KeywordCacheMode`. Nothing in this file ever POSTs:
 * recording is server-side, on the search itself.
 *
 * A missing or failing trail degrades to one muted line. This is an accessory
 * to the module, and an error box where a convenience should be would make the
 * screen look broken over something nobody asked for.
 */
import { History, Trash2, X } from "lucide-react";
import { useState } from "react";

import type { KeywordHistoryEntry } from "../../../shared/history";
import {
  useClearHistory,
  useDeleteHistoryEntry,
  useSearchHistory,
} from "../history/queries";
import { Button, ConfirmDialog, Skeleton, cn } from "../ui";
import { DifficultyBadge } from "./chips";
import { formatCompact, formatRelativeTime } from "./format";

/** Rows worth scanning. Beyond this it stops being a trail and becomes a log. */
const HISTORY_LIMIT = 12;

export type OpenHistoryEntry = (entry: KeywordHistoryEntry) => void;

function HistoryRow({
  entry,
  onOpen,
  onDelete,
}: {
  entry: KeywordHistoryEntry;
  onOpen: OpenHistoryEntry;
  onDelete: (id: string) => void;
}) {
  const relative = formatRelativeTime(entry.lastSearchedAt);

  return (
    <li className="group flex items-center gap-2 rounded-app px-2 py-1.5 transition-colors hover:bg-surface-muted">
      <button
        type="button"
        onClick={() => onOpen(entry)}
        title={`Reopen ${entry.params.keyword} (location ${entry.params.location} · ${entry.params.language}) from the cache — this costs nothing.`}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground"
      >
        {entry.params.keyword}
      </button>

      <span
        className="tabular-nums text-xs text-muted-foreground"
        title="Search volume when this search last ran"
      >
        {formatCompact(entry.summary?.volume)}
      </span>
      <DifficultyBadge value={entry.summary?.difficulty} />

      {relative === null ? null : (
        <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
          {relative}
        </span>
      )}

      {/* Hidden until the row is hovered or the button is focused: a delete
          control on every row of a list you are scanning is visual noise, but
          it must still be reachable from the keyboard. */}
      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        aria-label={`Remove ${entry.params.keyword} from recent searches`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-app text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 hover:bg-border hover:text-foreground focus-visible:opacity-100"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * The list itself.
 *
 * Renders nothing at all when the trail is empty or unavailable, so callers can
 * mount it unconditionally without reserving space for something that may not
 * exist.
 */
export function KeywordHistoryList({
  workspaceId,
  onOpen,
  className = "",
}: {
  workspaceId: string | null;
  onOpen: OpenHistoryEntry;
  className?: string;
}) {
  const query = useSearchHistory(workspaceId, "keywords", HISTORY_LIMIT);
  const remove = useDeleteHistoryEntry(workspaceId, "keywords");
  const clear = useClearHistory(workspaceId, "keywords");
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (query.isPending) {
    return (
      <div className={cn("flex flex-col gap-1.5", className)} aria-busy="true">
        <span className="sr-only">Loading recent searches…</span>
        <Skeleton className="h-7 w-full rounded-app" />
        <Skeleton className="h-7 w-full rounded-app" />
        <Skeleton className="h-7 w-4/5 rounded-app" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className={cn("px-2 text-xs text-muted-foreground", className)}>
        Recent searches are unavailable right now.
      </p>
    );
  }

  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className={cn("px-2 text-xs text-muted-foreground", className)}>
        Searches you run are listed here, and reopening one is free.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ul className="flex flex-col">
        {items.map((entry) => (
          <HistoryRow
            key={entry.id}
            entry={entry}
            onOpen={onOpen}
            onDelete={(id) => remove.mutate(id)}
          />
        ))}
      </ul>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmingClear(true)}
          loading={clear.isPending}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Clear all
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingClear}
        onClose={() => setConfirmingClear(false)}
        onConfirm={() =>
          clear.mutate(undefined, { onSuccess: () => setConfirmingClear(false) })
        }
        title="Clear keyword search history?"
        description="This removes the whole Keyword Research trail for everyone in this workspace. Cached results are not deleted, so re-running a search still costs nothing."
        confirmLabel="Clear history"
        loading={clear.isPending}
      />
    </div>
  );
}

/** The landing-screen surface: the trail, under the search box, in full. */
export function RecentSearchesPanel({
  workspaceId,
  onOpen,
}: {
  workspaceId: string | null;
  onOpen: OpenHistoryEntry;
}) {
  return (
    <section aria-label="Recent searches" className="flex flex-col gap-2">
      <h2 className="px-2 text-sm font-semibold text-foreground">
        Recent searches
      </h2>
      <KeywordHistoryList workspaceId={workspaceId} onOpen={onOpen} />
    </section>
  );
}

/**
 * The with-results surface: a button that reveals the same list.
 *
 * Collapsible rather than a floating popover — there is no positioning
 * primitive in the design system, and a panel that pushes the results down a
 * little is a smaller cost than one that clips inside a scroll container.
 */
export function HistoryDisclosure({
  workspaceId,
  onOpen,
}: {
  workspaceId: string | null;
  onOpen: OpenHistoryEntry;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        title="Past searches in this workspace. Reopening one costs nothing."
      >
        <History className="size-3.5" aria-hidden="true" />
        History
      </Button>

      {open ? (
        <KeywordHistoryList
          workspaceId={workspaceId}
          onOpen={(entry) => {
            setOpen(false);
            onOpen(entry);
          }}
          className="rounded-app border border-border bg-surface p-2"
        />
      ) : null}
    </div>
  );
}
