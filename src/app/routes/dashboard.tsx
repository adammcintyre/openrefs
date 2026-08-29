/**
 * The workspace home screen.
 *
 * Every number here is real and comes from one request — `GET /api/v1/dashboard`
 * — which reads tables we already own. Nothing on this screen calls DataForSEO:
 * it is the first thing you see after logging in and it must not cost a
 * fraction of a cent to look at, nor fail on a workspace that has no
 * credentials yet.
 *
 * **This screen used to be sample data**, badged "Sample" on every card plus a
 * twelve-month traffic chart that was invented outright. The cards are now the
 * rollup. The chart is gone rather than reworked: the rollup is six scalars with
 * no time series behind them, and the only way to keep a chart would have been
 * to keep making one up.
 *
 * **Null is not zero, and the distinction is the whole point of the contract.**
 * `avgPosition: null` means nothing ranks — there is no average of nothing — and
 * renders as an em dash. `top10Count: 0` is a true statement about a real empty
 * set and renders as "0". Showing 0 for an unknown average is the one mistake
 * the shape in src/shared/dashboard.ts exists to prevent.
 *
 * **No deltas.** MetricCard offers them and the temptation is real, but the
 * rollup carries no previous-period figures, so any arrow here would be
 * invented — which is exactly what this change removed.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, KeyRound } from "lucide-react";
import { Link } from "react-router";

import type { DashboardRollup } from "../../shared/dashboard";
import {
  /*
   * The same "never round a real charge down to $0.00" rule the audit cost
   * hints use: a workspace that has spent $0.004 this month has not spent
   * nothing, and "$0.00" would say it had.
   */
  formatCostHint,
} from "../components/audit/cost";
import { ApiErrorNotice } from "../components/domains/api-error-notice";
import { EM_DASH, formatCount } from "../components/domains/format";
import { Card } from "../components/ui/card";
import { MetricCard } from "../components/ui/metric-card";
import { PageHeader } from "../components/ui/page-header";
import { api } from "../lib/api";
import { DATAFORSEO_SIGNUP_URL } from "../lib/constants";
import { useActiveWorkspace } from "../lib/workspaces";

export const dashboardKey = (workspaceId: string) =>
  ["dashboard", workspaceId] as const;

function useDashboard(workspaceId: string | null) {
  return useQuery({
    queryKey: dashboardKey(workspaceId ?? ""),
    queryFn: () =>
      api.get<DashboardRollup>(
        `/dashboard?workspace=${encodeURIComponent(workspaceId ?? "")}`,
      ),
    enabled: workspaceId !== null,
  });
}

export function Dashboard() {
  const {
    activeWorkspace,
    activeWorkspaceId,
    isPending: workspacePending,
  } = useActiveWorkspace();

  const query = useDashboard(activeWorkspaceId);
  const rollup = query.data ?? null;
  const loading = workspacePending || query.isPending;

  const credentialsConfigured =
    activeWorkspace?.credentials.configured ?? true;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Dashboard"
        description="Workspace activity, recent research and spend at a glance."
      />

      {query.isError ? (
        <ApiErrorNotice
          error={query.error}
          onRetry={() => void query.refetch()}
          fallback="Could not load this workspace's numbers."
          className="mb-6"
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Tracked keywords"
          value={formatCount(rollup?.trackedKeywords)}
          loading={loading}
        />
        <MetricCard
          label="Average position"
          value={formatAveragePosition(rollup?.avgPosition)}
          loading={loading}
        />
        <MetricCard
          label="Keywords in the top 10"
          value={formatCount(rollup?.top10Count)}
          loading={loading}
        />
        <MetricCard
          label="Keyword collections"
          value={formatCount(rollup?.collections)}
          loading={loading}
        />
        <MetricCard
          label="API spend this month"
          value={
            rollup === null ? EM_DASH : formatCostHint(rollup.monthSpendUsd)
          }
          loading={loading}
        />
        <MetricCard
          label="Latest audit score"
          value={formatAuditScore(rollup?.latestAuditScore)}
          loading={loading}
        />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Where these come from
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Every figure above is read from this workspace's own data — tracked
          keywords and their latest positions, saved collections, the audit that
          finished most recently, and the DataForSEO charges metered this
          calendar month. Opening this page costs nothing: it makes no calls to
          DataForSEO.
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          An em dash means there is nothing to average yet, not zero — a
          workspace tracking no keywords has no average position, and a
          workspace whose first audit has not finished has no score.
        </p>
      </Card>

      {/* The one thing a new workspace actually has to do. */}
      {credentialsConfigured ? null : <ConnectKeyCallout />}
    </div>
  );
}

/**
 * The average position.
 *
 * One decimal, and an em dash for null — see the file header. Down-is-good as a
 * metric, but with no comparison figure there is no direction to colour.
 */
function formatAveragePosition(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return value.toFixed(1);
}

/** The most recent finished audit's Page Score, out of 100. */
function formatAuditScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} / 100`;
}

function ConnectKeyCallout() {
  return (
    <Card className="mt-6 border-primary/40 bg-tint p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface">
          <KeyRound className="size-5 text-primary" aria-hidden="true" />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-base font-semibold tracking-tight text-tint-foreground">
            Connect your DataForSEO key
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-tint-foreground/90">
            OpenRefs has no data of its own — it queries DataForSEO with{" "}
            <strong className="font-semibold">your</strong> account, so you buy
            API credits directly at cost and we never mark them up or resell
            them. Until a key is saved, every research screen will come back
            empty: nothing above can grow.
          </p>
          <p className="text-sm leading-relaxed text-tint-foreground/90">
            Your credentials are encrypted before they are stored, and a
            per-workspace spend cap stops runaway queries.
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-4">
            <Link
              to="/app/settings"
              className="inline-flex items-center gap-1.5 rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Add your key in Settings
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <a
              href={DATAFORSEO_SIGNUP_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium text-tint-foreground underline underline-offset-4 hover:no-underline"
            >
              Get a DataForSEO account
            </a>
          </div>
        </div>
      </div>
    </Card>
  );
}
