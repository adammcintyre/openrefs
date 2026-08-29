/**
 * The frame every tab in this module shares: a heading, the provenance chip, a
 * CSV button, an error slot, the table, and a pager.
 *
 * Structurally this is the same idea as Domain Overview's `tab-shell.tsx`, and
 * a later pass should lift one shared version into the primitive layer. It is
 * deliberately a separate file today for two reasons: `components/ui/**` and
 * `domain-overview/**` are owned by other agents this phase, and the load-more
 * bar here needs something that one does not — see `LoadMoreBar` below, where
 * "loaded" and "total" are allowed to disagree.
 */
import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";

import type { ResultMeta } from "../../../shared/api";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import { formatCount } from "../../components/domains/format";
import { ResultMetaChip } from "../../components/domains/result-meta-chip";
import { Button } from "../../components/ui";

export function TabShell({
  heading,
  description,
  meta,
  error,
  onRetry,
  onExport,
  exportDisabled = false,
  controls,
  children,
  footer,
}: {
  heading: string;
  description?: ReactNode;
  meta: ResultMeta | null | undefined;
  error?: unknown;
  onRetry?: () => void;
  onExport: () => void;
  exportDisabled?: boolean;
  /** Filters, toggles — anything that changes what gets fetched. */
  controls?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-foreground">
            {heading}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ResultMetaChip meta={meta} />
          <Button
            size="sm"
            variant="secondary"
            onClick={onExport}
            disabled={exportDisabled}
            title="Downloads the rows currently loaded, not the full result set."
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      {controls}

      {error ? <ApiErrorNotice error={error} onRetry={onRetry} /> : null}

      {children}

      {footer}
    </section>
  );
}

/**
 * "Load more" is a purchase, not a scroll — each press is another billed
 * request — so it stays an explicit button with the row count next to it, never
 * an infinite scroll that spends while the user reads.
 *
 * **The count and the total are allowed to disagree.** On the Referring domains
 * tab, DataForSEO's `total_count` counts *main* domains while the rows it
 * returns are domains *including* subdomains, so a site with many subdomains
 * genuinely loads more rows than the total claims exist. That is documented
 * upstream behaviour, not a bug to paper over, so the bar says "of about N",
 * explains itself on hover, and paging is driven by whether the last page came
 * back full rather than by the difference between the two numbers.
 */
export function LoadMoreBar({
  loaded,
  total,
  totalIsApproximate = false,
  totalNote,
  hasMore,
  isFetching,
  onLoadMore,
  pageSize,
}: {
  loaded: number;
  total: number | null;
  /** Renders "of about N" and attaches `totalNote` as the tooltip. */
  totalIsApproximate?: boolean;
  totalNote?: string;
  hasMore: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  pageSize: number;
}) {
  if (loaded === 0) return null;

  const countText =
    total === null
      ? `${formatCount(loaded)} rows loaded`
      : totalIsApproximate
        ? `${formatCount(loaded)} of about ${formatCount(total)} rows loaded`
        : `${formatCount(loaded)} of ${formatCount(total)} rows loaded`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p
        className="text-xs text-muted-foreground"
        aria-live="polite"
        title={totalIsApproximate ? totalNote : undefined}
      >
        {countText}
      </p>
      {hasMore ? (
        <Button
          size="sm"
          variant="secondary"
          loading={isFetching}
          onClick={onLoadMore}
          title="Fetches the next page from DataForSEO — this spends credits."
        >
          Load {pageSize} more
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Everything loaded</span>
      )}
    </div>
  );
}
