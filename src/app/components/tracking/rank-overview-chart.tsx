/**
 * The shape of a project's month, full width, at the top of Rank Tracking.
 *
 * Two views of the same free D1 rollup, because they answer different
 * questions and neither can be read off the other:
 *
 *  - **Rankings** counts how many tracked keywords sit in the top 3, 10 and
 *    100. The bands are cumulative — a keyword at position 2 is in all three —
 *    which is the honest reading of "≤ 3", "≤ 10", "≤ 100", and is why the
 *    lines nest rather than sum.
 *  - **Average position** is the mean of the keywords that ranked that day,
 *    **on an inverted axis**: 1 is the best result there is, so it belongs at
 *    the top. Drawn the ordinary way up, a project climbing from 30 to 3 would
 *    have a line that falls.
 *
 * **Plotted by date, never by index.** The contract in src/shared/tracking.ts
 * is explicit that days can be missing — a project first checked on a Tuesday
 * has no Monday row — so every point is labelled with its own date and nothing
 * here infers a day from a position in the array.
 *
 * Costs nothing to render: the summary endpoint reads `rank_snapshots` out of
 * D1 and never touches DataForSEO.
 */
import { useMemo, useState } from "react";

import type { RankSummaryPoint } from "../../../shared/tracking";
import { TrendLineChart } from "../charts";
import { Card, EmptyState, Skeleton, cn } from "../ui";
import { formatAxisDay } from "./format";
import type { RankSummaryRange } from "./queries";
import {
  DEFAULT_RANK_SUMMARY_RANGE,
  RANK_SUMMARY_RANGES,
  useRankSummary,
} from "./queries";

/** Which question the card is answering. */
type ChartView = "rankings" | "average";

const VIEW_LABELS: Record<ChartView, string> = {
  rankings: "Rankings",
  average: "Average position",
};

/**
 * Height of the plot, matched by the loading skeleton so the card does not
 * resize under the user when the data lands.
 */
const CHART_HEIGHT = 300;

/** One datum per snapshot day, in the shape Recharts reads. */
interface ChartDatum extends Record<string, unknown> {
  /** The point's own date, short form. The x axis, and never an index. */
  day: string;
  top3: number;
  top10: number;
  top100: number;
  /** Null on a day nothing ranked — a gap in the line, not a crash to zero. */
  avgPosition: number | null;
}

export function toChartData(
  points: ReadonlyArray<RankSummaryPoint>,
): ChartDatum[] {
  return points.map((point) => ({
    day: formatAxisDay(point.date),
    top3: point.top3,
    top10: point.top10,
    top100: point.top100,
    avgPosition: point.avgPosition,
  }));
}

export function RankOverviewChart({
  workspaceId,
  projectId,
}: {
  workspaceId: string | null;
  projectId: string;
}) {
  const [view, setView] = useState<ChartView>("rankings");
  const [days, setDays] = useState<RankSummaryRange>(
    DEFAULT_RANK_SUMMARY_RANGE,
  );

  const query = useRankSummary(workspaceId, projectId, days);
  const data = useMemo(
    () => toChartData(query.data?.points ?? []),
    [query.data],
  );

  /*
   * A failed read takes the card away rather than putting an error box above
   * the table. Every number here is also in the table below, so there is
   * nothing to recover and nothing to retry — the screen still works.
   */
  if (query.isError) return null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            Ranking overview
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === "rankings"
              ? "Tracked keywords in the top 3, 10 and 100 each day. The bands are cumulative."
              : "Mean position of the keywords that ranked each day. Best at the top."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Chart view"
            options={(["rankings", "average"] as const).map((value) => ({
              value,
              label: VIEW_LABELS[value],
            }))}
            value={view}
            onChange={setView}
          />
          <Segmented
            label="Date range"
            options={RANK_SUMMARY_RANGES.map((value) => ({
              value,
              label: `${value} days`,
            }))}
            value={days}
            onChange={setDays}
          />
        </div>
      </div>

      {query.isPending ? (
        <Skeleton
          className="w-full rounded-app"
          style={{ height: CHART_HEIGHT }}
        />
      ) : /*
           One point is not a trend, and drawing it as a flat line across an
           axis would imply days of history that do not exist yet.
         */
      data.length < 2 ? (
        <div style={{ minHeight: CHART_HEIGHT }} className="flex items-center">
          <EmptyState
            title="Not enough history yet"
            description="Snapshots build daily — check back tomorrow."
          />
        </div>
      ) : view === "rankings" ? (
        <TrendLineChart
          data={data}
          xKey="day"
          height={CHART_HEIGHT}
          /*
           * Darkest green first: `seriesColor` walks chart-1, chart-2, chart-3
           * in order, and chart-1 is the deepest of the Lush Forest greens. Top
           * 3 is the band people look for, so it gets the strongest line — and
           * the dash patterns from `seriesDash` mean the three never depend on
           * hue alone.
           */
          series={[
            { dataKey: "top3", name: "Top 3" },
            { dataKey: "top10", name: "Top 10" },
            { dataKey: "top100", name: "Top 100" },
          ]}
        />
      ) : (
        <TrendLineChart
          data={data}
          xKey="day"
          height={CHART_HEIGHT}
          yReversed
          // Position 1 is the ceiling; anything above it on the axis is empty
          // space that makes a good week look like a mediocre one.
          yDomain={[1, "auto"]}
          valueFormatter={(value) => value.toFixed(1)}
          series={[{ dataKey: "avgPosition", name: "Average position" }]}
        />
      )}
    </Card>
  );
}

/**
 * A radio group that looks like a segmented control.
 *
 * `role="radiogroup"` rather than a tablist: these switch what the one chart
 * below is showing, they do not switch between panels — and a screen reader
 * announcing "tab 1 of 2" would promise a panel change that never comes.
 */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-app border border-border bg-surface-muted p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-app px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
