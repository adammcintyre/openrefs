/**
 * The headline strip: four numbers and the shape of the last two years.
 *
 * The deltas come from the history series rather than from a second overview
 * call — one purchase, two uses. They are month-over-month and captioned as
 * such, so nobody reads them as "since you last looked".
 */
import { useMemo } from "react";

import type { DomainHistoryPoint, RankMetrics } from "../../../shared/domains";
import { TrendLineChart } from "../../components/charts";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import {
  formatCount,
  formatMoney,
  formatPercentDelta,
  formatPeriod,
  formatTraffic,
  percentChange,
} from "../../components/domains/format";
import { ResultMetaChip } from "../../components/domains/result-meta-chip";
import {
  Badge,
  Card,
  EmptyState,
  MetricCard,
  Skeleton,
} from "../../components/ui";
import type { MetricDelta } from "../../components/ui";
import { useDomainHistory, useDomainOverview } from "./queries";
import type { DomainSearch } from "./url-state";

/** A percentage delta for a MetricCard, or nothing when it cannot be trusted. */
function monthDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
): MetricDelta | undefined {
  const change = percentChange(current, previous);
  if (change === null) return undefined;
  return {
    value: change,
    label: formatPercentDelta(change),
    caption: "vs. previous month",
  };
}

function pick(
  point: DomainHistoryPoint | undefined,
  side: "organic" | "paid",
): RankMetrics | undefined {
  return point?.[side];
}

export function DomainMetrics({
  workspaceId,
  search,
}: {
  workspaceId: string | null;
  search: DomainSearch;
}) {
  const overview = useDomainOverview(workspaceId, search, true);
  const history = useDomainHistory(workspaceId, search, true);

  const items = history.data?.items ?? [];
  const previousPoint = items.at(-2);
  const currentPoint = items.at(-1);

  const chartData = useMemo(
    () =>
      items.map((point) => ({
        period: formatPeriod(point.period),
        // null, not 0: a month DataForSEO did not report should be a gap in
        // the line, not a crash to the axis.
        organic:
          point.organic.traffic === null ? null : Math.round(point.organic.traffic),
        paid: point.paid.traffic === null ? null : Math.round(point.paid.traffic),
      })),
    [items],
  );

  const organic = overview.data?.organic;
  const paid = overview.data?.paid;
  const loading = overview.isPending;

  return (
    <div className="flex flex-col gap-4">
      {overview.error ? (
        <ApiErrorNotice
          error={overview.error}
          onRetry={() => void overview.refetch()}
          fallback="Could not load this domain's overview."
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Estimated monthly performance. Traffic figures are DataForSEO
          estimates, not measured analytics.
        </p>
        <ResultMetaChip meta={overview.data} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Organic traffic (est.)"
          value={formatTraffic(organic?.traffic)}
          loading={loading}
          delta={monthDelta(
            pick(currentPoint, "organic")?.traffic,
            pick(previousPoint, "organic")?.traffic,
          )}
          badge={
            organic?.trafficValueUsd === null ||
            organic?.trafficValueUsd === undefined ? null : (
              <Badge
                variant="neutral"
                title="What this organic traffic would cost to buy as ads each month."
              >
                {/* One interpolation, not two adjacent nodes: React splits
                    those with a comment marker, which breaks copy-paste. */}
                {`${formatMoney(organic.trafficValueUsd)}/mo value`}
              </Badge>
            )
          }
        />
        <MetricCard
          label="Organic keywords"
          value={formatCount(organic?.keywordCount)}
          loading={loading}
          delta={monthDelta(
            pick(currentPoint, "organic")?.keywordCount,
            pick(previousPoint, "organic")?.keywordCount,
          )}
        />
        <MetricCard
          label="Paid traffic (est.)"
          value={formatTraffic(paid?.traffic)}
          loading={loading}
          delta={monthDelta(
            pick(currentPoint, "paid")?.traffic,
            pick(previousPoint, "paid")?.traffic,
          )}
        />
        <MetricCard
          label="Paid keywords"
          value={formatCount(paid?.keywordCount)}
          loading={loading}
          delta={monthDelta(
            pick(currentPoint, "paid")?.keywordCount,
            pick(previousPoint, "paid")?.keywordCount,
          )}
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Traffic history
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Estimated monthly visits, organic and paid.
            </p>
          </div>
          <ResultMetaChip meta={history.data} />
        </div>

        {history.error ? (
          <ApiErrorNotice
            error={history.error}
            onRetry={() => void history.refetch()}
            fallback="Could not load the traffic history."
          />
        ) : history.isPending ? (
          <Skeleton className="h-[280px] w-full" />
        ) : chartData.length === 0 ? (
          <EmptyState
            title="No history available"
            description="DataForSEO has no historical rank data for this domain in this market."
          />
        ) : (
          <TrendLineChart
            data={chartData}
            xKey="period"
            series={[
              { dataKey: "organic", name: "Organic traffic (est.)" },
              { dataKey: "paid", name: "Paid traffic (est.)" },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
