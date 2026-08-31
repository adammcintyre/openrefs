/**
 * The search trail, as a list.
 *
 * Presentation only: the caller does the fetching (`useSearchHistory`) and maps
 * its module's entries into `HistoryPanelRow`s, so one panel serves Domain
 * Overview and Gap Analysis without either of them leaking its shapes into the
 * other.
 *
 * Two structural decisions that are easy to get wrong here:
 *
 *  - **Open and Delete are siblings, never nested.** A delete control inside
 *    the row button would be a button inside a button — invalid HTML that
 *    browsers reflow unpredictably, and a click target that fires the wrong
 *    action about as often as the right one. The row is a grid: a wide button
 *    and a narrow one.
 *  - **Opening an entry never spends.** The panel says so once, at the foot,
 *    because the whole point of the trail is that revisiting research is free —
 *    a user who assumes otherwise simply will not click.
 */
import { History, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button, Card, EmptyState, Skeleton } from "../ui";
import { relativeTime } from "./relative-time";

/** One row, already flattened out of whatever the module's entry looked like. */
export interface HistoryPanelRow {
  id: string;
  /** The thing that was searched — the line people scan. */
  title: string;
  /** Compact metrics under the title. */
  detail?: ReactNode;
  /** Trailing badge, e.g. a Domain Score. */
  badge?: ReactNode;
  /** ISO 8601 UTC. */
  lastSearchedAt: string;
  onOpen: () => void;
}

export function SearchHistoryPanel({
  rows,
  isPending = false,
  isError = false,
  emptyTitle,
  emptyDescription,
  onDelete,
  onClearAll,
  busy = false,
}: {
  rows: ReadonlyArray<HistoryPanelRow>;
  isPending?: boolean;
  isError?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  /** A delete or clear is in flight; the controls go quiet rather than jumpy. */
  busy?: boolean;
}) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-12 w-full rounded-app" />
        ))}
      </div>
    );
  }

  /*
   * A failed history read is not worth an error notice. The trail is a
   * convenience over a free D1 table; the search form above it still works, and
   * a red box would imply the user's research is broken when it is not.
   */
  if (isError) return null;

  if (rows.length === 0) {
    return (
      <EmptyState icon={History} title={emptyTitle} description={emptyDescription} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-1 rounded-app border border-border bg-surface"
          >
            <button
              type="button"
              onClick={row.onOpen}
              title={`Re-open ${row.title}. Served from this workspace's cache — it costs nothing.`}
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-app px-3 py-2 text-left transition-colors hover:bg-surface-muted"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {row.title}
              </span>
              {row.detail === undefined ? null : (
                <span className="text-xs text-muted-foreground">{row.detail}</span>
              )}
              {row.badge}
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {relativeTime(row.lastSearchedAt) ?? ""}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onDelete(row.id)}
              disabled={busy}
              aria-label={`Remove ${row.title} from history`}
              title={`Remove ${row.title} from history`}
              className="flex items-center rounded-app px-2.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-danger disabled:pointer-events-none disabled:opacity-60"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Re-opening a search serves the cached result — it costs nothing. Use
          Refresh on the results to pay for a new one.
        </p>
        <Button size="sm" variant="ghost" onClick={onClearAll} disabled={busy}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          Clear all
        </Button>
      </div>
    </div>
  );
}

/**
 * The trail as a card, for the empty state of a module — where there is nothing
 * else on screen and the list *is* the content.
 */
export function SearchHistoryCard({
  heading,
  description,
  children,
}: {
  heading: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="pb-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="size-4 text-muted-foreground" aria-hidden="true" />
          {heading}
        </h2>
        {description === undefined ? null : (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </Card>
  );
}

/**
 * The same trail, folded away, for when results are already on screen.
 *
 * A native `<details>` rather than React state: it works before hydration, it
 * is keyboard-operable and announced correctly with no ARIA of our own, and it
 * keeps a screen that is already dense from growing a third panel by default.
 */
export function SearchHistoryDisclosure({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="rounded-app border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-foreground">
        <History className="size-4 text-muted-foreground" aria-hidden="true" />
        {label}
        <span className="text-xs font-normal text-muted-foreground">
          {`${count} recent`}
        </span>
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
