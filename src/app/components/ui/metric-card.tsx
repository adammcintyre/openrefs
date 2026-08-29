import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "./card";
import { cn } from "./cn";
import { Skeleton } from "./skeleton";

/**
 * Which direction of movement counts as good.
 *
 * Not every metric improves by going up: average rank position, spend and
 * crawl errors all get better as they fall. Without this the card would paint
 * "position 8 -> 3" red.
 */
export type DeltaPolarity = "up-is-good" | "down-is-good" | "neutral";

export interface MetricDelta {
  /** Signed change. Sign drives the arrow; polarity drives the colour. */
  value: number;
  /** Rendered as-is next to the arrow, e.g. "12.4%" or "1.2k". */
  label: string;
  /** Context for the change, e.g. "vs. last 30 days". */
  caption?: string;
}

function deltaTone(value: number, polarity: DeltaPolarity): string {
  if (value === 0 || polarity === "neutral") return "text-muted-foreground";
  const good = polarity === "up-is-good" ? value > 0 : value < 0;
  return good ? "text-success" : "text-danger";
}

/**
 * A single headline number. The delta is encoded three ways — arrow direction,
 * the sign in the label, and colour — so it survives both colour-blindness and
 * a greyscale print.
 */
export function MetricCard({
  label,
  value,
  delta,
  polarity = "up-is-good",
  badge,
  loading = false,
  className = "",
}: {
  label: string;
  value: ReactNode;
  delta?: MetricDelta;
  polarity?: DeltaPolarity;
  /** Slot for provenance, e.g. a "Sample" badge. */
  badge?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  const Arrow =
    delta === undefined || delta.value === 0
      ? Minus
      : delta.value > 0
        ? TrendingUp
        : TrendingDown;

  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {badge}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </p>
      )}

      {delta && !loading ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1 font-medium tabular-nums",
              deltaTone(delta.value, polarity),
            )}
          >
            <Arrow className="size-3.5" aria-hidden="true" />
            {delta.label}
          </span>
          {delta.caption ? (
            <span className="text-muted-foreground">{delta.caption}</span>
          ) : null}
        </p>
      ) : null}
    </Card>
  );
}
