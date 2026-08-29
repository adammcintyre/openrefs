/**
 * Movers: the biggest gains and the biggest drops over seven days.
 *
 * The table can be sorted by Δ7d to get the same rows, so this panel earns its
 * space by being the thing you read *first* — it answers "what changed this
 * week" without the reader having to know which column to sort, or that a
 * positive delta is a good one.
 *
 * Selection is in `movers.ts` and unit-tested there. This file only renders it.
 */
import { TrendingDown, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { TrackedKeywordRow } from "../../../shared/tracking";
import { Card, cn } from "../ui";
import { DeviceBadge } from "./device-select";
import { formatChange, formatPosition } from "./format";
import { hasMovers, selectMovers } from "./movers";

export function MoversPanel({
  rows,
  className = "",
}: {
  rows: ReadonlyArray<TrackedKeywordRow>;
  className?: string;
}) {
  const movers = selectMovers(rows);

  // Nothing moved, or nothing has a baseline to move from. Either way there is
  // no panel worth the vertical space — and an empty "Movers" heading would
  // read as a loading failure rather than as calm.
  if (!hasMovers(movers)) return null;

  return (
    <div className={cn("grid gap-4 lg:grid-cols-2", className)}>
      <MoverList
        title="Biggest gains"
        caption="Improved most over 7 days"
        icon={TrendingUp}
        tone="up"
        rows={movers.gainers}
      />
      <MoverList
        title="Biggest drops"
        caption="Fell furthest over 7 days"
        icon={TrendingDown}
        tone="down"
        rows={movers.losers}
      />
    </div>
  );
}

function MoverList({
  title,
  caption,
  icon: Icon,
  tone,
  rows,
}: {
  title: string;
  caption: string;
  icon: LucideIcon;
  tone: "up" | "down";
  rows: ReadonlyArray<TrackedKeywordRow>;
}) {
  const accent = tone === "up" ? "text-success" : "text-danger";

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4 shrink-0", accent)} aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {tone === "up"
            ? "Nothing improved this week."
            : "Nothing dropped this week."}
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {row.keyword}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <DeviceBadge device={row.device} />
                  {`now ${formatPosition(row.latest)}`}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-sm font-semibold tabular-nums",
                  accent,
                )}
              >
                {formatChange(row.change7d)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
