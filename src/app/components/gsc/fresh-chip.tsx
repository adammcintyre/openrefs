/**
 * "Data to 27 Aug 2026" — this module's chip.
 *
 * It sits in the slot every other module fills with a cost chip, and that
 * substitution is the point. Search Console data comes from Google on the
 * user's own grant, so nothing in this module spends a cent: a cost chip here
 * would be an outright lie, and a "$0.00" chip would be a confusing one. The
 * question this data actually raises is not "what did that cost" but "how
 * current is it", because Search Console finalises a day's metrics about two
 * days late and a window ending today would be quietly short.
 */
import { CalendarCheck, DatabaseZap } from "lucide-react";

import type { GscDateRange } from "../../../shared/gsc";
import { Badge } from "../ui";
import { formatGscDate } from "./format";

/**
 * @param range  Any report response — they all extend `GscDateRange`.
 * @param cached Whether this came from the 24h KV cache. Shown because a cached
 *               report is not a *staler* report (the window is fixed either
 *               way) but it does explain why a reload was instant.
 */
export function FreshnessChip({
  range,
  cached,
  className = "",
}: {
  range: Pick<GscDateRange, "from" | "to" | "freshTo"> | undefined;
  cached?: boolean;
  className?: string;
}) {
  if (range === undefined) return null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <Badge
        variant="neutral"
        title={`Search Console has finalised data up to ${formatGscDate(range.freshTo)}. Google publishes a day's figures around two days late, so this window stops there rather than pretending to know about today.`}
      >
        <CalendarCheck className="size-3" aria-hidden="true" />
        {`Data to ${formatGscDate(range.to)}`}
      </Badge>
      {cached === true ? (
        <Badge variant="neutral" title="Served from this workspace's cached copy of Google's answer, which is kept for 24 hours.">
          <DatabaseZap className="size-3" aria-hidden="true" />
          Cached
        </Badge>
      ) : null}
    </span>
  );
}

/** "1 Aug 2026 – 27 Aug 2026", for a report header. */
export function RangeCaption({
  range,
}: {
  range: Pick<GscDateRange, "from" | "to"> | undefined;
}) {
  if (range === undefined) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {`${formatGscDate(range.from)} – ${formatGscDate(range.to)}`}
    </span>
  );
}
