/**
 * Add / edit a prompt.
 *
 * One dialog for both, because the fields are identical and the only real
 * difference is what pressing the button *costs* — which is the thing this
 * screen has to be honest about:
 *
 * - **Adding is a purchase.** `POST /ai/prompts` enqueues the first run
 *   immediately (the API returns `runEnqueued: true` and deliberately does not
 *   consume the hourly limit). A dialog that said only "Add" would spend money
 *   on a button that reads like a form submit, so the footer carries the
 *   summed estimate and the copy says it runs now.
 * - **Editing is free.** `PATCH` never re-runs. The same footer therefore says
 *   so rather than quoting a price the edit will not incur.
 *
 * **The 500-character cap is enforced twice.** `maxLength` stops the typing and
 * a live counter shows the budget, so the limit is discoverable before it
 * bites; the server's 422 is still surfaced, because a client-side cap that is
 * the *only* check is a cap that silently disagrees with the API the day one
 * of them changes.
 */
import { useEffect, useState } from "react";

import type { AiEngineId, AiPrompt } from "../../../shared/ai";
import {
  AI_DEFAULT_ENGINES,
  AI_ENGINES,
  AI_PROMPT_MAX_CHARS,
  estimateRunCostUsd,
} from "../../../shared/ai";
import { errorMessage, fieldErrors } from "../../lib/api";
import { Button, Dialog, FieldError, Label, cn, useToast } from "../ui";
import { ENGINE_ORDER, formatEstimate, formatUsd } from "./format";
import { useCreateAiPrompt, useUpdateAiPrompt } from "./queries";

/** Below this the API 422s; matching it here keeps the message local. */
const MIN_CHARS = 3;

export function PromptDialog({
  workspaceId,
  projectId,
  open,
  onClose,
  /** The prompt being edited, or null to add a new one. */
  editing,
  /** Pre-fills the textarea — the empty state's starter chips use this. */
  initialText = "",
}: {
  workspaceId: string | null;
  projectId: string | null;
  open: boolean;
  onClose: () => void;
  editing: AiPrompt | null;
  initialText?: string;
}) {
  const { toast } = useToast();
  const create = useCreateAiPrompt(workspaceId, projectId);
  const update = useUpdateAiPrompt(workspaceId, projectId);

  const [text, setText] = useState("");
  const [engines, setEngines] = useState<AiEngineId[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const isEdit = editing !== null;
  const mutation = isEdit ? update : create;

  /*
   * Reset on open rather than on every render of a closed dialog: the fields
   * must start from the prompt being edited (or from a starter chip) each time
   * it is opened, but must not be yanked out from under someone mid-typing.
   */
  useEffect(() => {
    if (!open) return;
    setText(editing?.prompt ?? initialText);
    setEngines(
      editing === null ? [...AI_DEFAULT_ENGINES] : [...editing.engines],
    );
    setLocalError(null);
  }, [open, editing, initialText]);

  const trimmed = text.trim();
  const tooShort = trimmed.length < MIN_CHARS;
  const tooLong = text.length > AI_PROMPT_MAX_CHARS;
  const noEngines = engines.length === 0;
  const estimate = estimateRunCostUsd(engines);

  const serverFieldErrors = fieldErrors(mutation.error);
  const promptError =
    localError ?? serverFieldErrors.prompt?.[0] ?? undefined;
  const engineError = serverFieldErrors.engines?.[0] ?? undefined;

  function toggleEngine(engine: AiEngineId) {
    setEngines((current) =>
      current.includes(engine)
        ? current.filter((id) => id !== engine)
        : [...current, engine],
    );
  }

  async function submit() {
    if (tooShort) {
      setLocalError(`A prompt needs at least ${MIN_CHARS} characters.`);
      return;
    }
    if (tooLong) {
      setLocalError(`Prompts are limited to ${AI_PROMPT_MAX_CHARS} characters.`);
      return;
    }
    if (noEngines) {
      setLocalError("Pick at least one engine to run this prompt against.");
      return;
    }
    setLocalError(null);

    try {
      if (isEdit) {
        await update.mutateAsync({
          id: editing.id,
          body: { prompt: trimmed, engines },
        });
        toast({
          title: "Prompt updated",
          // Says what did *not* happen: the edit is free, and the numbers on
          // the results page still belong to the old wording until a run.
          description:
            "It runs with the new wording at the next scheduled or manual run.",
          tone: "success",
        });
      } else {
        const result = await create.mutateAsync({ prompt: trimmed, engines });
        toast({
          title: "Prompt added",
          description: result.runEnqueued
            ? `Running now against ${describeEngines(engines)} — results usually land within a couple of minutes.`
            : "It runs at the next scheduled run.",
          tone: "success",
        });
      }
      onClose();
    } catch (caught) {
      // A 422's per-field messages are already rendered inline; anything else
      // needs saying out loud.
      if (Object.keys(fieldErrors(caught)).length === 0) {
        toast({
          title: isEdit ? "Could not update the prompt" : "Could not add the prompt",
          description: errorMessage(caught, "Something went wrong."),
          tone: "error",
        });
      }
    }
  }

  const remaining = AI_PROMPT_MAX_CHARS - text.length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit prompt" : "Add a prompt"}
      description={
        isEdit
          ? "Changing a prompt does not re-run it, and costs nothing."
          : "A question someone might type into an AI assistant when they are looking for what you sell."
      }
      dismissible={!mutation.isPending}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {isEdit
              ? "No charge — edits run at the next scheduled run."
              : noEngines
                ? "Pick an engine to see the estimate."
                : `Runs immediately · ${formatEstimate(estimate)}`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              loading={mutation.isPending}
              disabled={tooShort || tooLong || noEngines}
            >
              {isEdit ? "Save changes" : "Add and run"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-prompt-text">Prompt</Label>
          <textarea
            id="ai-prompt-text"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setLocalError(null);
            }}
            rows={3}
            maxLength={AI_PROMPT_MAX_CHARS}
            aria-invalid={promptError !== undefined || undefined}
            aria-describedby="ai-prompt-count"
            placeholder="best photo booth template sites"
            className={cn(
              "w-full resize-y rounded-app border bg-surface px-3 py-2 text-sm text-foreground transition-colors",
              "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
              promptError !== undefined
                ? "border-danger"
                : "border-border hover:border-muted-foreground",
            )}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Ask it the way a buyer would, not the way you would describe your
              own site.
            </p>
            <p
              id="ai-prompt-count"
              // Announced only as it gets tight, so it is not read out on
              // every keystroke.
              aria-live={remaining <= 25 ? "polite" : "off"}
              className={cn(
                "text-xs tabular-nums",
                remaining <= 25 ? "text-warning-on-subtle" : "text-muted-foreground",
              )}
            >
              {`${text.length} / ${AI_PROMPT_MAX_CHARS}`}
            </p>
          </div>
          <FieldError>{promptError}</FieldError>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium text-foreground">
            Engines
          </legend>
          <div className="flex flex-col gap-1.5">
            {ENGINE_ORDER.map((id) => {
              const engine = AI_ENGINES[id];
              const checked = engines.includes(id);
              return (
                <label
                  key={id}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 rounded-app border px-3 py-2 transition-colors",
                    checked
                      ? "border-primary/40 bg-tint"
                      : "border-border hover:border-muted-foreground",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEngine(id)}
                      className="size-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <span
                      className={cn(
                        "text-sm font-medium",
                        checked ? "text-tint-foreground" : "text-foreground",
                      )}
                    >
                      {engine.label}
                    </span>
                  </span>
                  {/*
                    Per-engine prices differ by 6x, so the number belongs next
                    to the checkbox rather than only in the total. "est."
                    because it is one: see AI_COST_IS_AN_ESTIMATE.
                  */}
                  <span
                    className="text-xs tabular-nums text-muted-foreground"
                    title={`Estimated cost of one run of one prompt on ${engine.label}. The charge depends on the answer's length and whether the provider ran a web search.`}
                  >
                    {`${formatUsd(engine.estimatedCostUsd)} est.`}
                  </span>
                </label>
              );
            })}
          </div>
          <FieldError>{engineError}</FieldError>
          <p className="text-xs text-muted-foreground">
            Every engine you tick is a separate answer bought each run. Runs are
            scheduled weekly.
          </p>
        </fieldset>
      </div>
    </Dialog>
  );
}

/** "Perplexity and ChatGPT" — for a sentence, not a badge row. */
function describeEngines(engines: ReadonlyArray<AiEngineId>): string {
  const labels = engines.map((id) => AI_ENGINES[id]?.label ?? id);
  if (labels.length <= 1) return labels[0] ?? "no engines";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
