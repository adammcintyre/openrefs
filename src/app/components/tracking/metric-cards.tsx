/**
 * The four headline numbers above the tracking table.
 *
 * Each one carries a badge saying what it counted, because every metric here
 * has a denominator that is easy to assume wrongly. "Average position 4.2"
 * across 50 keywords means something very different if 40 of them are unranked
 * and excluded — so the card says how many it averaged rather than leaving the
 * reader to assume it was all of them.
 */
import type { TrackedKeywordRow } from "../../../shared/tracking";
import { Badge, MetricCard, cn } from "../ui";
import {
  CHANGE_TONE_CLASS,
  averagePosition,
  changeTone,
  formatAveragePosition,
  formatChange,
  netChange7d,
  topTenCount,
} from "./format";

export function TrackingMetrics({
  rows,
  loading,
}: {
  rows: ReadonlyArray<TrackedKeywordRow>;
  loading: boolean;
}) {
  const total = rows.length;
  const average = averagePosition(rows);
  const ranked = rows.filter(
    (row) => row.latest !== null && row.latest.position !== null,
  ).length;
  const topTen = topTenCount(rows);
  const { net, comparable } = netChange7d(rows);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        label="Tracked keywords"
        value={total.toLocaleString("en")}
        loading={loading}
      />

      <MetricCard
        label="Average position"
        value={formatAveragePosition(average)}
        loading={loading}
        badge={
          <Badge variant="neutral" title="Keywords not in the top 100 are excluded rather than counted as 100.">
            {ranked === 0 ? "none ranked" : `${ranked} of ${total}`}
          </Badge>
        }
      />

      <MetricCard
        label="In the top 10"
        value={topTen.toLocaleString("en")}
        loading={loading}
        badge={
          total > 0 ? (
            <Badge variant={topTen > 0 ? "success" : "neutral"}>
              {`${Math.round((topTen / total) * 100)}%`}
            </Badge>
          ) : undefined
        }
      />

      <MetricCard
        label="Net movement (7d)"
        loading={loading}
        // Colour and sign on the value itself: this card's whole subject is a
        // direction, so the number carries it rather than a separate delta row.
        value={
          <span className={cn(CHANGE_TONE_CLASS[changeTone(net)])}>
            {comparable === 0 ? "—" : formatChange(net)}
          </span>
        }
        badge={
          <Badge
            variant="neutral"
            title="Keywords with no observation from seven days ago are unmeasured, not unmoved, so they are left out of the total."
          >
            {comparable === 0 ? "no baseline" : `${comparable} compared`}
          </Badge>
        }
      />
    </div>
  );
}
