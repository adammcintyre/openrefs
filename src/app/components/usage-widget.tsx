import { Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import type { UsageResponse } from "../../shared/api";
import { APP_VERSION } from "../../shared/version";
import { api } from "../lib/api";
import { useActiveWorkspace } from "../lib/workspaces";
import { Skeleton } from "./ui/skeleton";
import { cn } from "./ui/cn";

/**
 * Month-to-date DataForSEO spend, at the foot of the sidebar.
 *
 * The numbers are real: `GET /api/v1/usage` is a cheap D1 rollup of the
 * `api_usage` rows the client writes on every billed call, so it retries like
 * any ordinary read and does not spend a thing to render. The cap comes off the
 * active workspace the switcher already loaded rather than from a second
 * request — it is a field on the workspace, and asking twice for it would make
 * the sidebar depend on two round trips instead of one.
 *
 * Three rules about honesty here, because a spend readout that flatters is
 * worse than no readout:
 *
 *  - **A cap of 0 is not "no cap".** It is the setting that blocks every paid
 *    call, so it says so instead of dividing by zero and rendering an empty bar
 *    that looks like plenty of headroom.
 *  - **No cap is not an infinite cap.** With no denominator there is no bar —
 *    just the figure and the word. `Workspace.spendCapUsd` is a required number
 *    today, so this is the defensive path (the workspace list not being loaded
 *    yet), kept because "unknown" and "unlimited" must never render alike.
 *  - **A failure renders nothing.** This widget is an aside in a frame that
 *    wraps every screen in the app; an error box here would follow the user
 *    into every module to report something they cannot act on.
 *
 * There is no settings view dedicated to usage yet, so "Manage" points at
 * /app/settings, which is where the cap it is measuring against is set.
 */

/** The spend is a D1 read, but not one worth re-asking for on every focus. */
const USAGE_STALE_TIME = 5 * 60_000;

export const usageKeys = {
  month: (workspaceId: string) => ["usage", "month", workspaceId] as const,
};

/** This calendar month's spend for one workspace. Free; retries normally. */
export function useUsage(workspaceId: string | null) {
  return useQuery({
    queryKey: usageKeys.month(workspaceId ?? ""),
    queryFn: () =>
      api.get<UsageResponse>(
        `/usage?${new URLSearchParams({ workspace: workspaceId ?? "" })}`,
      ),
    enabled: workspaceId !== null,
    staleTime: USAGE_STALE_TIME,
  });
}

const MONEY = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Spend against cap as a percentage, or null when there is no denominator.
 *
 * A cap of 0 returns 100 rather than null or NaN: every paid call is blocked,
 * which is a full bar, not an empty one.
 */
export function usagePercent(
  spentUsd: number,
  capUsd: number | null | undefined,
): number | null {
  if (capUsd === null || capUsd === undefined || !Number.isFinite(capUsd)) {
    return null;
  }
  if (capUsd <= 0) return 100;
  return Math.min(100, Math.round((spentUsd / capUsd) * 100));
}

/** The bar's colour. Amber approaching the cap, red at it — never only colour. */
function barTone(pct: number): string {
  if (pct >= 100) return "bg-danger";
  if (pct >= 80) return "bg-warning";
  return "bg-primary";
}

export function UsageWidget({ collapsed = false }: { collapsed?: boolean }) {
  const { activeWorkspace, activeWorkspaceId } = useActiveWorkspace();
  const usage = useUsage(activeWorkspaceId);

  /*
   * A failed or absent read renders nothing at all. See rule 3 in the file
   * header: this sits in the app frame, so its failure mode has to be silence.
   */
  if (usage.isError || activeWorkspaceId === null) return null;

  if (usage.isPending) {
    return collapsed ? (
      <div className="flex flex-col items-center gap-1 border-t border-border px-2 py-3">
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-3 w-6" />
      </div>
    ) : (
      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-1.5 w-full rounded-full" />
      </div>
    );
  }

  const spentUsd = usage.data.totalUsd;
  const capUsd = activeWorkspace?.spendCapUsd ?? null;
  const pct = usagePercent(spentUsd, capUsd);
  const blocked = capUsd !== null && capUsd <= 0;

  const spend = MONEY.format(spentUsd);
  const summary =
    pct === null
      ? `${spend} spent this month, no cap set.`
      : blocked
        ? `${spend} spent this month. The cap is $0.00, so paid calls are blocked.`
        : `${spend} of ${MONEY.format(capUsd ?? 0)} monthly cap used — ${pct}%.`;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border px-2 py-3">
        <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
        <span
          className="text-[10px] font-medium tabular-nums text-muted-foreground"
          title={summary}
        >
          {/* No cap means no percentage to show; the money is the fact. */}
          {pct === null ? spend : `${pct}%`}
        </span>
        <span className="sr-only">{summary}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Wallet className="size-3.5 text-muted-foreground" aria-hidden="true" />
          API spend
        </span>
        <Link
          to="/app/settings"
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
          title="Change this workspace's monthly spend cap."
        >
          {capUsd === null ? "Set a cap" : "Manage"}
        </Link>
      </div>

      <p className="text-xs tabular-nums text-muted-foreground">
        <span className="font-medium text-foreground">{spend}</span>{" "}
        {capUsd === null
          ? "spent · no cap"
          : blocked
            ? "spent · paid calls blocked"
            : `of ${MONEY.format(capUsd)} cap`}
      </p>

      {/*
        Native progress semantics via role + aria-value*, so the bar is
        announced as "14 percent" rather than as two empty divs. Omitted
        entirely with no cap: a bar needs a denominator to mean anything.
      */}
      {pct === null ? null : (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Monthly API spend against cap"
          title={summary}
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
        >
          <div
            className={cn("h-full rounded-full", barTone(pct))}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        This calendar month · v{APP_VERSION}
      </p>
    </div>
  );
}
