/**
 * Previous audits for a project: pick one to view, or delete it.
 *
 * A list of buttons rather than a table — the rows are a single-select control,
 * and `aria-current` on the selected one says so far better than a highlighted
 * table row. Deleting is admin-only and confirmed, because an audit is not
 * recoverable: the row goes and so does its R2 prefix.
 */
import { Loader, Trash2, TriangleAlert } from "lucide-react";

import type { AuditListItem } from "../../../shared/audits";
import { Badge, Button, Card, cn } from "../ui";
import {
  BAND_TEXT_CLASS,
  EM_DASH,
  formatAuditTime,
  formatScore,
  isInFlight,
  pluralPages,
  scoreBand,
} from "./format";

export function AuditHistory({
  audits,
  selectedId,
  onSelect,
  onDelete,
  canDelete,
  deletingId,
}: {
  audits: ReadonlyArray<AuditListItem>;
  selectedId: string | null;
  onSelect: (auditId: string) => void;
  onDelete: (audit: AuditListItem) => void;
  canDelete: boolean;
  /** The audit currently being deleted, so its row can show a spinner. */
  deletingId: string | null;
}) {
  if (audits.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="history-heading">
      <h2
        id="history-heading"
        className="text-sm font-semibold tracking-tight text-foreground"
      >
        Audit history
      </h2>

      <Card className="divide-y divide-border overflow-hidden">
        <ul>
          {audits.map((audit) => (
            <li
              key={audit.id}
              className="flex items-center gap-3 border-b border-border last:border-b-0"
            >
              <button
                type="button"
                onClick={() => onSelect(audit.id)}
                aria-current={audit.id === selectedId ? "true" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  audit.id === selectedId
                    ? "bg-tint"
                    : "hover:bg-surface-muted",
                )}
              >
                <span
                  className={cn(
                    "min-w-40 text-sm font-medium",
                    audit.id === selectedId
                      ? "text-tint-foreground"
                      : "text-foreground",
                  )}
                >
                  {formatAuditTime(audit.createdAt)}
                </span>

                <span className="text-xs text-muted-foreground tabular-nums">
                  {audit.status === "done"
                    ? pluralPages(audit.pagesCrawled)
                    : `${pluralPages(audit.pagesLimit)} requested`}
                </span>

                {audit.renderJs ? (
                  <Badge variant="neutral">JS rendered</Badge>
                ) : null}

                <StatusCell audit={audit} />

                <span className="ml-auto flex items-baseline gap-1">
                  <span
                    className={cn(
                      "text-base font-semibold tabular-nums",
                      audit.score === null
                        ? "text-muted-foreground"
                        : BAND_TEXT_CLASS[scoreBand(audit.score)],
                    )}
                  >
                    {formatScore(audit.score)}
                  </span>
                  {audit.score === null ? null : (
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  )}
                </span>
              </button>

              {canDelete ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mr-2 shrink-0"
                  onClick={() => onDelete(audit)}
                  loading={deletingId === audit.id}
                  aria-label={`Delete the audit from ${formatAuditTime(audit.createdAt)}`}
                >
                  {deletingId === audit.id ? null : (
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/**
 * The status cell.
 *
 * "done" gets no badge at all — it is the expected outcome and a green tick on
 * every row is noise. The two states worth interrupting for get one.
 */
function StatusCell({ audit }: { audit: AuditListItem }) {
  if (audit.status === "failed") {
    return (
      <Badge variant="danger" title={audit.error ?? undefined}>
        <TriangleAlert className="size-3" aria-hidden="true" />
        Failed
      </Badge>
    );
  }
  if (isInFlight(audit.status)) {
    return (
      <Badge variant="info">
        <Loader className="size-3 animate-spin" aria-hidden="true" />
        {audit.status === "pending" ? "Queued" : "Crawling"}
      </Badge>
    );
  }
  return <span className="sr-only">{EM_DASH}</span>;
}
