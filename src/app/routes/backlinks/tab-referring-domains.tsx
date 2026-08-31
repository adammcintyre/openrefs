/**
 * Referring domains — who links to this target, and how much weight they carry.
 *
 * One thing on this tab always looks like a bug and is not: **the row count can
 * exceed the total.** DataForSEO's `total_count` here counts *main* domains
 * while the rows it returns are domains *including* subdomains, so a target
 * linked from forty subdomains of one site loads forty rows against a total that
 * counts them once. The shared types call this out, the load-more bar says "of
 * about N" and explains itself on hover, and paging is driven by whether the
 * last page came back full — never by the gap between the two numbers.
 */
import { Globe } from "lucide-react";
import { useMemo } from "react";

import type { ReferringDomainRow } from "../../../shared/backlinks";
import { ScoreBadge, SpamBadge } from "../../components/backlinks/badges";
import {
  dofollowTitle,
  formatDofollow,
  formatSeen,
} from "../../components/backlinks/format";
import {
  EM_DASH,
  aggregateMeta,
  formatCount,
} from "../../components/domains/format";
import {
  Button,
  DataTable,
  EmptyState,
  createDataTableColumns,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { REFERRING_CSV_HEADERS, csvFilename, referringCsvRows } from "./csv-rows";
import { PAGE_SIZE, useReferringDomains } from "./queries";
import { LoadMoreBar, TabShell } from "./tab-shell";

const col = createDataTableColumns<ReferringDomainRow>();

const TOTAL_NOTE =
  "DataForSEO counts main domains in this total but returns one row per domain including subdomains, so the two legitimately differ.";

export function ReferringDomainsTab({
  workspaceId,
  target,
  onAnalyze,
}: {
  workspaceId: string | null;
  target: string;
  /** Swaps the searched target to a referring domain. */
  onAnalyze: (domain: string) => void;
}) {
  const query = useReferringDomains(workspaceId, target, true);

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
        header: "Referring domain",
        sortFn: "text",
        cell: (info) => {
          const domain = info.getValue();
          if (domain === null || domain === "") {
            return <span className="text-muted-foreground">{EM_DASH}</span>;
          }
          return (
            <a
              href={`https://${domain}`}
              target="_blank"
              rel="noreferrer nofollow"
              title={domain}
              className="block max-w-[20rem] truncate font-medium text-primary hover:underline"
            >
              {domain}
            </a>
          );
        },
      }),
      col.accessor((row) => row.domainScore, {
        id: "domainScore",
        header: "Domain Score",
        sortFn: "alphanumeric",
        cell: (info) => (
          <ScoreBadge score={info.getValue()} label="Domain Score" />
        ),
      }),
      col.accessor((row) => row.backlinks, {
        id: "backlinks",
        header: "Backlinks",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatCount(info.getValue())}</span>
        ),
      }),
      /*
       * The provider's spam estimate for the linking domain, beside our own
       * authority score rather than instead of it: a high Domain Score with a
       * high spam score is exactly the row worth spotting, and either number
       * alone hides it.
       */
      col.accessor((row) => row.spamScore, {
        id: "spamScore",
        header: "Spam",
        sortFn: "alphanumeric",
        cell: (info) => <SpamBadge score={info.getValue()} />,
      }),
      col.accessor((row) => row.dofollow.dofollowRatio, {
        id: "dofollow",
        header: "Dofollow",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span
            className="tabular-nums"
            title={dofollowTitle(info.row.original.dofollow)}
          >
            {formatDofollow(info.row.original.dofollow)}
          </span>
        ),
      }),
      col.accessor((row) => row.firstSeen, {
        id: "firstSeen",
        header: "First seen",
        sortFn: "text",
        cell: (info) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatSeen(info.getValue())}
          </span>
        ),
      }),
      col.display({
        id: "analyze",
        header: "",
        enableSorting: false,
        cell: (info) => {
          const { domain } = info.row.original;
          if (domain === null || domain === "") return null;
          return (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAnalyze(domain)}
              title={`Analyze ${domain}'s own link profile.`}
            >
              Analyze
            </Button>
          );
        },
      }),
    ],
    [onAnalyze],
  );

  return (
    <TabShell
      heading="Referring domains"
      description="Every site linking to this target, strongest first. Subdomains are listed separately."
      meta={meta}
      error={query.error}
      onRetry={() => void query.refetch()}
      onExport={() =>
        downloadCsv(
          csvFilename("referring-domains", target),
          REFERRING_CSV_HEADERS,
          referringCsvRows(rows),
        )
      }
      exportDisabled={rows.length === 0}
      footer={
        <LoadMoreBar
          loaded={rows.length}
          total={total}
          totalIsApproximate
          totalNote={TOTAL_NOTE}
          hasMore={query.hasNextPage}
          isFetching={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          pageSize={PAGE_SIZE}
        />
      }
    >
      <DataTable
        caption={`Domains linking to ${target}`}
        columns={columns}
        data={rows}
        loading={query.isPending}
        emptyState={
          <EmptyState
            icon={Globe}
            title="No referring domains found"
            description="DataForSEO has no sites on record linking to this target."
          />
        }
      />
    </TabShell>
  );
}
