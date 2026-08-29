/**
 * "Run now" — run every prompt in the project outside the weekly schedule.
 *
 * The same three states the rank-tracking equivalent has, with one difference
 * that matters: this button is materially more expensive. A rank check buys a
 * SERP per keyword at a fraction of a cent; this buys an LLM answer per prompt
 * *per engine*, and a single ChatGPT answer with a web search costs about
 * three cents. So the estimate is summed from the prompts' own engine lists —
 * not `prompts × a flat price` — and the tooltip spells out the multiplier.
 *
 * - **Admin only.** Members get no button rather than a disabled one; the
 *   weekly run happens for them regardless.
 * - **202, not 200.** The response means *queued*. Live LLM calls take
 *   seconds to a couple of minutes, and the list's own `runInProgress`
 *   polling takes over from there.
 * - **429 within the hour.** Being refused is a normal outcome — an
 *   assistant's answer to the same question does not change hour to hour — so
 *   it becomes a disabled button and a tooltip, never a red error.
 */
import { Play } from "lucide-react";
import { useEffect, useState } from "react";

import type { AiPrompt } from "../../../shared/ai";
import { estimateRunCostUsd } from "../../../shared/ai";
import { ApiError, errorMessage } from "../../lib/api";
import { Button, useToast } from "../ui";
import { describeRun, formatEstimate } from "./format";
import { nextAllowedAtFrom, useRunAiNow } from "./queries";

/** Re-check the clock about twice a minute while a limit is in force. */
const TICK_MS = 30_000;

/**
 * What one run of every prompt is estimated to cost.
 *
 * Summed per prompt over that prompt's own engines, because engines differ in
 * price by a factor of six and prompts do not have to share an engine list.
 */
export function estimateProjectRun(prompts: ReadonlyArray<AiPrompt>): {
  promptCount: number;
  callCount: number;
  estimatedCostUsd: number;
} {
  let callCount = 0;
  let total = 0;
  for (const prompt of prompts) {
    callCount += prompt.engines.length;
    total += estimateRunCostUsd(prompt.engines);
  }
  return {
    promptCount: prompts.length,
    callCount,
    estimatedCostUsd: Math.round(total * 1_000_000) / 1_000_000,
  };
}

export function RunNowButton({
  workspaceId,
  projectId,
  prompts,
  canRun,
  runInProgress,
}: {
  workspaceId: string | null;
  projectId: string | null;
  prompts: ReadonlyArray<AiPrompt>;
  /** False for members — the route would reject them with a 403. */
  canRun: boolean;
  runInProgress: boolean;
}) {
  const { toast } = useToast();
  const runNow = useRunAiNow(workspaceId, projectId);
  const [blockedUntil, setBlockedUntil] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /* Only ticks while a limit is in force, so an idle header stays idle. */
  useEffect(() => {
    if (blockedUntil === null) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [blockedUntil]);

  if (!canRun) return null;

  const blocked = blockedUntil !== null && blockedUntil.getTime() > now;
  const { promptCount, callCount, estimatedCostUsd } =
    estimateProjectRun(prompts);
  const noPrompts = promptCount === 0 || callCount === 0;

  async function run() {
    try {
      const result = await runNow.mutateAsync();
      setBlockedUntil(new Date(result.nextAllowedAt));
      toast({
        title: "Run queued",
        // "Queued", and the estimate stays hedged: the real figure is the sum
        // of costUsd across the snapshots this run writes.
        description: `${describeRun(result.promptCount, result.callCount)} · ${formatEstimate(
          result.estimatedCostUsd,
        )}. Answers usually land within a couple of minutes.`,
        tone: "success",
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "rate_limited") {
        const until = nextAllowedAtFrom(caught.details);
        setBlockedUntil(until ?? new Date(Date.now() + 60 * 60_000));
        toast({
          title: "Already run this hour",
          description: caught.message,
          tone: "info",
        });
        return;
      }
      toast({
        title: "Could not queue the run",
        description: errorMessage(caught, "Something went wrong."),
        tone: "error",
      });
    }
  }

  return (
    <Button
      variant="secondary"
      onClick={() => void run()}
      loading={runNow.isPending}
      disabled={blocked || noPrompts || runInProgress}
      title={titleFor({
        blocked,
        blockedUntil,
        noPrompts,
        runInProgress,
        callCount,
        promptCount,
        estimatedCostUsd,
      })}
    >
      <Play className="size-3.5" aria-hidden="true" />
      Run now
      {!blocked && !noPrompts && !runInProgress ? (
        <span className="text-xs font-normal opacity-70">
          {formatEstimate(estimatedCostUsd)}
        </span>
      ) : null}
    </Button>
  );
}

/** A disabled control has to say why, and these four reasons differ entirely. */
function titleFor({
  blocked,
  blockedUntil,
  noPrompts,
  runInProgress,
  callCount,
  promptCount,
  estimatedCostUsd,
}: {
  blocked: boolean;
  blockedUntil: Date | null;
  noPrompts: boolean;
  runInProgress: boolean;
  callCount: number;
  promptCount: number;
  estimatedCostUsd: number;
}): string {
  if (noPrompts) return "Add a prompt first — there is nothing to run.";
  if (runInProgress) return "A run is already under way for this project.";
  if (blocked && blockedUntil !== null) {
    // A wall-clock time, not a date: this is a one-hour window, not a
    // day-grained snapshot.
    return `Run within the last hour. Available again at ${blockedUntil.toLocaleTimeString(
      undefined,
      { hour: "2-digit", minute: "2-digit" },
    )}.`;
  }
  if (blocked) return "Run within the last hour. Try again later.";
  return `Runs every prompt against every engine it lists — ${describeRun(
    promptCount,
    callCount,
  )}. Estimated ${formatEstimate(estimatedCostUsd)}; the real cost is shown per answer once they land. Prompts also run automatically once a week.`;
}
