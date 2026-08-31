/**
 * The three numbers above the table, plus the provenance chips.
 *
 * Every label here commits to a scope, because each number has a different one
 * and conflating them is the easy misread:
 *
 *  - **Pages** counts the whole matching set on the server, which is what the
 *    filters act on and what paging works through.
 *  - **Median Domain Score** and **estimated traffic** are computed over the
 *    rows actually loaded in the browser, because those are the only rows the
 *    client has. Saying "in these results" rather than "for this topic" is the
 *    difference between a true statement and a confident wrong one.
 */
import type {
  ContentDiscoverCosts,
  ContentPageRow,
} from "../../../shared/content";
import { BuildCostChip, CachedChip, StaleChip } from "../../components/content/chips";
import { summarizeContentRows } from "../../components/content/summary";
import { formatCount, formatTraffic } from "../../components/domains/format";
import { DomainScoreCell } from "../../components/gap/score-cell";
import { MetricCard } from "../../components/ui";

export function ContentSummaryStrip({
  rows,
  matchingCount,
  filteredOut,
  costs,
  cached,
  stale,
  loading,
}: {
  rows: ReadonlyArray<ContentPageRow>;
  /** Pages that survived the filters, server-side — the set paging works over. */
  matchingCount: number | null;
  /** Pages the filters removed. Drives the honest caption on the count. */
  filteredOut: number;
  costs: ContentDiscoverCosts | undefined;
  cached: boolean | undefined;
  stale: boolean | undefined;
  loading: boolean;
}) {
  const summary = summarizeContentRows(rows);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <BuildCostChip costs={costs} />
        <CachedChip cached={cached} />
        <StaleChip stale={stale} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Pages found"
          loading={loading}
          value={formatCount(matchingCount)}
          delta={
            filteredOut > 0
              ? {
                  value: -filteredOut,
                  label: formatCount(filteredOut),
                  caption: "hidden by your filters",
                }
              : undefined
          }
          polarity="neutral"
        />

        <MetricCard
          label="Median Domain Score"
          loading={loading}
          value={
            summary.medianDomainScore === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <DomainScoreCell score={summary.medianDomainScore} />
                {/*
                  The median is the headline, but it is only meaningful next to
                  how many rows carry a score at all — a median of 12 over two of
                  fifty pages is not a description of the SERP.
                */}
                <span className="text-sm font-normal text-muted-foreground">
                  {`across ${formatCount(summary.scoredPages)} of ${formatCount(summary.pages)} loaded`}
                </span>
              </span>
            )
          }
        />

        <MetricCard
          label="Est. monthly traffic"
          loading={loading}
          value={
            <span title="Summed over the loaded rows that carry an estimate. Pages DataForSEO could not estimate contribute nothing, so this is a floor.">
              {`at least ${formatTraffic(summary.totalTraffic)}`}
            </span>
          }
          delta={
            summary.unmeasuredPages > 0
              ? {
                  value: 0,
                  label: formatCount(summary.unmeasuredPages),
                  caption: "loaded pages have no estimate",
                }
              : undefined
          }
          polarity="neutral"
        />
      </div>
    </div>
  );
}
