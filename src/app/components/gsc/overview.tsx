/**
 * The four headline numbers and the daily chart.
 *
 * **Average position uses down-is-good polarity.** It is the one metric here
 * that improves by falling, and the shared `MetricCard` would otherwise paint
 * "position 12 → 6" red. There is no comparison window in this response, so no
 * card carries a delta — a `MetricCard` with no `delta` prop simply omits the
 * arrow, which is the honest rendering of "we have one window, not two".
 *
 * **CTR is a fraction.** `formatGscCtr` is the only thing standing between
 * `0.0423` and a card that reads "0.04%".
 *
 * The chart's series are indexed rather than raw; `series.ts` explains why at
 * length, and the caption under the chart states what the two 100s were worth
 * in real clicks and impressions so the shape always has an anchor.
 */
import { useMemo } from "react";

import type { GscOverviewResponse } from "../../../shared/gsc";
import { TrendLineChart } from "../charts";
import { Card, EmptyState, MetricCard } from "../ui";
import {
  formatGscCount,
  formatGscCtr,
  formatGscDate,
  formatGscPosition,
} from "./format";
import { gscChartPoints, gscSeriesPeaks, hasPlottableGscSeries } from "./series";

export function GscOverviewMetrics({
  data,
  loading,
}: {
  data: GscOverviewResponse | undefined;
  loading: boolean;
}) {
  const totals = data?.totals;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Clicks"
        value={formatGscCount(totals?.clicks)}
        loading={loading}
      />
      <MetricCard
        label="Impressions"
        value={formatGscCount(totals?.impressions)}
        loading={loading}
      />
      <MetricCard
        label="Average CTR"
        value={formatGscCtr(totals?.ctr)}
        loading={loading}
      />
      <MetricCard
        label="Average position"
        value={formatGscPosition(totals?.position)}
        // The one metric here that gets better as it goes down.
        polarity="down-is-good"
        loading={loading}
      />
    </div>
  );
}

/** Series labels, kept beside the normalisation they describe. */
const SERIES = [
  { dataKey: "clicks", name: "Clicks" },
  { dataKey: "impressions", name: "Impressions" },
] as const;

/** Both lines are percentages of their own peak — so the tooltip says so. */
const formatIndexed = (value: number) => `${value.toFixed(1)}% of peak`;

export function GscDailyChart({
  data,
  loading,
}: {
  data: GscOverviewResponse | undefined;
  loading: boolean;
}) {
  const daily = useMemo(() => data?.daily ?? [], [data]);
  const points = useMemo(() => gscChartPoints(daily), [daily]);
  const peaks = useMemo(() => gscSeriesPeaks(daily), [daily]);

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">Daily performance</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {/*
            Said plainly and up front. A reader who assumes the axis is counts
            would read a crossing of the two lines as clicks overtaking
            impressions, which is impossible — better to explain the axis than
            to let anyone reach that conclusion.
          */}
          Each line is scaled against its own best day, so their shapes can be
          compared directly. Impressions outnumber clicks many times over, and
          on one shared axis the clicks line would be flat along the bottom.
        </p>
      </div>

      {loading ? (
        <div className="h-[280px] w-full animate-pulse rounded-app bg-surface-muted" />
      ) : hasPlottableGscSeries(daily) ? (
        <>
          <TrendLineChart
            data={points}
            xKey="date"
            series={[...SERIES]}
            valueFormatter={formatIndexed}
          />
          <p className="text-xs text-muted-foreground">
            {`Best day for clicks: ${formatGscCount(peaks.clicks.value)} on ${formatGscDate(peaks.clicks.date)}. `}
            {`Best day for impressions: ${formatGscCount(peaks.impressions.value)} on ${formatGscDate(peaks.impressions.date)}.`}
          </p>
        </>
      ) : (
        <EmptyState
          title="Not enough days to draw a trend"
          description="This window holds fewer than two days of finalised data. Search Console finalises a day about two days late, so a very new property or a very short range can land here."
        />
      )}
    </Card>
  );
}
