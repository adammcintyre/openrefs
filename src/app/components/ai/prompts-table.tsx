/**
 * The prompts manager's table.
 *
 * Structured like the other DataTables in the app — column definitions at
 * module scope so a row action cannot churn TanStack's sort and pagination
 * state, and the cells reach the handlers through a context rather than by
 * closing over them.
 *
 * **The verdict columns are a matrix, and they align by construction.** A
 * prompt can list one engine or four, so "mentioned" is not one value per row;
 * it is one per engine. Engines, Mentioned and Cited each render a vertical
 * stack driven by the same `statuses` array in the same order, which is what
 * makes row three of the Engines column and row three of the Mentioned column
 * describe the same engine. Every mark also carries its engine in its
 * accessible name, so the meaning survives without the visual alignment.
 */
import { Pencil, Trash2 } from "lucide-react";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { AiEngineStatus, AiPrompt } from "../../../shared/ai";
import { Button, DataTable, createDataTableColumns } from "../ui";
import type { DataTableColumn } from "../ui";
import { engineLabel, formatLastRun } from "./format";
import { EngineBadge, VerdictMark } from "./verdicts";

/* ------------------------------- row context ------------------------------- */

interface PromptsTableContext {
  onEdit: (prompt: AiPrompt) => void;
  onRemove: (prompt: AiPrompt) => void;
}

const RowContext = createContext<PromptsTableContext | null>(null);

function useRowContext(): PromptsTableContext {
  const context = useContext(RowContext);
  if (context === null) {
    throw new Error("Prompts table cells must render inside <PromptsTable>");
  }
  return context;
}

/* ---------------------------------- cells ---------------------------------- */

/**
 * One stacked cell per engine.
 *
 * The empty case is real: a prompt whose engines were all retired has no
 * statuses, and a run skips it entirely. Saying so beats an empty cell.
 */
function EngineStack({
  statuses,
  render,
}: {
  statuses: ReadonlyArray<AiEngineStatus>;
  render: (status: AiEngineStatus) => ReactNode;
}) {
  if (statuses.length === 0) {
    return <span className="text-xs text-muted-foreground italic">—</span>;
  }
  return (
    <span className="flex flex-col items-start gap-1">
      {statuses.map((status) => (
        <span key={status.engine} className="flex h-5 items-center">
          {render(status)}
        </span>
      ))}
    </span>
  );
}

function ActionsCell({ prompt }: { prompt: AiPrompt }) {
  const { onEdit, onRemove } = useRowContext();
  // The prompt text goes in the accessible name: a table of "Edit" buttons is
  // a list of identical links to anyone navigating by control.
  const short =
    prompt.prompt.length > 40
      ? `${prompt.prompt.slice(0, 40)}…`
      : prompt.prompt;

  return (
    <div className="flex justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onEdit(prompt)}
        aria-label={`Edit prompt "${short}"`}
        title="Edit this prompt"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onRemove(prompt)}
        aria-label={`Remove prompt "${short}"`}
        title="Remove this prompt"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

/* -------------------------------- columns ---------------------------------- */

const col = createDataTableColumns<AiPrompt>();

const columns: Array<DataTableColumn<AiPrompt>> = [
  col.accessor("prompt", {
    header: "Prompt",
    cell: (info) => (
      <span className="block max-w-md font-medium break-words">
        {info.getValue<string>()}
      </span>
    ),
  }),
  col.display({
    id: "engines",
    header: "Engines",
    cell: (info) => (
      <EngineStack
        statuses={info.row.original.statuses}
        render={(status) => <EngineBadge engine={status.engine} />}
      />
    ),
  }),
  col.display({
    id: "mentioned",
    header: () => (
      <span title="Did the assistant's latest answer name your site?">
        Mentioned
      </span>
    ),
    cell: (info) => (
      <EngineStack
        statuses={info.row.original.statuses}
        render={(status) => (
          <VerdictMark
            value={status.mentioned}
            label="Mentioned"
            engine={status.engine}
          />
        )}
      />
    ),
  }),
  col.display({
    id: "cited",
    header: () => (
      <span title="Did it link your site as a source? Independent of being mentioned.">
        Cited
      </span>
    ),
    cell: (info) => (
      <EngineStack
        statuses={info.row.original.statuses}
        render={(status) => (
          <VerdictMark
            value={status.cited}
            label="Cited"
            engine={status.engine}
          />
        )}
      />
    ),
  }),
  col.accessor((row) => row.lastRunAt ?? undefined, {
    id: "lastRun",
    header: "Last run",
    cell: (info) => {
      const { lastRunAt, statuses } = info.row.original;
      return (
        <span
          className={
            lastRunAt === null
              ? "text-xs text-muted-foreground italic"
              : "text-muted-foreground"
          }
          title={
            lastRunAt === null
              ? "This prompt has not been answered yet."
              : perEngineRunSummary(statuses)
          }
        >
          {formatLastRun(lastRunAt)}
        </span>
      );
    },
  }),
  col.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: (info) => <ActionsCell prompt={info.row.original} />,
  }),
];

/** "Perplexity: 2026-08-29 · ChatGPT: never run" — the tooltip on Last run. */
function perEngineRunSummary(
  statuses: ReadonlyArray<AiEngineStatus>,
): string {
  if (statuses.length === 0) return "No engines on this prompt.";
  return statuses
    .map(
      (status) =>
        `${engineLabel(status.engine)}: ${status.lastRunDate ?? "never run"}`,
    )
    .join(" · ");
}

/* --------------------------------- table ----------------------------------- */

export function PromptsTable({
  prompts,
  loading,
  caption,
  onEdit,
  onRemove,
  emptyState,
}: {
  prompts: ReadonlyArray<AiPrompt>;
  loading: boolean;
  caption: string;
  onEdit: (prompt: AiPrompt) => void;
  onRemove: (prompt: AiPrompt) => void;
  emptyState?: ReactNode;
}) {
  return (
    <RowContext.Provider value={{ onEdit, onRemove }}>
      <DataTable
        columns={columns}
        data={prompts}
        loading={loading}
        caption={caption}
        emptyState={emptyState}
        pageSize={25}
        maxHeight="40rem"
      />
    </RowContext.Provider>
  );
}
