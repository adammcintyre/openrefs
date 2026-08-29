/**
 * The latest-runs table: the newest answer per prompt × engine in the window.
 *
 * Every row is a drill-down trigger. The whole row is clickable *and* the
 * prompt cell is a real button, rather than the row carrying an onClick alone
 * — a click handler on a `<tr>` is invisible to the keyboard, and this is the
 * only route to the excerpt and the citations.
 *
 * **The cost column is the real charge.** `snapshot.costUsd` is what
 * DataForSEO billed for that one answer, not the estimate the run was quoted
 * at before it happened. The two are formatted by different helpers precisely
 * so this column cannot drift into showing a guess.
 */
import { ChevronRight } from "lucide-react";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { AiSnapshotDetail } from "../../../shared/ai";
import { DataTable, createDataTableColumns, cn } from "../ui";
import type { DataTableColumn } from "../ui";
import { engineLabel, formatDay, formatSpend } from "./format";
import { EngineBadge, VerdictBadge } from "./verdicts";

/** A snapshot plus the prompt text the table shows in its first column. */
export interface RunRow extends AiSnapshotDetail {
  promptText: string;
}

/* ------------------------------- row context ------------------------------- */

const RowContext = createContext<((row: RunRow) => void) | null>(null);

function useOpen(): (row: RunRow) => void {
  const open = useContext(RowContext);
  if (open === null) {
    throw new Error("Runs table cells must render inside <RunsTable>");
  }
  return open;
}

/* ---------------------------------- cells ---------------------------------- */

/**
 * The prompt cell, which is also the row's control.
 *
 * A button rather than a link: this opens a dialog over the current view, so
 * there is no URL to navigate to and a link would lie about that.
 */
function PromptCell({ row }: { row: RunRow }) {
  const open = useOpen();
  return (
    <button
      type="button"
      onClick={() => open(row)}
      className="group flex max-w-md items-start gap-1.5 text-left"
      aria-label={`Open the ${engineLabel(row.engine)} answer to "${row.promptText}" from ${formatDay(row.date)}`}
    >
      <span className="font-medium break-words text-foreground group-hover:text-primary group-hover:underline">
        {row.promptText}
      </span>
      <ChevronRight
        className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary"
        aria-hidden="true"
      />
    </button>
  );
}

/* -------------------------------- columns ---------------------------------- */

const col = createDataTableColumns<RunRow>();

const columns: Array<DataTableColumn<RunRow>> = [
  col.accessor("promptText", {
    header: "Prompt",
    cell: (info) => <PromptCell row={info.row.original} />,
  }),
  col.accessor("engine", {
    header: "Engine",
    cell: (info) => <EngineBadge engine={info.row.original.engine} />,
  }),
  col.accessor("mentioned", {
    header: "Mentioned",
    cell: (info) => (
      <VerdictBadge
        value={info.row.original.mentioned}
        yes="Yes"
        no="No"
        title="Whether the answer named your site."
      />
    ),
  }),
  col.accessor("cited", {
    header: "Cited",
    cell: (info) => (
      <VerdictBadge
        value={info.row.original.cited}
        yes="Yes"
        no="No"
        title="Whether the answer linked your site as a source."
      />
    ),
  }),
  col.accessor((row) => row.citations.length, {
    id: "citationCount",
    header: "Sources",
    cell: (info) => {
      const { citations } = info.row.original;
      const ours = citations.filter((citation) => citation.ours).length;
      return (
        <span
          className="tabular-nums text-muted-foreground"
          title={
            ours > 0
              ? `${citations.length} sources cited, ${ours} of them yours.`
              : `${citations.length} sources cited, none of them yours.`
          }
        >
          {citations.length}
        </span>
      );
    },
  }),
  col.accessor("costUsd", {
    id: "costUsd",
    header: () => (
      <span title="What this answer actually cost. Not an estimate.">Cost</span>
    ),
    cell: (info) => (
      <span className="tabular-nums text-muted-foreground">
        {formatSpend(info.row.original.costUsd)}
      </span>
    ),
  }),
  col.accessor("date", {
    header: "Run",
    cell: (info) => (
      <span className="whitespace-nowrap text-muted-foreground">
        {formatDay(info.row.original.date)}
      </span>
    ),
  }),
];

/* --------------------------------- table ----------------------------------- */

export function RunsTable({
  rows,
  loading,
  caption,
  onOpen,
  emptyState,
  className = "",
}: {
  rows: ReadonlyArray<RunRow>;
  loading: boolean;
  caption: string;
  onOpen: (row: RunRow) => void;
  emptyState?: ReactNode;
  className?: string;
}) {
  return (
    <RowContext.Provider value={onOpen}>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        caption={caption}
        emptyState={emptyState}
        pageSize={25}
        maxHeight="40rem"
        className={cn(className)}
      />
    </RowContext.Provider>
  );
}
