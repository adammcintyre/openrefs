/**
 * A single-series inline sparkline, sized for a table cell.
 *
 * Hand-written SVG rather than Recharts, for three reasons: one of these
 * renders per table row and Recharts mounts a ResponsiveContainer and a
 * ResizeObserver per chart; the lazy Recharts chunk would be pulled in by a
 * cell rather than by a screen; and none of Recharts' axes, grids, legends or
 * tooltips are wanted here anyway. The geometry lives in `sparkline-points.ts`
 * and is unit-tested there.
 *
 * **Motion:** there is none. The path is drawn once at its final coordinates,
 * so there is nothing for `prefers-reduced-motion` to switch off — which is a
 * stronger guarantee than animating and then opting out, and the reason this
 * component does not use `useReducedMotion`.
 *
 * **Colour:** stroke comes from `var(--chart-*)` tokens, so it repaints with
 * the theme without a re-render. Colour is never the only channel — the shape
 * carries the information and the accessible label states it in words.
 */
import { useId } from "react";

import { cn } from "../ui/cn";
import {
  sparklineGeometry,
  toPolylinePoints,
  type SparklineDatum,
} from "./sparkline-points";

/** Roughly a table cell: wide enough for a month, short enough for a row. */
export const SPARKLINE_WIDTH = 120;
export const SPARKLINE_HEIGHT = 28;

export interface SparklineProps {
  series: ReadonlyArray<SparklineDatum>;
  width?: number;
  height?: number;
  /** Any `--chart-*` token, or another CSS colour. */
  stroke?: string;
  /**
   * Sentence describing the trend, for screen readers. Without one the chart
   * is decorative and hidden, which is correct only when the same numbers are
   * already in adjacent cells.
   */
  label?: string;
  className?: string;
}

export function Sparkline({
  series,
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
  stroke = "var(--chart-1)",
  label,
  className = "",
}: SparklineProps) {
  const titleId = useId();
  const { segments, last } = sparklineGeometry(series, { width, height });

  // Nothing has ever ranked: a flat rule reads as "no line yet" without
  // collapsing the row height as the table fills in.
  if (segments.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("overflow-visible", className)}
        role={label ? "img" : "presentation"}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        focusable="false"
      >
        <line
          x1={2}
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="var(--chart-grid)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role="img"
      aria-labelledby={label ? titleId : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {label ? <title id={titleId}>{label}</title> : null}

      {segments.map((segment) =>
        segment.length === 1 ? (
          // A lone measurement between two unranked days has no line to be
          // part of, so it is drawn as the dot it is.
          <circle
            key={`dot-${segment[0]?.date ?? ""}`}
            cx={segment[0]?.x}
            cy={segment[0]?.y}
            r={1.75}
            fill={stroke}
          />
        ) : (
          <polyline
            key={`seg-${segment[0]?.date ?? ""}`}
            points={toPolylinePoints(segment)}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}

      {/* End cap: which end is "now" is otherwise guesswork on a short line. */}
      {last ? <circle cx={last.x} cy={last.y} r={2} fill={stroke} /> : null}
    </svg>
  );
}
