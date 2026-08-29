/**
 * Mention rate over time, one line per engine.
 *
 * The y axis is "what percentage of the prompts run that day named your site",
 * which is the number this whole module exists to move. It is deliberately a
 * *rate* rather than a count: adding a prompt would otherwise look like a win
 * on a count chart, and removing one like a collapse.
 *
 * **A gap is not a zero.** Engines run independently and a day with no run has
 * `mentionRate: null`, which `mergeTimelines` leaves absent from that row.
 * Recharts then breaks the line rather than dropping it to the floor —
 * `connectNulls` is left off precisely so the break is visible, because a line
 * drawn straight through a fortnight nobody measured is a claim we cannot
 * support.
 *
 * The summary strip above the chart carries the window's overall rates, which
 * come from the API rather than being averaged out of the points here: an
 * unweighted mean of daily rates would over-weight a day that ran one prompt.
 */
import { LineChart } from "lucide-react";

import type { AiEngineTimeline } from "../../../shared/ai";
import { TrendLineChart } from "../charts";
import type { TrendSeries } from "../charts";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "../ui";
import { engineLabel, formatRate, mergeTimelines } from "./format";

export function MentionRateChart({
  timelines,
}: {
  timelines: ReadonlyArray<AiEngineTimeline>;
}) {
  const data = mergeTimelines(timelines);
  const series: TrendSeries[] = timelines.map((timeline) => ({
    dataKey: timeline.engine,
    name: engineLabel(timeline.engine),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mention rate</CardTitle>
        <p className="text-sm text-muted-foreground">
          The share of prompts run on a given day whose answer named your site.
          A break in a line is a day that engine did not run, not a day it
          scored zero.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {timelines.length === 0 || data.length === 0 ? (
          <EmptyState
            icon={LineChart}
            title="No runs in this window"
            description="Once prompts have run, their mention rate is plotted here by day and engine."
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {timelines.map((timeline) => (
                <div key={timeline.engine} className="flex flex-col">
                  <span className="text-xs text-muted-foreground">
                    {engineLabel(timeline.engine)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {/*
                      Over the whole window, from the API — not an average of
                      the daily points, which would weight a one-prompt day the
                      same as a fifty-prompt one.
                    */}
                    <span title="Mention rate across the whole window.">
                      {formatRate(timeline.mentionRate)}
                    </span>
                    <span className="font-normal text-muted-foreground">
                      {" mentioned · "}
                    </span>
                    <span title="Citation rate across the whole window.">
                      {formatRate(timeline.citationRate)}
                    </span>
                    <span className="font-normal text-muted-foreground">
                      {" cited"}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            <TrendLineChart
              data={data}
              xKey="date"
              series={series}
              height={280}
              valueFormatter={(value) => `${value}%`}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
