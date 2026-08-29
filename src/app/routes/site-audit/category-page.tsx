/**
 * One category's affected pages.
 *
 * This is the screen a user sends to whoever will fix the site, which sets two
 * requirements: it has to be a URL (hence a route, not a modal), and it has to
 * carry the *specific* failing values, not just a list of paths. "41 pages have
 * a title problem" is not actionable; "/pricing — title 112 characters, over
 * the 60-character limit" is.
 *
 * **Server pagination, not client.** The endpoint returns 50 at a time out of
 * R2 and a big crawl can have thousands, so the pager drives `?page=` and each
 * page is its own request. The shared DataTable's own pager is switched off by
 * giving it every loaded row at once.
 */
import { ArrowLeft, Download, FileSearch } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import type { AuditCategory, AuditIssuePage } from "../../../shared/audits";
import { AUDIT_CATEGORIES, AUDIT_ISSUES_PAGE_SIZE } from "../../../shared/audits";
import {
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  formatCount,
} from "../../components/audit/format";
import { useAudit, useAuditIssues } from "../../components/audit/queries";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import { urlPath } from "../../components/domains/format";
import { PROJECT_PARAM } from "../../components/projects/project-selection";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Skeleton,
  createDataTableColumns,
  formatPageRange,
  pageRange,
} from "../../components/ui";
import type { DataTableColumn } from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { useActiveWorkspace } from "../../lib/workspaces";
import { AUDIT_PARAM } from "./audit-page";
import {
  auditIssuesCsvFilename,
  auditIssuesCsvHeaders,
  auditIssuesCsvRows,
  detailKeys,
  humanizeDetailKey,
} from "./csv-rows";

const PAGE_PARAM = "page";

export function AuditCategoryPage() {
  const { auditId = "", category = "" } = useParams();
  const [searchParams] = useSearchParams();
  const { activeWorkspaceId, isPending: workspacePending } =
    useActiveWorkspace();

  /*
   * The category comes out of the URL, so it is validated against the taxonomy
   * before it is put in a request path — a typo should be a friendly "unknown
   * category" here, not a 400 from the API.
   */
  const validCategory = AUDIT_CATEGORIES.includes(category as AuditCategory)
    ? (category as AuditCategory)
    : null;

  const page = Math.max(1, Number(searchParams.get(PAGE_PARAM) ?? "1") || 1);
  const projectId = searchParams.get(PROJECT_PARAM);

  /*
   * The back link keeps both parameters so returning lands on the same audit
   * of the same project rather than on whatever is most recent.
   */
  const backParams = new URLSearchParams();
  if (projectId !== null) backParams.set(PROJECT_PARAM, projectId);
  if (auditId !== "") backParams.set(AUDIT_PARAM, auditId);
  const backTo = `/app/site-audit?${backParams.toString()}`;

  const auditQuery = useAudit(activeWorkspaceId, auditId === "" ? null : auditId);
  const issuesQuery = useAuditIssues(
    activeWorkspaceId,
    auditId === "" ? null : auditId,
    validCategory,
    page,
  );

  const issues = issuesQuery.data ?? null;
  const rows = useMemo(() => issues?.pages ?? [], [issues]);
  const domain = auditQuery.data?.domain ?? "";

  const columns = useMemo(() => buildColumns(rows), [rows]);

  function exportCsv() {
    downloadCsv(
      auditIssuesCsvFilename(domain || "site", validCategory ?? "issues"),
      auditIssuesCsvHeaders(rows),
      auditIssuesCsvRows(rows),
    );
  }

  if (workspacePending) return <PageSkeleton />;

  if (validCategory === null) {
    return (
      <div className="flex flex-col">
        <BackLink to={backTo} />
        <PageHeader title="Unknown category" />
        <EmptyState
          icon={FileSearch}
          title="No such issue category"
          description={`"${category}" is not one of the categories an audit reports.`}
          action={
            <Link
              to={backTo}
              className="text-sm font-medium text-primary underline underline-offset-4"
            >
              Back to the audit
            </Link>
          }
        />
      </div>
    );
  }

  const total = issues?.total ?? 0;
  const range = pageRange(page - 1, AUDIT_ISSUES_PAGE_SIZE, total);
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_ISSUES_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col">
        <BackLink to={backTo} />
        <PageHeader
          title={issues?.label ?? "Loading…"}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {domain === "" ? null : (
                <>
                  <span>{domain}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span>{`${formatCount(total)} affected page${total === 1 ? "" : "s"}`}</span>
              {issues ? (
                <Badge variant={SEVERITY_BADGE[issues.severity]}>
                  {SEVERITY_LABEL[issues.severity]}
                </Badge>
              ) : null}
            </span>
          }
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={exportCsv}
              disabled={rows.length === 0}
              title="Downloads the rows on this page — drill-downs are paginated."
            >
              <Download className="size-3.5" aria-hidden="true" />
              Export loaded rows
            </Button>
          }
        />
      </div>

      {issuesQuery.isError ? (
        <ApiErrorNotice
          error={issuesQuery.error}
          onRetry={() => void issuesQuery.refetch()}
          fallback="Could not load the affected pages for this category."
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            loading={issuesQuery.isPending}
            // One server page per table page: the shared pager would otherwise
            // slice these 50 rows again and report "1–25 of 50".
            pageSize={AUDIT_ISSUES_PAGE_SIZE}
            caption={`Pages affected by ${issues?.label ?? "this issue"}`}
            maxHeight="46rem"
            emptyState={
              <EmptyState
                icon={FileSearch}
                title="No affected pages"
                description="Nothing in this category on the crawled pages."
              />
            }
          />

          {/*
            The server-side pager. Rendered below the table's own controls
            rather than instead of them: this one moves between requests, and
            it says so.
          */}
          {total > AUDIT_ISSUES_PAGE_SIZE ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {`${formatPageRange(range)} · page ${page} of ${pageCount}`}
              </p>
              <div className="flex items-center gap-2">
                <PagerLink
                  to={pageHref(searchParams, page - 1)}
                  disabled={page <= 1}
                >
                  Previous
                </PagerLink>
                <PagerLink
                  to={pageHref(searchParams, page + 1)}
                  disabled={page >= pageCount}
                >
                  Next
                </PagerLink>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* --------------------------------- columns --------------------------------- */

const col = createDataTableColumns<AuditIssuePage>();

/**
 * URL, status, failing checks — then one column per detail key these rows
 * actually carry.
 *
 * Built from the data because `details` is per-category and open-ended (see
 * csv-rows.ts). A fixed column list would either be empty for most categories
 * or wrong for some.
 */
function buildColumns(
  rows: ReadonlyArray<AuditIssuePage>,
): Array<DataTableColumn<AuditIssuePage>> {
  const base: Array<DataTableColumn<AuditIssuePage>> = [
    col.accessor((row) => row.url, {
      id: "url",
      header: "Page",
      cell: (context) => {
        const { url } = context.row.original;
        return (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            title={url}
            className="font-medium text-foreground underline underline-offset-4 hover:no-underline"
          >
            {urlPath(url)}
          </a>
        );
      },
    }),
    col.accessor((row) => row.statusCode ?? 0, {
      id: "statusCode",
      header: "Status",
      cell: (context) => {
        const status = context.row.original.statusCode;
        if (status === null) {
          return <span className="text-muted-foreground">—</span>;
        }
        return (
          <Badge variant={status >= 400 ? "danger" : status >= 300 ? "warning" : "neutral"}>
            {status}
          </Badge>
        );
      },
    }),
    col.accessor((row) => row.checks.join(" "), {
      id: "checks",
      header: "Failing checks",
      cell: (context) => (
        <span className="flex flex-wrap gap-1">
          {context.row.original.checks.map((check) => (
            <Badge key={check} variant="neutral">
              {check.replaceAll("_", " ")}
            </Badge>
          ))}
        </span>
      ),
    }),
  ];

  const details = detailKeys(rows).map((key) =>
    col.accessor((row) => row.details[key] ?? null, {
      id: `detail-${key}`,
      header: humanizeDetailKey(key),
      cell: (context) => {
        const value = context.row.original.details[key];
        if (value === null || value === undefined || value === "") {
          return <span className="text-muted-foreground">—</span>;
        }
        return (
          <span
            className={
              typeof value === "number"
                ? "tabular-nums"
                : "block max-w-80 truncate"
            }
            title={String(value)}
          >
            {typeof value === "number" ? value.toLocaleString("en") : value}
          </span>
        );
      },
    }),
  );

  return [...base, ...details];
}

/* --------------------------------- pieces ---------------------------------- */

function pageHref(current: URLSearchParams, page: number): string {
  const params = new URLSearchParams(current);
  if (page <= 1) params.delete(PAGE_PARAM);
  else params.set(PAGE_PARAM, String(page));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

/**
 * A pager step.
 *
 * A link, not a button, because each page is its own URL — so it opens in a new
 * tab, and Back walks the pages. Disabled ends render as plain text rather than
 * as a link to nowhere.
 */
function PagerLink({
  to,
  disabled,
  children,
}: {
  to: string;
  disabled: boolean;
  children: string;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-8 cursor-not-allowed items-center rounded-app border border-border px-3 text-xs font-medium text-muted-foreground opacity-60">
        {children}
      </span>
    );
  }
  return (
    <Link
      to={to}
      className="inline-flex h-8 items-center rounded-app border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
    >
      {children}
    </Link>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mb-3 inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to audit
    </Link>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 pb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-96 w-full rounded-app" />
    </div>
  );
}
