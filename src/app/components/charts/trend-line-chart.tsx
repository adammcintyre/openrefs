import { Suspense, lazy } from "react";

import { Skeleton } from "../ui/skeleton";
import type { TrendLineChartProps, TrendSeries } from "./impl/trend-line-chart";

export type { TrendLineChartProps, TrendSeries };

/*
 * Recharts is heavy — it pulls in Redux Toolkit, immer and a d3 bundle, and on
 * its own accounts for most of the client chunk. Splitting it out keeps it off
 * the landing page and the auth screens, which never draw a chart.
 *
 * The lazy() boundary erases generics, so the exported wrapper below restates
 * the generic signature and casts inward. Callers see exactly the same type
 * they would have got from the eager component.
 */
const LazyTrendLineChart = lazy(() =>
  import("./impl/trend-line-chart").then((module) => ({
    default: module.TrendLineChart,
  })),
);

type AnyDatum = Record<string, unknown>;

export function TrendLineChart<TDatum extends AnyDatum>({
  height = 280,
  ...props
}: TrendLineChartProps<TDatum>) {
  return (
    <Suspense
      fallback={
        <Skeleton style={{ height, width: "100%" }} className="rounded-app" />
      }
    >
      <LazyTrendLineChart
        height={height}
        {...(props as Omit<TrendLineChartProps<AnyDatum>, "height">)}
      />
    </Suspense>
  );
}
