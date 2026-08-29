import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";

/**
 * Shared chart chrome.
 *
 * Colours are passed as `var(--token)` strings rather than resolved values:
 * SVG presentation attributes accept custom properties, so a chart repaints
 * correctly the instant the `.dark` class flips, with no re-render and no
 * getComputedStyle read.
 */

/** Categorical series colours, in order. Each clears 3:1 on both surfaces. */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * Per-series stroke patterns, in the same order.
 *
 * Series 1 and 2 are both greens (the brand pair) and sit at roughly 1.8:1
 * against each other, which is not enough to tell apart by hue — and would be
 * invisible to a viewer with deuteranopia regardless. The dash pattern is the
 * second channel, so a line chart never depends on colour alone.
 */
export const SERIES_DASH: ReadonlyArray<string | undefined> = [
  undefined,
  "6 3",
  "2 3",
  "9 3 2 3",
  "4 2",
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

export function seriesDash(index: number): string | undefined {
  return SERIES_DASH[index % SERIES_DASH.length];
}

export const AXIS_TICK = {
  fill: "var(--chart-axis)",
  fontSize: 12,
} as const;

export const GRID_STROKE = "var(--chart-grid)";

/** Left margin stays small because YAxis width="auto" sizes to its labels. */
export const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 } as const;

export type ValueFormatter = (value: number) => string;

export const formatCompact: ValueFormatter = (value) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
    .format(value);

export const formatFull: ValueFormatter = (value) => value.toLocaleString("en");

/**
 * Builds the custom tooltip renderer.
 *
 * Declared as a plain function returning ReactNode rather than a React.FC:
 * Recharts' `content` prop is typed `(props) => ReactNode`, while React 19's
 * FunctionComponent returns `ReactNode | Promise<ReactNode>` and so is not
 * assignable to it.
 *
 * `active` and `payload` are non-optional in Recharts 3 (payload defaults to
 * an empty array), so neither needs optional chaining.
 */
export function makeTooltipContent(format: ValueFormatter) {
  return function TooltipContent({
    active,
    label,
    payload,
  }: TooltipContentProps): ReactNode {
    if (!active || payload.length === 0) return null;

    return (
      <div className="rounded-app border border-border bg-surface px-3 py-2 shadow-lg">
        {label === undefined ? null : (
          <p className="mb-1.5 text-xs font-medium text-foreground">
            {String(label)}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {payload.map((entry) => (
            <li
              key={entry.graphicalItemId}
              className="flex items-center gap-2 text-xs"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{
                  background: entry.color ?? entry.stroke ?? entry.fill,
                }}
              />
              <span className="text-muted-foreground">
                {String(entry.name ?? entry.dataKey ?? "")}
              </span>
              <span className="ml-auto font-medium tabular-nums text-foreground">
                {typeof entry.value === "number"
                  ? format(entry.value)
                  : String(entry.value ?? "—")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  };
}
