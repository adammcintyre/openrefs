/**
 * Competitors — other domains ranking for the same keywords.
 *
 * **The one place in this module where two sites' numbers share a table.**
 * DataForSEO returns two identically-shaped metric blocks per competitor:
 * `organic` is the competitor's own totals, and `sharedOrganic` is the
 * *searched* domain's performance on the keywords the two have in common.
 * Swapping them silently shows the wrong site's traffic, which is why both
 * columns are labelled with whose data they are, carry a tooltip naming the
 * domain outright, and are explained above the table.
 */
import { Users } from "lucide-react";
import { useMemo } from "react";

import type { CompetitorRow } from "../../../shared/domains";
import {
  EM_DASH,
  aggregateMeta,
  formatCount,
  formatTraffic,
} from "../../components/domains/format";
import { LinkButton } from "../../components/keywords/link-button";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  createDataTableColumns,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import {
  competitorCsvHeaders,
  competitorCsvRows,
  csvFilename,
} from "./csv-rows";
import { PAGE_SIZE, useDomainCompetitors } from "./queries";
import { LoadMoreBar, TabShell } from "./tab-shell";
import type { DomainSearch } from "./url-state";

const col = createDataTableColumns<CompetitorRow>();

/** A header that can explain itself on hover without losing the sort button. */
function HeaderWithHint({ label, hint }: { label: string; hint: string }) {
  return <span title={hint}>{label}</span>;
}

export function CompetitorsTab({
  workspaceId,
  search,
  onAnalyze,
}: {
  workspaceId: string | null;
  search: DomainSearch;
  /** Swaps the searched domain to the competitor. */
  onAnalyze: (domain: string) => void;
}) {
  const query = useDomainCompetitors(workspaceId, search, true);

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const meta = useMemo(
    () => aggregateMeta(query.data?.pages ?? []),
    [query.data],
  );
  const total = query.data?.pages[0]?.totalCount ?? null;

  const columns = useMemo(
    () => [
      col.accessor((row) => row.domain, {
        id: "domain",
        header: "Competitor",
        sortFn: "text",
        cell: (info) => {
          const domain = info.getValue();
          return (
            <span className="flex items-center gap-2">
              <span className="font-medium text-foreground">
                {domain ?? EM_DASH}
              </span>
              {/*
                DataForSEO returns the searched domain as a row of its own —
                the baseline every other row is measured against. Saying so
                beats leaving a row that looks like it competes with itself.
              */}
              {domain === search.target ? (
                <Badge variant="brand">This domain</Badge>
              ) : null}
            </span>
          );
        },
      }),
      col.accessor((row) => row.commonKeywords, {
        id: "commonKeywords",
        header: () => (
          <HeaderWithHint
            label="Common keywords"
            hint={`Keywords both ${search.target} and this competitor rank for.`}
          />
        ),
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatCount(info.getValue())}</span>
        ),
      }),
      col.accessor((row) => row.organic.keywordCount, {
        id: "theirKeywords",
        header: () => (
          <HeaderWithHint
            label="Their keywords"
            hint="Every organic keyword the competitor ranks for, not just the shared ones."
          />
        ),
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatCount(info.getValue())}</span>
        ),
      }),
      col.accessor((row) => row.organic.traffic, {
        id: "theirTraffic",
        header: () => (
          <HeaderWithHint
            label="Their traffic (est.)"
            hint="The competitor's own estimated monthly organic visits, across their whole site."
          />
        ),
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatTraffic(info.getValue())}</span>
        ),
      }),
      col.accessor((row) => row.sharedOrganic.traffic, {
        id: "sharedTraffic",
        header: () => (
          <HeaderWithHint
            label="Your shared traffic (est.)"
            hint={`${search.target}'s estimated monthly visits from the keywords it shares with this competitor.`}
          />
        ),
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatTraffic(info.getValue())}</span>
        ),
      }),
      col.display({
        id: "analyze",
        header: "Actions",
        enableSorting: false,
        cell: (info) => {
          const { domain } = info.row.original;
          // No dead buttons on the row for the domain already on screen.
          if (domain === null || domain === "" || domain === search.target) {
            return null;
          }
          const gapHref =
            `/app/gap-analysis?target=${encodeURIComponent(search.target)}` +
            `&competitors=${encodeURIComponent(domain)}` +
            `&location=${search.location}&language=${encodeURIComponent(search.language)}`;
          return (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => onAnalyze(domain)}>
                Analyze
              </Button>
              <LinkButton to={gapHref} size="sm" variant="ghost">
                Gap
              </LinkButton>
            </div>
          );
        },
      }),
    ],
    [search.target, onAnalyze],
  );

  return (
    <TabShell
      heading="Competitors"
      description={
        <>
          Domains competing for the same keywords.{" "}
          <strong className="font-medium text-foreground">
            Their traffic
          </strong>{" "}
          is the competitor's own estimated organic visits;{" "}
          <strong className="font-medium text-foreground">
            Your shared traffic
          </strong>{" "}
          is what {search.target} earns from the keywords the two have in
          common — two different sites' numbers, side by side.
        </>
      }
      meta={meta}
      error={query.error}
      onRetry={() => void query.refetch()}
      onExport={() =>
        downloadCsv(
          csvFilename("competitors", search),
          competitorCsvHeaders(search.target),
          competitorCsvRows(rows),
        )
      }
      exportDisabled={rows.length === 0}
      footer={
        <LoadMoreBar
          loaded={rows.length}
          total={total}
          hasMore={query.hasNextPage}
          isFetching={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          pageSize={PAGE_SIZE}
        />
      }
    >
      <DataTable
        caption={`Competitors for ${search.target}`}
        columns={columns}
        data={rows}
        loading={query.isPending}
        emptyState={
          <EmptyState
            icon={Users}
            title="No competitors found"
            description="DataForSEO found no domains overlapping with this one in this market."
          />
        }
      />
    </TabShell>
  );
}
