/**
 * "Check now" — force a rank check outside the daily schedule.
 *
 * Three states worth naming, because the API has opinions about all of them:
 *
 * - **Admin only.** The route needs `admin`. Members get no button at all
 *   rather than a disabled one, since "you can't do this" is not information
 *   they can act on; the daily check runs for them regardless.
 * - **202, not 200.** The response means *queued*, not *checked*. The toast
 *   says minutes, and the table's own `checkInProgress` polling takes over
 *   from there.
 * - **429 within the hour.** The limiter is about money — each press buys one
 *   SERP per keyword — so being refused is a normal outcome, not a failure.
 *   It arrives with `nextAllowedAt`, which becomes a disabled button and a
 *   tooltip rather than a red error.
 *
 * The cost hint comes from `RANK_CHECK_COST_PER_KEYWORD_USD`, never a literal:
 * the price moved once already (DataForSEO re-based SERP billing in 2025-09,
 * which is why the figure in docs/specs/PHASE3.md is stale) and a number typed
 * into a component is a number nobody will remember to change.
 */
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { Project } from "../../../shared/projects";
import { RANK_CHECK_COST_PER_KEYWORD_USD } from "../../../shared/tracking";
import { ApiError, errorMessage } from "../../lib/api";
import { Button, useToast } from "../ui";
import { formatCostHint, pluralKeywords } from "./format";
import { nextAllowedAtFrom, useCheckNow } from "./queries";

/** Re-check the clock about twice a minute while a limit is in force. */
const TICK_MS = 30_000;

export function CheckNowButton({
  workspaceId,
  project,
  keywordCount,
  canCheck,
  checkInProgress,
}: {
  workspaceId: string | null;
  project: Project;
  keywordCount: number;
  /** False for members — the route would reject them with a 403. */
  canCheck: boolean;
  checkInProgress: boolean;
}) {
  const { toast } = useToast();
  const checkNow = useCheckNow(workspaceId, project.id);
  const [blockedUntil, setBlockedUntil] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /*
   * Only ticks while a limit is actually in force, so an idle header does not
   * re-render twice a minute forever.
   */
  useEffect(() => {
    if (blockedUntil === null) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [blockedUntil]);

  if (!canCheck) return null;

  const blocked = blockedUntil !== null && blockedUntil.getTime() > now;
  const estimate = keywordCount * RANK_CHECK_COST_PER_KEYWORD_USD;
  const noKeywords = keywordCount === 0;

  async function run() {
    try {
      const result = await checkNow.mutateAsync();
      setBlockedUntil(new Date(result.nextAllowedAt));
      toast({
        title: "Check queued",
        // "Queued", not "checked": a 202 has not measured anything yet.
        description: `${pluralKeywords(result.keywordCount)} · about ${formatCostHint(
          result.estimatedCostUsd,
        )}. Positions usually land within 5 to 20 minutes.`,
        tone: "success",
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "rate_limited") {
        const until = nextAllowedAtFrom(caught.details);
        setBlockedUntil(until ?? new Date(Date.now() + 60 * 60_000));
        toast({
          title: "Already checked this hour",
          description: caught.message,
          tone: "info",
        });
        return;
      }
      toast({
        title: "Could not queue the check",
        description: errorMessage(caught, "Something went wrong."),
        tone: "error",
      });
    }
  }

  return (
    <Button
      variant="secondary"
      onClick={() => void run()}
      loading={checkNow.isPending}
      disabled={blocked || noKeywords || checkInProgress}
      title={title({ blocked, blockedUntil, noKeywords, checkInProgress, estimate })}
    >
      <RefreshCw className="size-3.5" aria-hidden="true" />
      Check now
      {!blocked && !noKeywords && !checkInProgress ? (
        <span className="text-xs font-normal opacity-70">
          {`≈ ${formatCostHint(estimate)}`}
        </span>
      ) : null}
    </Button>
  );
}

/**
 * The tooltip. A disabled control has to say why it is disabled, and the three
 * reasons here are completely different problems.
 */
function title({
  blocked,
  blockedUntil,
  noKeywords,
  checkInProgress,
  estimate,
}: {
  blocked: boolean;
  blockedUntil: Date | null;
  noKeywords: boolean;
  checkInProgress: boolean;
  estimate: number;
}): string {
  if (noKeywords) return "Add some keywords first — there is nothing to check.";
  if (checkInProgress) return "A check is already running for this project.";
  if (blocked && blockedUntil !== null) {
    // A wall-clock time is right here: this is a rate-limit window, not a
    // day-grained snapshot date.
    return `Checked within the last hour. Available again at ${blockedUntil.toLocaleTimeString(
      undefined,
      { hour: "2-digit", minute: "2-digit" },
    )}.`;
  }
  if (blocked) return "Checked within the last hour. Try again later.";
  return `Queues a fresh position check for every tracked keyword. Estimated cost ${formatCostHint(
    estimate,
  )}.`;
}
