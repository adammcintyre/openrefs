/**
 * The results area: the trend, the latest runs, and the drill-down.
 *
 * One request serves all three. `GET /ai/results` returns the timelines, the
 * newest snapshot per prompt × engine *with its excerpt and citations*, and
 * the prompt text to label them by — so opening a row costs nothing and the
 * dialog needs no fetch of its own.
 *
 * **The spend figure here is real.** It sums `costUsd` across the snapshots on
 * screen, which is what DataForSEO charged, and is labelled as the window's
 * actual spend rather than as an estimate. Everything that quotes a price
 * *before* a run says "est." instead; the two are deliberately different
 * functions in `components/ai/format.ts`.
 */
import { Inbox, MessageSquarePlus } from "lucide-react";
import { useMemo, useState } from "react";

import type { Project } from "../../../shared/projects";
import { MentionRateChart } from "../../components/ai/mention-rate-chart";
import { useAiResults } from "../../components/ai/queries";
import {
  DEFAULT_WINDOW,
  RESULT_WINDOWS,
  isResultWindowId,
  windowRange,
} from "../../components/ai/range";
import type { ResultWindowId } from "../../components/ai/range";
import { RunsTable } from "../../components/ai/runs-table";
import type { RunRow } from "../../components/ai/runs-table";
import { SnapshotDialog } from "../../components/ai/snapshot-dialog";
import { formatSpend, pluralPrompts, totalSpend } from "../../components/ai/format";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import {
  Button,
  EmptyState,
  Label,
  Select,
  Skeleton,
} from "../../components/ui";

export function ResultsPanel({
  workspaceId,
  project,
  hasPrompts,
  runInProgress,
  onAddPrompts,
}: {
  workspaceId: string | null;
  project: Project;
  hasPrompts: boolean;
  runInProgress: boolean;
  /** Switches to the prompts tab — the only useful action with no prompts. */
  onAddPrompts: () => void;
}) {
  const [windowId, setWindowId] = useState<ResultWindowId>(DEFAULT_WINDOW);
  const [selected, setSelected] = useState<RunRow | null>(null);

  /*
   * Recomputed per render rather than memoised on a clock: the window only
   * moves at UTC midnight, and pinning it in state would leave a long-lived
   * tab asking for yesterday.
   */
  const range = windowRange(windowId);
  const query = useAiResults(workspaceId, project.id, range);

  const data = query.data;

  /*
   * The table wants the prompt's text on every row; the payload keeps prompts
   * in a separate list so a long prompt is not repeated once per engine.
   */
  const rows = useMemo<RunRow[]>(() => {
    if (data === undefined) return [];
    const textById = new Map(data.prompts.map((p) => [p.id, p.prompt]));
    return data.latest.map((snapshot) => ({
      ...snapshot,
      promptText: textById.get(snapshot.promptId) ?? "(prompt removed)",
    }));
  }, [data]);

  const spend = useMemo(() => totalSpend(rows), [rows]);

  if (!hasPrompts) {
    return (
      <EmptyState
        icon={MessageSquarePlus}
        title="Nothing has run yet"
        description="Results appear once this project has at least one prompt and that prompt has been answered. Adding a prompt runs it straight away."
        action={
          <Button variant="secondary" onClick={onAddPrompts}>
            Add a prompt
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor="ai-results-window" className="whitespace-nowrap">
            Window
          </Label>
          <Select
            id="ai-results-window"
            value={windowId}
            onChange={(event) => {
              const next = event.target.value;
              if (isResultWindowId(next)) setWindowId(next);
            }}
            className="w-44"
          >
            {RESULT_WINDOWS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        {rows.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {/*
              Real money, not an estimate — and scoped honestly to the answers
              actually on screen rather than implying it is the window's whole
              bill.
            */}
            <span title="The sum of what these answers cost. Not an estimate.">
              {`${formatSpend(spend)} spent on the ${rows.length === 1 ? "answer" : `${rows.length} answers`} shown`}
            </span>
          </p>
        ) : null}
      </div>

      {query.isError ? (
        <ApiErrorNotice
          error={query.error}
          onRetry={() => void query.refetch()}
          fallback="Could not load this project's AI results."
        />
      ) : query.isPending ? (
        <ResultsSkeleton />
      ) : (
        <>
          <MentionRateChart timelines={data?.timelines ?? []} />

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Latest runs
              </h2>
              <p className="text-xs text-muted-foreground">
                The newest answer per prompt and engine in this window. Open a
                row for the answer text and its sources.
              </p>
            </div>

            <RunsTable
              rows={rows}
              loading={false}
              caption={`Latest AI answers for ${project.domain}`}
              onOpen={setSelected}
              emptyState={
                <EmptyState
                  icon={Inbox}
                  title={
                    runInProgress
                      ? "The first answers are on their way"
                      : "No answers in this window"
                  }
                  description={
                    runInProgress
                      ? "A run is under way. Each answer appears here as it lands, usually within a couple of minutes."
                      : `Nothing ran for ${pluralPrompts(data?.prompts.length ?? 0)} in this period. Prompts run once a week, or press Run now.`
                  }
                />
              }
            />
          </div>
        </>
      )}

      <SnapshotDialog
        snapshot={selected}
        promptText={selected?.promptText ?? ""}
        domain={project.domain}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading AI visibility results…</span>
      <Skeleton className="h-96 w-full rounded-app" />
      <Skeleton className="h-80 w-full rounded-app" />
    </div>
  );
}
