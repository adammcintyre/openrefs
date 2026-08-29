import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
} from "./chart-parts";
import type { ValueFormatter } from "./chart-parts";
import { useReducedMotion } from "./use-reduced-motion";

export interface SimpleBarChartProps<TDatum extends Record<string, unknown>> {
  data: ReadonlyArray<TDatum>;
  /** Key holding the category label for the x axis. */
  xKey: string;
  /** Key holding the bar value. */
  dataKey: string;
  /** Tooltip label for the series. */
  name: string;
  height?: number;
  /** Index into the shared categorical palette. */
  colorIndex?: number;
  valueFormatter?: ValueFormatter;
  className?: string;
}

/**
 * Single-series bar chart for categorical comparisons — top pages, anchor
 * distribution, issues by type.
 *
 * One series only, deliberately: grouped and stacked bars need a legend, a
 * colour-blind-safe ordering and a different label strategy, and warrant their
 * own component rather than a pile of optional props on this one.
 */
export function SimpleBarChart<TDatum extends Record<string, unknown>>({
  data,
  xKey,
  dataKey,
  name,
  height = 240,
  colorIndex = 0,
  valueFormatter = formatFull,
  className = "",
}: SimpleBarChartProps<TDatum>) {
  const reducedMotion = useReducedMotion();
  const animate = !reducedMotion;

  const tooltipContent = useMemo(
    () => makeTooltipContent(valueFormatter),
    [valueFormatter],
  );

  return (
    <div className={className} style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
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
            // A translucent wash rather than a line: on bars a cursor line
            // reads as an extra gridline.
            cursor={{ fill: GRID_STROKE, fillOpacity: 0.35 }}
            isAnimationActive={animate}
          />
          <Bar
            dataKey={dataKey}
            name={name}
            fill={seriesColor(colorIndex)}
            radius={[4, 4, 0, 0]}
            isAnimationActive={animate}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
