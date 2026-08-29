/**
 * The headline strip: four numbers and the shape of the link profile over time.
 *
 * The deltas come from the history series rather than from a second summary
 * call — one purchase, two uses — and are month-over-month, captioned as such,
 * so nobody reads them as "since you last looked".
 *
 * Domain Score leads because it is the question people open this screen with.
 * It is already 0–100 when it arrives (the Worker normalised it once, in
 * `dataforseo/scores.ts`); nothing here scales it, and the band thresholds come
 * from `scoreBand()` in the shared types so the card, the table badges and the
 * CSV cannot drift apart.
 */
import { useMemo } from "react";

import type { BacklinksHistoryPoint } from "../../../shared/backlinks";
import { scoreBand } from "../../../shared/backlinks";
import {
  bandLabel,
  formatDofollow,
  formatScore,
  formatSeen,
  scoreTextClass,
  variantForScore,
} from "../../components/backlinks/format";
import { TrendLineChart } from "../../components/charts";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import {
  formatCount,
  formatPercentDelta,
  formatPeriod,
  percentChange,
} from "../../components/domains/format";
import { ResultMetaChip } from "../../components/domains/result-meta-chip";
import {
  Badge,
  Card,
  EmptyState,
  MetricCard,
  Skeleton,
  cn,
} from "../../components/ui";
import type { MetricDelta } from "../../components/ui";
import type { HistoryRange } from "./history-range";
import { HISTORY_RANGES, RANGE_LABELS, RANGE_SHORT, historySeries } from "./history-range";
import { useBacklinksHistory, useBacklinksSummary } from "./queries";

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

/**
 * Domain Score moves in points, not percent.
 *
 * "Up 4.2%" on a 0–100 index is a sentence with no meaning attached to it;
 * "+3 pts" is the thing that actually happened.
 */
function pointsDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
): MetricDelta | undefined {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined
  ) {
    return undefined;
  }
  const change = Math.round(current) - Math.round(previous);
  return {
    value: change,
    label: `${change > 0 ? "+" : ""}${change} pts`,
    caption: "vs. previous month",
  };
}

function RangePicker({
  value,
  onChange,
}: {
  value: HistoryRange;
  onChange: (range: HistoryRange) => void;
}) {
  return (
    <div
      role="group"
      aria-label="History range"
      className="inline-flex rounded-app border border-border p-0.5"
    >
      {HISTORY_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={value === range}
          aria-label={RANGE_LABELS[range]}
          onClick={() => onChange(range)}
          className={cn(
            "rounded-app px-3 py-1 text-xs font-medium transition-colors",
            value === range
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {RANGE_SHORT[range]}
        </button>
      ))}
    </div>
  );
}

export function BacklinksMetrics({
  workspaceId,
  target,
  range,
  onRangeChange,
}: {
  workspaceId: string | null;
  target: string;
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
}) {
  const summary = useBacklinksSummary(workspaceId, target, true);
  const history = useBacklinksHistory(workspaceId, target, true);

  const items: BacklinksHistoryPoint[] = history.data?.items ?? [];
  const previousPoint = items.at(-2);
  const currentPoint = items.at(-1);

  /*
   * The whole series is bought once and sliced here, so the range picker costs
   * nothing to press — see history-range.ts. Gap-filling turns months the
   * provider never reported into breaks in the line rather than into an
   * invented straight run between the months either side.
   */
  const chartData = useMemo(
    () =>
      historySeries(items, range).map((point) => ({
        period: formatPeriod(point.period),
        backlinks: point.backlinks,
        referringDomains: point.referringDomains,
      })),
    [items, range],
  );

  const data = summary.data;
  const loading = summary.isPending;
  const band = scoreBand(data?.domainScore);

  return (
    <div className="flex flex-col gap-4">
      {summary.error ? (
        <ApiErrorNotice
          error={summary.error}
          onRetry={() => void summary.refetch()}
          fallback="Could not load this target's link profile."
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {data?.firstSeen
            ? `Link profile as DataForSEO last crawled it. First link seen ${formatSeen(
                data.firstSeen,
              )}.`
            : "Link profile as DataForSEO last crawled it."}
        </p>
        <ResultMetaChip meta={data} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Domain Score"
          className="sm:col-span-2 xl:col-span-1"
          loading={loading}
          value={
            <span className="flex items-baseline gap-2">
              <span
                className={cn(
                  "text-4xl leading-none font-semibold",
                  scoreTextClass(band),
                )}
              >
                {formatScore(data?.domainScore)}
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                / 100
              </span>
            </span>
          }
          delta={pointsDelta(
            currentPoint?.domainScore,
            previousPoint?.domainScore,
          )}
          badge={
            <Badge
              variant={variantForScore(data?.domainScore)}
              title="OpenRefs' 0–100 authority estimate for this target, derived from its link profile."
            >
              {bandLabel(band)}
            </Badge>
          }
        />
        <MetricCard
          label="Backlinks"
          value={formatCount(data?.backlinks)}
          loading={loading}
          delta={monthDelta(currentPoint?.backlinks, previousPoint?.backlinks)}
        />
        <MetricCard
          label="Referring domains"
          value={formatCount(data?.referringDomains)}
          loading={loading}
          delta={monthDelta(
            currentPoint?.referringDomains,
            previousPoint?.referringDomains,
          )}
          badge={
            data?.referringMainDomains === null ||
            data?.referringMainDomains === undefined ? null : (
              <Badge
                variant="neutral"
                title="Domains counted once regardless of how many subdomains link to you."
              >
                {`${formatCount(data.referringMainDomains)} main`}
              </Badge>
            )
          }
        />
        <MetricCard
          label="Dofollow links"
          value={formatDofollow(data?.dofollow)}
          loading={loading}
          badge={
            <Badge
              variant="neutral"
              // The Backlinks API publishes nofollow counts and totals but no
              // dofollow count, so this share is arithmetic on our side. Saying
              // so is why an em dash here reads as "not computable" rather than
              // as a broken card.
              title="Derived: referring pages minus the nofollow ones. DataForSEO does not publish a dofollow count."
            >
              derived
            </Badge>
          }
        />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              Link growth
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Monthly backlinks and referring domains. Months DataForSEO has no
              record of appear as breaks in the line.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ResultMetaChip meta={history.data} />
            <RangePicker value={range} onChange={onRangeChange} />
          </div>
        </div>

        {history.error ? (
          <ApiErrorNotice
            error={history.error}
            onRetry={() => void history.refetch()}
            fallback="Could not load the link history."
          />
        ) : history.isPending ? (
          <Skeleton className="h-[280px] w-full" />
        ) : chartData.length === 0 ? (
          <EmptyState
            title="No history available"
            description={
              items.length === 0
                ? "DataForSEO has no monthly link history for this target."
                : "No months fall in this range. Try a longer one."
            }
          />
        ) : (
          <TrendLineChart
            data={chartData}
            xKey="period"
            series={[
              { dataKey: "backlinks", name: "Backlinks" },
              { dataKey: "referringDomains", name: "Referring domains" },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
