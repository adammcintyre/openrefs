/**
 * The Queries and Pages tables.
 *
 * Two tables, one shape: Search Console reports the same four metrics for every
 * slice, so only the first column differs. Both column arrays live at module
 * scope because TanStack wants stable `columns` and `data` identities, and
 * rebuilding them per render would reset sort and pagination on every parent
 * update.
 *
 * Sorting defaults to clicks, descending — the order the API already returns —
 * so the first thing on screen is the same list whether or not anyone touches
 * a header.
 */
import { ExternalLink } from "lucide-react";

import type { GscPageRow, GscQueryRow } from "../../../shared/gsc";
import { DataTable, createDataTableColumns } from "../ui";
import type { DataTableColumn } from "../ui";
import { formatGscCount, formatGscCtr, formatGscPosition } from "./format";

/* ---------------------------------- cells ---------------------------------- */

function Metric({ children }: { children: React.ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}

/**
 * A page URL as its path, linked to the full address.
 *
 * The host is the same on every row of a single property's report, so showing
 * it forty times would push the part that differs off the right edge. The full
 * URL stays on the link's title and href.
 */
function PageCell({ page }: { page: string }) {
  let label = page;
  let href: string | null = null;

  try {
    const url = new URL(page);
    // Only http(s) becomes an href: these strings come from an external API
    // and a `javascript:` value here would be script execution on our origin.
    if (url.protocol === "http:" || url.protocol === "https:") {
      href = url.href;
      label = `${url.pathname}${url.search}` || "/";
    }
  } catch {
    /* Not a URL we can parse — render it as the plain text it is. */
  }

  if (href === null) {
    return <span className="break-all">{label}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={page}
      className="inline-flex items-start gap-1 break-all text-primary underline-offset-2 hover:underline"
    >
      {label}
      <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

/* -------------------------------- queries ---------------------------------- */

const queryCol = createDataTableColumns<GscQueryRow>();

const QUERY_COLUMNS: Array<DataTableColumn<GscQueryRow>> = [
  queryCol.accessor("query", {
    header: "Query",
    cell: (info) => (
      <span className="font-medium break-words">{info.getValue<string>()}</span>
    ),
  }),
  queryCol.accessor("clicks", {
    header: "Clicks",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
  queryCol.accessor("impressions", {
    header: "Impressions",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
  queryCol.accessor("ctr", {
    header: "CTR",
    cell: (info) => <Metric>{formatGscCtr(info.getValue<number>())}</Metric>,
  }),
  queryCol.accessor("position", {
    header: "Position",
    cell: (info) => <Metric>{formatGscPosition(info.getValue<number>())}</Metric>,
  }),
];

export function GscQueriesTable({
  rows,
  loading,
  property,
}: {
  rows: ReadonlyArray<GscQueryRow>;
  loading: boolean;
  property: string;
}) {
  return (
    <DataTable
      columns={QUERY_COLUMNS}
      data={rows}
      loading={loading}
      caption={`Search queries for ${property}`}
      maxHeight="36rem"
    />
  );
}

/* --------------------------------- pages ----------------------------------- */

const pageCol = createDataTableColumns<GscPageRow>();

const PAGE_COLUMNS: Array<DataTableColumn<GscPageRow>> = [
  pageCol.accessor("page", {
    header: "Page",
    cell: (info) => <PageCell page={info.getValue<string>()} />,
  }),
  pageCol.accessor("clicks", {
    header: "Clicks",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
  pageCol.accessor("impressions", {
    header: "Impressions",
    cell: (info) => <Metric>{formatGscCount(info.getValue<number>())}</Metric>,
  }),
  pageCol.accessor("ctr", {
    header: "CTR",
    cell: (info) => <Metric>{formatGscCtr(info.getValue<number>())}</Metric>,
  }),
  pageCol.accessor("position", {
    header: "Position",
    cell: (info) => <Metric>{formatGscPosition(info.getValue<number>())}</Metric>,
  }),
];

export function GscPagesTable({
  rows,
  loading,
  property,
}: {
  rows: ReadonlyArray<GscPageRow>;
  loading: boolean;
  property: string;
}) {
  return (
    <DataTable
      columns={PAGE_COLUMNS}
      data={rows}
      loading={loading}
      caption={`Landing pages for ${property}`}
      maxHeight="36rem"
    />
  );
}

export { PageCell };
