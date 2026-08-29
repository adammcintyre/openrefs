import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_TICK,
  CHART_MARGIN,
  GRID_STROKE,
  formatCompact,
  formatFull,
  makeTooltipContent,
  seriesColor,
  seriesDash,
} from "./chart-parts";
import type { ValueFormatter } from "./chart-parts";
import { useReducedMotion } from "./use-reduced-motion";

export interface TrendSeries {
  /** Key into each datum. */
  dataKey: string;
  /** Legend and tooltip label. */
  name: string;
}

export interface TrendLineChartProps<
  TDatum extends Record<string, unknown>,
> {
  data: ReadonlyArray<TDatum>;
  /** Key holding the category / date for the x axis. */
  xKey: string;
  /** One entry for a single-series chart, several for a multi-series one. */
  series: ReadonlyArray<TrendSeries>;
  /** Pixel height. ResponsiveContainer needs a resolvable parent height. */
  height?: number;
  /** Tooltip formatting; axis labels always use the compact form. */
  valueFormatter?: ValueFormatter;
  className?: string;
}

/**
 * Line chart for time series — search volume, positions, backlinks over time.
 *
 * Single and multi-series share one implementation; the legend only appears
 * once there is more than one line to name.
 */
export function TrendLineChart<TDatum extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 280,
  valueFormatter = formatFull,
  className = "",
}: TrendLineChartProps<TDatum>) {
  const reducedMotion = useReducedMotion();
  const animate = !reducedMotion;

  // Stable identity, so Recharts is not handed a new component type on every
  // render (which would remount the tooltip mid-hover).
  const tooltipContent = useMemo(
    () => makeTooltipContent(valueFormatter),
    [valueFormatter],
  );

  return (
    <div className={className} style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={CHART_MARGIN}>
          {/* Horizontal rules only: vertical lines add noise without helping
              read a value off the y axis. */}
          <CartesianGrid
            vertical={false}
            stroke={GRID_STROKE}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey={xKey}
            stroke={GRID_STROKE}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
          />
          <YAxis
            width="auto"
            stroke={GRID_STROKE}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value: number | string) =>
              typeof value === "number" ? formatCompact(value) : String(value)
            }
          />
          <Tooltip
            content={tooltipContent}
            cursor={{ stroke: GRID_STROKE, strokeWidth: 1 }}
            isAnimationActive={animate}
          />
          {series.length > 1 ? (
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, color: "var(--chart-axis)" }}
            />
          ) : null}
          {series.map((item, index) => (
            <Line
              key={item.dataKey}
              type="monotone"
              dataKey={item.dataKey}
              name={item.name}
              stroke={seriesColor(index)}
              strokeDasharray={seriesDash(index)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: seriesColor(index) }}
              isAnimationActive={animate}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
