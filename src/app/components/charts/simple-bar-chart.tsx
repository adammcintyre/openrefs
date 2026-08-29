import { Suspense, lazy } from "react";

import { Skeleton } from "../ui/skeleton";
import type { SimpleBarChartProps } from "./impl/simple-bar-chart";

export type { SimpleBarChartProps };

/** Same lazy boundary as TrendLineChart; see that file for the reasoning. */
const LazySimpleBarChart = lazy(() =>
  import("./impl/simple-bar-chart").then((module) => ({
    default: module.SimpleBarChart,
  })),
);

type AnyDatum = Record<string, unknown>;

export function SimpleBarChart<TDatum extends AnyDatum>({
  height = 240,
  ...props
}: SimpleBarChartProps<TDatum>) {
  return (
    <Suspense
      fallback={
        <Skeleton style={{ height, width: "100%" }} className="rounded-app" />
      }
    >
      <LazySimpleBarChart
        height={height}
        {...(props as Omit<SimpleBarChartProps<AnyDatum>, "height">)}
      />
    </Suspense>
  );
}
