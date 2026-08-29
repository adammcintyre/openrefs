/**
 * The prompts manager.
 *
 * **The empty state is the important screen.** Nobody arrives here knowing
 * what an "AI visibility prompt" is, and a bare "No prompts yet" would leave
 * them to guess — expensively, since every guess is bought at LLM prices. So
 * the empty state explains the concept in two sentences and offers three
 * one-click starters built from the project's own name, each of which opens
 * the dialog pre-filled rather than adding anything: the chip is a draft, not
 * a purchase, and the dialog still shows the estimate before it spends.
 *
 * Removal is confirmed, because it takes the prompt's history with it. That is
 * not recoverable by re-adding: the answers were bought, and re-buying them
 * gets today's answers, not the ones from six weeks ago.
 */
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { useState } from "react";

import type { AiPrompt } from "../../../shared/ai";
import { AI_PROMPTS_MAX_PER_PROJECT } from "../../../shared/ai";
import type { Project } from "../../../shared/projects";
import { PromptDialog } from "../../components/ai/prompt-dialog";
import { PromptsTable } from "../../components/ai/prompts-table";
import { useDeleteAiPrompt } from "../../components/ai/queries";
import { starterPrompts } from "../../components/ai/starter-prompts";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  useToast,
} from "../../components/ui";
import { errorMessage } from "../../lib/api";

export function PromptsPanel({
  workspaceId,
  project,
  prompts,
  loading,
  runInProgress,
  canAdminister,
}: {
  workspaceId: string | null;
  project: Project;
  prompts: ReadonlyArray<AiPrompt>;
  loading: boolean;
  runInProgress: boolean;
  canAdminister: boolean;
}) {
  const { toast } = useToast();
  const remove = useDeleteAiPrompt(workspaceId, project.id);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiPrompt | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<AiPrompt | null>(null);

  const atCap = prompts.length >= AI_PROMPTS_MAX_PER_PROJECT;

  function openAdd(initialText = "") {
    setEditing(null);
    setDraft(initialText);
    setDialogOpen(true);
  }

  function openEdit(prompt: AiPrompt) {
    setEditing(prompt);
    setDraft("");
    setDialogOpen(true);
  }

  async function confirmRemoval() {
    const target = pendingRemoval;
    if (target === null) return;
    try {
      await remove.mutateAsync(target.id);
      setPendingRemoval(null);
      toast({
        title: "Prompt removed",
        description: "Its answers and history are gone too.",
        tone: "success",
      });
    } catch (caught) {
      setPendingRemoval(null);
      toast({
        title: "Could not remove that prompt",
        description: errorMessage(caught, "Something went wrong."),
        tone: "error",
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {runInProgress
            ? "A run is under way. Verdicts appear here as each answer lands."
            : "Every prompt runs against its engines once a week, and whenever you press Run now."}
        </p>
        {canAdminister ? (
          <Button
            onClick={() => openAdd()}
            disabled={atCap}
            title={
              atCap
                ? `A project can keep ${AI_PROMPTS_MAX_PER_PROJECT} prompts. Remove one to add another.`
                : "Write a question and pick the engines to run it against."
            }
          >
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            Add prompt
          </Button>
        ) : null}
      </div>

      <PromptsTable
        prompts={prompts}
        loading={loading}
        caption={`AI Visibility prompts for ${project.domain}`}
        onEdit={openEdit}
        onRemove={setPendingRemoval}
        emptyState={
          <ConceptEmptyState
            project={project}
            canAdminister={canAdminister}
            onPick={openAdd}
          />
        }
      />

      <PromptDialog
        workspaceId={workspaceId}
        projectId={project.id}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editing={editing}
        initialText={draft}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        onConfirm={() => void confirmRemoval()}
        loading={remove.isPending}
        title="Remove this prompt?"
        description={
          pendingRemoval === null
            ? undefined
            : `"${pendingRemoval.prompt}" and every answer recorded for it are deleted. Re-adding it starts a new history from today.`
        }
        confirmLabel="Remove prompt"
      />
    </div>
  );
}

/**
 * The concept, in two sentences, plus somewhere to start.
 *
 * The starters are anchored on the project's brand because that is the only
 * fact we have — and the copy says outright that the prompts worth tracking
 * usually name a category instead, so the chips read as examples of the shape
 * rather than as a recommended set.
 */
function ConceptEmptyState({
  project,
  canAdminister,
  onPick,
}: {
  project: Project;
  canAdminister: boolean;
  onPick: (text: string) => void;
}) {
  const suggestions = starterPrompts({
    name: project.name,
    domain: project.domain,
  });

  return (
    <EmptyState
      icon={Sparkles}
      title="Track what assistants say about you"
      description={`A prompt is a question someone might type into ChatGPT, Claude, Gemini or Perplexity when they are looking for what you sell. Each run records whether the answer mentioned ${project.domain} and whether it cited you as a source, so you can watch that change over the weeks.`}
      action={
        canAdminister ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-xs text-muted-foreground">
              Start from one of these, then edit it into the question your
              buyers actually ask — the useful ones usually name a category
              rather than your brand.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onPick(suggestion)}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:bg-tint hover:text-tint-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  // Says what the click does: opens a dialog, does not buy
                  // anything.
                  title={`Start a new prompt from "${suggestion}"`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => onPick("")}>
              <MessageSquarePlus className="size-3.5" aria-hidden="true" />
              Write my own
            </Button>
          </div>
        ) : null
      }
    />
  );
}
