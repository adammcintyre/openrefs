/**
 * The issues table: one row per category that found something.
 *
 * Built straight from `AuditSummary.categories`, which is always all 17 in a
 * fixed order. Two consequences drive this file:
 *
 *  - **The empty ones do not belong in the table.** A category that found
 *    nothing still arrives with severity `notice`, so rendering all 17 gives a
 *    clean site sixteen grey rows and hides the one real error. They go in a
 *    collapsed list underneath instead, which is also the honest answer to "did
 *    you actually check redirects?".
 *  - **The comparison chip costs nothing.** `previous.categoryCounts` comes
 *    down with the summary, so "+3 / −7 vs previous" is a subtraction, not a
 *    second request.
 */
import { CheckCircle2, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import type {
  AuditCategoryResult,
  AuditComparison,
} from "../../../shared/audits";
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  createDataTableColumns,
} from "../ui";
import type { DataTableColumn } from "../ui";
import {
  DELTA_TONE_BADGE,
  SEVERITY_BADGE,
  SEVERITY_LABEL,
  categoryDelta,
  deltaTitle,
  deltaTone,
  formatDelta,
  partitionCategories,
} from "./format";

/** A row is the category plus everything the cells need to render it. */
interface IssueRow {
  category: AuditCategoryResult;
  delta: number | null;
  href: string;
}

const col = createDataTableColumns<IssueRow>();

const COLUMNS: Array<DataTableColumn<IssueRow>> = [
  col.accessor((row) => row.category.label, {
    id: "category",
    header: "Category",
    cell: (context) => {
      const { category, href } = context.row.original;
      return (
        <Link
          to={href}
          className="group flex flex-col gap-0.5 rounded-app focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex items-center gap-1 font-medium text-foreground group-hover:underline">
            {category.label}
            <ChevronRight
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            {category.description}
          </span>
        </Link>
      );
    },
  }),
  col.accessor((row) => row.category.severity, {
    id: "severity",
    header: "Severity",
    cell: (context) => {
      const { severity } = context.row.original.category;
      return (
        <Badge variant={SEVERITY_BADGE[severity]}>
          {SEVERITY_LABEL[severity]}
        </Badge>
      );
    },
  }),
  col.accessor((row) => row.category.affectedPages, {
    id: "affectedPages",
    header: "Affected pages",
    cell: (context) => (
      <span className="tabular-nums">
        {context.row.original.category.affectedPages.toLocaleString("en")}
      </span>
    ),
  }),
  col.accessor((row) => row.delta ?? 0, {
    id: "delta",
    header: "vs previous",
    cell: (context) => {
      const { delta, category } = context.row.original;
      if (delta === null) {
        return (
          <span className="text-xs text-muted-foreground" title={deltaTitle(null, category.label)}>
            —
          </span>
        );
      }
      return (
        <Badge
          variant={DELTA_TONE_BADGE[deltaTone(delta)]}
          title={deltaTitle(delta, category.label)}
        >
          {formatDelta(delta)}
        </Badge>
      );
    },
  }),
];

export function IssuesTable({
  categories,
  previous,
  hrefFor,
  loading = false,
}: {
  categories: ReadonlyArray<AuditCategoryResult>;
  previous: AuditComparison | null;
  /** Where a category drills down to. */
  hrefFor: (category: AuditCategoryResult) => string;
  loading?: boolean;
}) {
  const { failing, clean } = partitionCategories(categories);

  const rows: IssueRow[] = failing.map((category) => ({
    category,
    delta: categoryDelta(category, previous),
    href: hrefFor(category),
  }));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="issues-heading">
      <h2
        id="issues-heading"
        className="text-sm font-semibold tracking-tight text-foreground"
      >
        Issues by category
      </h2>

      <DataTable
        columns={COLUMNS}
        data={rows}
        loading={loading}
        pageSize={20}
        caption="Audit issues by category"
        emptyState={
          <EmptyState
            icon={CheckCircle2}
            title="No issues found"
            description="Every category this audit checked came back clean. The full list is below."
          />
        }
      />

      {clean.length > 0 ? <CleanCategories categories={clean} /> : null}
    </section>
  );
}

/**
 * The categories that found nothing.
 *
 * A native <details> — it is keyboard-operable, announces its own expanded
 * state and needs no JavaScript. Collapsed by default because "nothing wrong
 * here" is the least urgent thing on the page, but present because an audit
 * that silently omitted eleven of its seventeen checks would be impossible to
 * distinguish from one that ran them.
 */
function CleanCategories({
  categories,
}: {
  categories: ReadonlyArray<AuditCategoryResult>;
}) {
  return (
    <Card className="overflow-hidden">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium text-foreground hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
          <CheckCircle2
            className="size-4 shrink-0 text-success"
            aria-hidden="true"
          />
          {`${categories.length} categor${categories.length === 1 ? "y" : "ies"} found no issues`}
          <ChevronRight
            className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <ul className="flex flex-col gap-2 border-t border-border p-4">
          {categories.map((category) => (
            <li key={category.category} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {category.label}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {category.description}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
