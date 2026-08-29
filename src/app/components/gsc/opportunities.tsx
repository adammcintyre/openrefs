/**
 * Opportunities — the reason this module exists.
 *
 * Queries and Pages report what happened. This tab says what to do about it,
 * and each of the three rules answers a different question:
 *
 *  - **Striking distance** — where is the ranking nearly good enough?
 *  - **Low CTR** — where is the ranking already good and the listing wasted?
 *  - **Cannibalization** — where is the site competing with itself?
 *
 * **Every threshold in the copy comes from the response.** See `explainers.ts`:
 * striking distance's impression floor is the median of *this* property's
 * queries, so it is a different number for every property and every window, and
 * a hardcoded sentence would be wrong the first time anyone read it.
 *
 * **A query may legitimately appear in more than one list.** That is a finding,
 * not double-counting — a search that is both short of page one and
 * under-clicked has two independent problems with two different fixes — so the
 * lists are not deduplicated against each other and a note says why.
 *
 * **"View SERP" is on striking-distance rows only.** It is the one list where
 * the question "who is ahead of me, and by how much?" is the next thing you
 * want to know, and the panel behind it is a billed DataForSEO call — putting
 * it on every row of every list would invite a lot of accidental spending in a
 * module that otherwise costs nothing.
 */
import { Download, Search, Sparkles } from "lucide-react";
import { createContext, useContext } from "react";

import type {
  GscCannibalizationOpportunity,
  GscLowCtrOpportunity,
  GscOpportunitiesResponse,
  GscOpportunityList,
  GscStrikingDistanceOpportunity,
} from "../../../shared/gsc";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  createDataTableColumns,
} from "../ui";
import type { DataTableColumn } from "../ui";
import {
  GSC_OVERLAP_NOTE,
  cannibalizationExplainer,
  lowCtrExplainer,
  strikingDistanceExplainer,
  truncationNote,
} from "./explainers";
import {
  formatGscCount,
  formatGscCtr,
  formatGscPosition,
  formatGscShare,
} from "./format";
import { PageCell } from "./report-tables";

/* ------------------------------- row context ------------------------------- */

/*
 * The SERP handler reaches the cells through context rather than a closure, so
 * the column arrays can stay at module scope and a re-render cannot churn the
 * table's sort and pagination state.
 */
const SerpContext = createContext<((query: string) => void) | null>(null);

function ViewSerpCell({ query }: { query: string }) {
  const onViewSerp = useContext(SerpContext);
  if (onViewSerp === null) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => onViewSerp(query)}
      aria-label={`View the search results for ${query}`}
    >
      <Search className="size-3.5" aria-hidden="true" />
      View SERP
    </Button>
  );
}

function Metric({ children }: { children: React.ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}

/** The winning page for a query, or an honest gap where Google gave none. */
function OpportunityPageCell({ page }: { page: string | null }) {
  if (page === null) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Search Console anonymises rare queries, so the query-and-page breakdown has no row for this one. The query's totals above are still real."
      >
        Not reported
      </span>
    );
  }
  return <PageCell page={page} />;
}

/* --------------------------- striking distance ----------------------------- */

const strikingCol = createDataTableColumns<GscStrikingDistanceOpportunity>();

const STRIKING_COLUMNS: Array<
  DataTableColumn<GscStrikingDistanceOpportunity>
> = [
  strikingCol.accessor("query", {
    header: "Query",
    cell: (info) => (
      <span className="font-medium break-words">{info.getValue<string>()}</span>
    ),
  }),
  strikingCol.accessor((row) => row.page ?? undefined, {
    id: "page",
    header: "Best page",
    cell: (info) => <OpportunityPageCell page={info.row.original.page} />,
  }),
  strikingCol.accessor("position", {
    header: "Position",
    cell: (info) => (
      <Metric>{formatGscPosition(info.getValue<number>())}</Metric>
    ),
  }),
  strikingCol.accessor("impressions", {
    header: "Impressions",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
  strikingCol.accessor("clicks", {
    header: "Clicks",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
  strikingCol.accessor("ctr", {
    header: "CTR",
    cell: (info) => <Metric>{formatGscCtr(info.getValue<number>())}</Metric>,
  }),
  strikingCol.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: (info) => <ViewSerpCell query={info.row.original.query} />,
  }),
];

/* -------------------------------- low CTR ---------------------------------- */

const lowCtrCol = createDataTableColumns<GscLowCtrOpportunity>();

const LOW_CTR_COLUMNS: Array<DataTableColumn<GscLowCtrOpportunity>> = [
  lowCtrCol.accessor("query", {
    header: "Query",
    cell: (info) => (
      <span className="font-medium break-words">{info.getValue<string>()}</span>
    ),
  }),
  lowCtrCol.accessor((row) => row.page ?? undefined, {
    id: "page",
    header: "Best page",
    cell: (info) => <OpportunityPageCell page={info.row.original.page} />,
  }),
  lowCtrCol.accessor("position", {
    header: "Position",
    cell: (info) => (
      <Metric>{formatGscPosition(info.getValue<number>())}</Metric>
    ),
  }),
  lowCtrCol.accessor("ctr", {
    header: "CTR",
    cell: (info) => <Metric>{formatGscCtr(info.getValue<number>())}</Metric>,
  }),
  lowCtrCol.accessor("expectedCtr", {
    header: "Expected",
    cell: (info) => (
      <span
        className="tabular-nums text-muted-foreground"
        title="What a result at this position typically earns, from a published click-through curve."
      >
        {formatGscCtr(info.getValue<number>())}
      </span>
    ),
  }),
  lowCtrCol.accessor("ctrRatio", {
    header: "Of expected",
    cell: (info) => (
      // The whole finding in one number: 22% means this listing earns roughly
      // a fifth of what its ranking should be worth.
      <Badge variant="warning">{formatGscShare(info.getValue<number>())}</Badge>
    ),
  }),
  lowCtrCol.accessor("impressions", {
    header: "Impressions",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
];

/* ----------------------------- cannibalization ----------------------------- */

const cannibalCol = createDataTableColumns<GscCannibalizationOpportunity>();

const CANNIBAL_COLUMNS: Array<
  DataTableColumn<GscCannibalizationOpportunity>
> = [
  cannibalCol.accessor("query", {
    header: "Query",
    cell: (info) => (
      <span className="font-medium break-words">{info.getValue<string>()}</span>
    ),
  }),
  cannibalCol.accessor((row) => row.pages.length, {
    id: "pageCount",
    header: "Pages",
    cell: (info) => <Metric>{info.getValue<number>()}</Metric>,
  }),
  cannibalCol.display({
    id: "competing",
    header: "Competing pages",
    cell: (info) => (
      <ul className="flex min-w-0 flex-col gap-1.5">
        {info.row.original.pages.map((page) => (
          <li key={page.page} className="flex flex-wrap items-baseline gap-2">
            <Badge variant="neutral">{formatGscShare(page.shareOfClicks)}</Badge>
            <span className="min-w-0 text-xs">
              <PageCell page={page.page} />
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {`${formatGscCount(page.clicks)} clicks · pos ${formatGscPosition(page.position)}`}
            </span>
          </li>
        ))}
      </ul>
    ),
  }),
  cannibalCol.accessor("clicks", {
    header: "Total clicks",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
  cannibalCol.accessor("impressions", {
    header: "Impressions",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
];

/* -------------------------------- section ---------------------------------- */

function Section<T>({
  title,
  explainer,
  list,
  loading,
  emptyTitle,
  emptyDescription,
  onExport,
  children,
}: {
  title: string;
  explainer: string;
  list: GscOpportunityList<T> | undefined;
  loading: boolean;
  emptyTitle: string;
  emptyDescription: string;
  onExport: () => void;
  children: React.ReactNode;
}) {
  const items = list?.items ?? [];
  const truncation = truncationNote(list);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            {title}
            {loading ? null : (
              <Badge variant="neutral">
                {formatGscCount(list?.total ?? 0)}
              </Badge>
            )}
          </h3>
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            {explainer}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onExport}
          disabled={items.length === 0}
        >
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {!loading && items.length === 0 ? (
        <Card className="p-0">
          <EmptyState title={emptyTitle} description={emptyDescription} />
        </Card>
      ) : (
        children
      )}

      {truncation === null ? null : (
        <p className="text-xs text-muted-foreground">{truncation}</p>
      )}
    </section>
  );
}

/* --------------------------------- the tab --------------------------------- */

export function GscOpportunities({
  data,
  loading,
  property,
  onViewSerp,
  onExport,
}: {
  data: GscOpportunitiesResponse | undefined;
  loading: boolean;
  property: string;
  onViewSerp: (query: string) => void;
  onExport: (rule: "striking" | "lowCtr" | "cannibalization") => void;
}) {
  const thresholds = data?.thresholds;

  return (
    <SerpContext.Provider value={onViewSerp}>
      <div className="flex flex-col gap-8">
        <p className="flex items-start gap-2 rounded-app border border-info-subtle bg-info-subtle p-3 text-xs leading-relaxed text-info-on-subtle">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{GSC_OVERLAP_NOTE}</span>
        </p>

        <Section
          title="Striking distance"
          explainer={
            thresholds === undefined
              ? "Queries ranking just off page one, with more demand behind them than half your other searches."
              : strikingDistanceExplainer(thresholds.strikingDistance)
          }
          list={data?.strikingDistance}
          loading={loading}
          emptyTitle="Nothing in striking distance"
          emptyDescription="No query in this window sits between positions 5 and 20 with above-median impressions. On a small or new property that usually means there is not enough data yet rather than nothing to fix — try a longer date range."
          onExport={() => onExport("striking")}
        >
          <DataTable
            columns={STRIKING_COLUMNS}
            data={data?.strikingDistance.items ?? []}
            loading={loading}
            caption={`Striking-distance queries for ${property}`}
            maxHeight="32rem"
          />
        </Section>

        <Section
          title="Low click-through rate"
          explainer={
            thresholds === undefined
              ? "Queries you already rank well for that are not being clicked."
              : lowCtrExplainer(thresholds.lowCtr)
          }
          list={data?.lowCtr}
          loading={loading}
          emptyTitle="No under-clicked rankings"
          emptyDescription="Every top-ten query in this window is earning at least half the clicks its position would normally attract. Titles and descriptions are doing their job."
          onExport={() => onExport("lowCtr")}
        >
          <DataTable
            columns={LOW_CTR_COLUMNS}
            data={data?.lowCtr.items ?? []}
            loading={loading}
            caption={`Under-clicked queries for ${property}`}
            maxHeight="32rem"
          />
        </Section>

        <Section
          title="Cannibalization"
          explainer={
            thresholds === undefined
              ? "Queries where more than one of your pages is taking a meaningful share of the clicks."
              : cannibalizationExplainer(thresholds.cannibalization)
          }
          list={data?.cannibalization}
          loading={loading}
          emptyTitle="No pages competing with each other"
          emptyDescription="For every query in this window, one page is taking the clicks. Nothing to consolidate."
          onExport={() => onExport("cannibalization")}
        >
          <DataTable
            columns={CANNIBAL_COLUMNS}
            data={data?.cannibalization.items ?? []}
            loading={loading}
            caption={`Cannibalized queries for ${property}`}
            maxHeight="32rem"
          />
        </Section>
      </div>
    </SerpContext.Provider>
  );
}
