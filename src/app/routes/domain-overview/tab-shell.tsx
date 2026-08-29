/**
 * The frame every tab in this module shares: a heading, the provenance chip,
 * a CSV button, an error slot, the table, and a pager.
 *
 * Extracted because four tabs repeating this by hand is four chances for the
 * cost chip to drift away from the rows it describes.
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
 * request — so it stays an explicit button with the row count next to it, and
 * never an infinite scroll that spends while the user reads.
 */
export function LoadMoreBar({
  loaded,
  total,
  hasMore,
  isFetching,
  onLoadMore,
  pageSize,
}: {
  loaded: number;
  total: number | null;
  hasMore: boolean;
  isFetching: boolean;
  onLoadMore: () => void;
  pageSize: number;
}) {
  if (loaded === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {total === null
          ? `${formatCount(loaded)} rows loaded`
          : `${formatCount(loaded)} of ${formatCount(total)} rows loaded`}
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
