/**
 * The keyword table shared by the Ideas, Suggestions and Related tabs.
 *
 * One component serves all three because the Worker flattens three different
 * upstream shapes to a single `KeywordRow` (see src/shared/keywords.ts).
 *
 * Two structural decisions worth knowing about:
 *
 * 1. **Column definitions live at module scope.** TanStack asks for stable
 *    `columns` and `data` references, and selection changes on nearly every
 *    click here. Cells reach the mutable parts — the selected set, the row
 *    handlers — through a React context instead of closing over them, so the
 *    column array is defined exactly once and a checkbox click cannot churn
 *    the table's internal sort/pagination state.
 * 2. **Nullable metrics are accessed as `undefined`.** v9's `sortUndefined`
 *    (default: sort last) tests for `undefined` only — `null` would sort as a
 *    value and bury real rows under unreported ones. The accessor maps null to
 *    undefined for sorting; the cell reads `row.original` so it can still tell
 *    the two apart and render an em dash.
 */
import { ExternalLink, FolderPlus } from "lucide-react";
import { createContext, useContext } from "react";

import type { KeywordRow } from "../../../shared/keywords";
import {
  Button,
  DataTable,
  createDataTableColumns,
} from "../ui";
import type { DataTableColumn } from "../ui";
import { CostChip, DifficultyBadge, IntentBadge } from "./chips";
import { formatCpc, formatVolume } from "./format";

/* ------------------------------- row context ------------------------------- */

interface KeywordTableContext {
  /** Every row currently in the table — what "select all" acts on. */
  rows: ReadonlyArray<KeywordRow>;
  selected: ReadonlySet<string>;
  onToggle: (keyword: string) => void;
  onToggleAll: (checked: boolean) => void;
  onViewSerp: (row: KeywordRow) => void;
  onAddToCollection: (rows: KeywordRow[]) => void;
}

const RowContext = createContext<KeywordTableContext | null>(null);

function useRowContext(): KeywordTableContext {
  const context = useContext(RowContext);
  if (context === null) {
    throw new Error("Keyword table cells must render inside <KeywordTable>");
  }
  return context;
}

/* --------------------------------- cells ----------------------------------- */

/**
 * Checkbox styled from theme tokens. `accent-primary` tints the native control
 * rather than replacing it, which keeps the platform's own focus ring, hit
 * area and screen-reader semantics.
 */
const CHECKBOX_CLASS = "size-4 shrink-0 cursor-pointer accent-primary";

function SelectAllHeader() {
  const { rows, selected, onToggleAll } = useRowContext();
  const total = rows.length;
  const chosen = rows.filter((row) => selected.has(row.keyword)).length;
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

function SelectCell({ keyword }: { keyword: string }) {
  const { selected, onToggle } = useRowContext();
  return (
    <input
      type="checkbox"
      className={CHECKBOX_CLASS}
      checked={selected.has(keyword)}
      onChange={() => onToggle(keyword)}
      aria-label={`Select ${keyword}`}
    />
  );
}

function ActionsCell({ row }: { row: KeywordRow }) {
  const { onViewSerp, onAddToCollection } = useRowContext();
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onViewSerp(row)}
        aria-label={`View SERP for ${row.keyword}`}
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
        SERP
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onAddToCollection([row])}
        aria-label={`Add ${row.keyword} to a collection`}
      >
        <FolderPlus className="size-3.5" aria-hidden="true" />
        Save
      </Button>
    </div>
  );
}

/* -------------------------------- columns ---------------------------------- */

const col = createDataTableColumns<KeywordRow>();

const columns: Array<DataTableColumn<KeywordRow>> = [
  col.display({
    id: "select",
    header: () => <SelectAllHeader />,
    cell: (info) => <SelectCell keyword={info.row.original.keyword} />,
  }),
  col.accessor("keyword", {
    header: "Keyword",
    cell: (info) => (
      <span className="font-medium break-words">{info.getValue<string>()}</span>
    ),
  }),
  col.accessor((row) => row.searchVolume ?? undefined, {
    id: "searchVolume",
    header: "Volume",
    cell: (info) => (
      <span className="tabular-nums">
        {formatVolume(info.row.original.searchVolume)}
      </span>
    ),
  }),
  col.accessor((row) => row.keywordDifficulty ?? undefined, {
    id: "keywordDifficulty",
    header: "Difficulty",
    cell: (info) => <DifficultyBadge value={info.row.original.keywordDifficulty} />,
  }),
  col.accessor((row) => row.cpc ?? undefined, {
    id: "cpc",
    header: "CPC",
    cell: (info) => (
      <span className="tabular-nums">{formatCpc(info.row.original.cpc)}</span>
    ),
  }),
  col.accessor((row) => row.intent ?? undefined, {
    id: "intent",
    header: "Intent",
    cell: (info) => <IntentBadge intent={info.row.original.intent} />,
  }),
  col.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: (info) => <ActionsCell row={info.row.original} />,
  }),
];

/* --------------------------------- table ----------------------------------- */

export function KeywordTable({
  rows,
  loading,
  caption,
  selected,
  onToggle,
  onToggleAll,
  onViewSerp,
  onAddToCollection,
  emptyState,
}: {
  rows: ReadonlyArray<KeywordRow>;
  loading: boolean;
  /** Accessible name for the table — say which tab it is. */
  caption: string;
  selected: ReadonlySet<string>;
  onToggle: (keyword: string) => void;
  onToggleAll: (checked: boolean) => void;
  onViewSerp: (row: KeywordRow) => void;
  onAddToCollection: (rows: KeywordRow[]) => void;
  emptyState?: React.ReactNode;
}) {
  return (
    <RowContext.Provider
      value={{ rows, selected, onToggle, onToggleAll, onViewSerp, onAddToCollection }}
    >
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        caption={caption}
        emptyState={emptyState}
        pageSize={25}
        maxHeight="38rem"
      />
    </RowContext.Provider>
  );
}

/** Re-exported so the results view can show what a page cost. */
export { CostChip };
