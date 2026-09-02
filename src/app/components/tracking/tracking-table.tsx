/**
 * The rank tracking table.
 *
 * Structured like `components/keywords/keyword-table.tsx` and for the same
 * reasons: column definitions live at module scope so a checkbox click cannot
 * churn TanStack's sort and pagination state, and the cells reach the mutable
 * parts — the selection, the row handlers — through a context rather than by
 * closing over them.
 *
 * What is specific to this table is how carefully it has to distinguish three
 * kinds of "no number":
 *
 * - **Never checked** (`latest === null`) → "Awaiting first check". A keyword
 *   added two minutes ago has no data because nothing has run yet.
 * - **Checked, not in the top 100** (`latest.position === null`) → "—". A real
 *   measurement, and the reason `position` is nullable rather than 0.
 * - **No baseline for a delta** (`change7d === null`) → "—" with an
 *   explanatory title. Not "0": unchanged and unmeasured are different claims.
 *
 * Sorting relies on TanStack v9's `sortUndefined` (default: last), which tests
 * for `undefined` only — so every nullable accessor maps null to undefined,
 * while the cell reads `row.original` to tell the cases apart.
 */
import { ExternalLink, Sparkles, Trash2 } from "lucide-react";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { TrackedKeywordRow } from "../../../shared/tracking";
import { Sparkline } from "../charts/sparkline";
import { Badge, Button, DataTable, createDataTableColumns, cn } from "../ui";
import type { DataTableColumn } from "../ui";
import { DeviceBadge } from "./device-select";
import {
  CHANGE_TONE_CLASS,
  changeTitle,
  changeTone,
  formatBestPosition,
  formatChange,
  formatPosition,
  positionState,
  positionTitle,
  rankingPath,
} from "./format";

/* ------------------------------- row context ------------------------------- */

interface TrackingTableContext {
  rows: ReadonlyArray<TrackedKeywordRow>;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onRemove: (rows: TrackedKeywordRow[]) => void;
  onViewSerp: (row: TrackedKeywordRow) => void;
}

const RowContext = createContext<TrackingTableContext | null>(null);

function useRowContext(): TrackingTableContext {
  const context = useContext(RowContext);
  if (context === null) {
    throw new Error("Tracking table cells must render inside <TrackingTable>");
  }
  return context;
}

/* --------------------------------- cells ----------------------------------- */

const CHECKBOX_CLASS = "size-4 shrink-0 cursor-pointer accent-primary";

function SelectAllHeader() {
  const { rows, selected, onToggleAll } = useRowContext();
  const total = rows.length;
  const chosen = rows.filter((row) => selected.has(row.id)).length;
  const allChosen = total > 0 && chosen === total;

  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={allChosen}
      disabled={total === 0}
      // Some-but-not-all has no HTML attribute; it is a DOM property only.
      ref={(node) => {
        if (node) node.indeterminate = chosen > 0 && !allChosen;
      }}
      onChange={(event) => onToggleAll(event.target.checked)}
      aria-label={
        allChosen
          ? `Clear selection of ${total} keywords`
          : `Select all ${total} keywords`
      }
    />
  );
}

function SelectCell({ row }: { row: TrackedKeywordRow }) {
  const { selected, onToggle } = useRowContext();
  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={selected.has(row.id)}
      onChange={() => onToggle(row.id)}
      aria-label={`Select ${row.keyword}`}
    />
  );
}

/**
 * The position cell.
 *
 * "Awaiting first check" is set in muted, smaller type rather than as a number
 * so the column still scans as numbers — a row with words in it reads as an
 * exception, which is exactly what it is.
 */
function PositionCell({ row }: { row: TrackedKeywordRow }) {
  const state = positionState(row.latest);
  return (
    <span
      title={positionTitle(row.latest)}
      className={cn(
        "tabular-nums",
        state.kind === "ranked"
          ? "font-medium text-foreground"
          : state.kind === "unranked"
            ? "text-muted-foreground"
            : "text-xs text-muted-foreground italic",
      )}
    >
      {formatPosition(row.latest)}
    </span>
  );
}

/**
 * A delta cell.
 *
 * Positive is green because positive already *means* improved — the Worker
 * returns `older - newer`, so the down-is-good inversion has been applied
 * upstream (see src/shared/tracking.ts). Re-inverting here is the single most
 * likely way to render this screen confidently backwards.
 */
function ChangeCell({ change, days }: { change: number | null; days: number }) {
  return (
    <span
      title={changeTitle(change, days)}
      className={cn(
        "tabular-nums font-medium",
        CHANGE_TONE_CLASS[changeTone(change)],
      )}
    >
      {formatChange(change)}
    </span>
  );
}

/** The path, with the whole URL on the title — see `urlPath`'s own rationale. */
function UrlCell({ row }: { row: TrackedKeywordRow }) {
  const url = row.latest?.url ?? null;
  if (url === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={url}
      className="block max-w-56 truncate text-primary hover:underline"
    >
      {rankingPath(url)}
    </a>
  );
}

/**
 * The 30-day sparkline.
 *
 * Labelled rather than decorative: the trend it draws is not stated anywhere
 * else on the row, so hiding it from assistive technology would drop
 * information rather than avoid repeating it.
 */
function SparklineCell({ row }: { row: TrackedKeywordRow }) {
  const measured = row.series.filter((point) => point.position !== null).length;

  const label =
    measured === 0
      ? `No position history yet for ${row.keyword}.`
      : `${row.keyword}: ${measured} check${measured === 1 ? "" : "s"} in the last 30 days, best position ${
          Math.min(
            ...row.series
              .map((point) => point.position)
              .filter((position): position is number => position !== null),
          )
        }.`;

  return <Sparkline series={row.series} label={label} />;
}

/**
 * The AI Overview cell (Phase 6 retrofit).
 *
 * Free data: the flag is read off SERP features the latest snapshot already
 * stores, so this column costs nothing to show. It earns its width by
 * explaining a position that under-delivers — an AI Overview pushes the first
 * organic result down the page whatever its rank says.
 *
 * Three states, and the third is the one worth being careful about. The
 * contract sends `false` both for "checked, no overview" and for "never
 * checked", because a keyword with no snapshot has no features to read. Only
 * `latest` can tell those apart, so an unchecked row says so rather than
 * claiming Google shows no overview — the same distinction PositionCell draws,
 * for the same reason.
 */
function AiOverviewCell({ row }: { row: TrackedKeywordRow }) {
  if (row.latest === null) {
    return (
      <span
        className="text-xs text-muted-foreground italic"
        title={`Not checked yet — no SERP has been recorded for "${row.keyword}".`}
      >
        —
      </span>
    );
  }

  if (!row.aiOverview) {
    return (
      <span
        className="text-muted-foreground"
        title={`No AI Overview for "${row.keyword}" at the last check.`}
      >
        —
      </span>
    );
  }

  return (
    <Badge variant="info" title="Google shows an AI Overview for this keyword">
      <Sparkles className="size-3" aria-hidden="true" />
      Yes
    </Badge>
  );
}

function SerpCell({ row }: { row: TrackedKeywordRow }) {
  const { onViewSerp } = useRowContext();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => onViewSerp(row)}
      aria-label={`View SERP for ${row.keyword}`}
      title={`View the desktop SERP for ${row.keyword} in this keyword's market`}
    >
      <ExternalLink className="size-3.5" aria-hidden="true" />
      SERP
    </Button>
  );
}

function RemoveCell({ row }: { row: TrackedKeywordRow }) {
  const { onRemove } = useRowContext();
  return (
    <div className="flex justify-end">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onRemove([row])}
        aria-label={`Stop tracking ${row.keyword}`}
        title={`Stop tracking ${row.keyword}`}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

/* -------------------------------- columns ---------------------------------- */

const col = createDataTableColumns<TrackedKeywordRow>();

const columns: Array<DataTableColumn<TrackedKeywordRow>> = [
  col.display({
    id: "select",
    header: () => <SelectAllHeader />,
    cell: (info) => <SelectCell row={info.row.original} />,
  }),
  col.accessor("keyword", {
    header: "Keyword",
    cell: (info) => (
      <span className="font-medium break-words">{info.getValue<string>()}</span>
    ),
  }),
  col.accessor("device", {
    header: "Device",
    cell: (info) => <DeviceBadge device={info.row.original.device} />,
  }),
  col.accessor((row) => row.latest?.position ?? undefined, {
    id: "position",
    header: "Position",
    cell: (info) => <PositionCell row={info.row.original} />,
  }),
  col.accessor((row) => row.change1d ?? undefined, {
    id: "change1d",
    header: "Δ 1d",
    cell: (info) => <ChangeCell change={info.row.original.change1d} days={1} />,
  }),
  col.accessor((row) => row.change7d ?? undefined, {
    id: "change7d",
    header: "Δ 7d",
    cell: (info) => <ChangeCell change={info.row.original.change7d} days={7} />,
  }),
  col.accessor((row) => row.change30d ?? undefined, {
    id: "change30d",
    header: "Δ 30d",
    cell: (info) => <ChangeCell change={info.row.original.change30d} days={30} />,
  }),
  col.accessor((row) => row.bestPosition ?? undefined, {
    id: "bestPosition",
    header: "Best",
    cell: (info) => (
      <span className="tabular-nums text-muted-foreground">
        {formatBestPosition(info.row.original.bestPosition)}
      </span>
    ),
  }),
  col.accessor((row) => row.aiOverview, {
    id: "aiOverview",
    header: () => (
      <span title="Google shows an AI Overview for this keyword">
        AI Overview
      </span>
    ),
    cell: (info) => <AiOverviewCell row={info.row.original} />,
  }),
  col.display({
    id: "url",
    header: "Ranking URL",
    cell: (info) => <UrlCell row={info.row.original} />,
  }),
  col.display({
    id: "trend",
    header: "30-day trend",
    cell: (info) => <SparklineCell row={info.row.original} />,
  }),
  col.display({
    id: "serp",
    header: () => <span className="sr-only">View SERP</span>,
    cell: (info) => <SerpCell row={info.row.original} />,
  }),
  col.display({
    id: "remove",
    header: () => <span className="sr-only">Remove</span>,
    cell: (info) => <RemoveCell row={info.row.original} />,
  }),
];

/* --------------------------------- table ----------------------------------- */

export function TrackingTable({
  rows,
  loading,
  caption,
  selected,
  onToggle,
  onToggleAll,
  onRemove,
  onViewSerp,
  emptyState,
}: {
  rows: ReadonlyArray<TrackedKeywordRow>;
  loading: boolean;
  caption: string;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onRemove: (rows: TrackedKeywordRow[]) => void;
  onViewSerp: (row: TrackedKeywordRow) => void;
  emptyState?: ReactNode;
}) {
  return (
    <RowContext.Provider
      value={{ rows, selected, onToggle, onToggleAll, onRemove, onViewSerp }}
    >
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        caption={caption}
        emptyState={emptyState}
        pageSize={25}
        maxHeight="40rem"
      />
    </RowContext.Provider>
  );
}
