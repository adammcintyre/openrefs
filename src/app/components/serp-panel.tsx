/**
 * The shared "who ranks for this keyword" view, opened from any keyword table
 * (Keyword Research tabs, Domain Overview keywords, later Gap Analysis).
 *
 * Opening reads the workspace's cached SERP where one exists; only Refresh
 * sets `fresh=true` and spends. That split is the whole cost model of this
 * panel: browsing results is free after the first look, and the one control
 * that costs money says so before you press it and reports what it cost after.
 */
import { RefreshCw, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import type { SerpRow } from "../../shared/keywords";
import { CostChip, CostHint } from "./keywords/chips";
import {
  ApiErrorNotice,
  isConfigurationError,
} from "./keywords/api-error-notice";
import { formatDate, formatSerpFeature, formatVolume } from "./keywords/format";
import { useRefreshSerp, useSerp } from "./keywords/queries";
import { Badge, Button, Dialog, EmptyState, Skeleton } from "./ui";

/**
 * This file is OWNED by the Keyword Research UI agent. Other modules import it
 * against these frozen props — change the implementation freely, never the
 * props without checking every call site.
 */
export interface SerpPanelProps {
  workspaceId: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Only http(s) becomes a link.
 *
 * These URLs are third-party data being rendered into an href, so the scheme
 * is checked rather than trusted: a `javascript:` value reaching this attribute
 * would be script execution on our origin. Anything else renders as plain text.
 */
function safeHttpUrl(url: string | null): string | null {
  if (url === null || url === "") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function SerpResultRow({ row }: { row: SerpRow }) {
  const href = safeHttpUrl(row.url);
  const position = row.position ?? row.positionAbsolute;

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3 align-top">
        <span className="font-medium tabular-nums text-foreground">
          {position ?? "—"}
        </span>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-medium text-foreground">
            {row.title ?? "Untitled result"}
          </span>
          {href === null ? (
            <span className="text-xs break-all text-muted-foreground">
              {row.url ?? "—"}
            </span>
          ) : (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs break-all text-primary underline-offset-2 hover:underline"
            >
              {row.url}
            </a>
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <span className="text-muted-foreground">{row.domain ?? "—"}</span>
      </td>
    </tr>
  );
}

export function SerpPanel({
  workspaceId,
  keyword,
  locationCode,
  languageCode,
  open,
  onClose,
}: SerpPanelProps) {
  const market = { locationCode, languageCode };
  const query = useSerp(workspaceId, keyword, market, open);
  const refresh = useRefreshSerp(workspaceId, keyword, market);

  /*
   * What a live read of this endpoint actually cost, learned by observing one
   * rather than hardcoding a price list that would drift out of date. Until we
   * have seen an uncached response the hint stays qualitative — better to say
   * "this spends" than to quote a number we invented.
   */
  const [liveCostUsd, setLiveCostUsd] = useState<number | null>(null);
  const data = query.data;

  useEffect(() => {
    if (data !== undefined && !data.cached && data.costUsd > 0) {
      setLiveCostUsd(data.costUsd);
    }
  }, [data]);

  const error = query.error ?? refresh.error;
  const loading = query.isPending && open;
  const items = data?.items ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`SERP: ${keyword}`}
      description={
        data?.totalResults !== null && data?.totalResults !== undefined
          ? `About ${formatVolume(data.totalResults)} results on Google.`
          : "Top organic results from Google."
      }
      size="lg"
      dismissible={!refresh.isPending}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <CostHint costUsd={liveCostUsd} />
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={refresh.isPending}>
              Close
            </Button>
            <Button
              onClick={() => refresh.mutate()}
              loading={refresh.isPending}
              // A refresh with no baseline result to replace is just the
              // initial fetch at a higher price.
              disabled={loading}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Provenance strip: what this cost, and how old it is. */}
        <div className="flex flex-wrap items-center gap-2">
          <CostChip meta={data} />
          {data?.fetchedAt ? (
            <span className="text-xs text-muted-foreground">
              Fetched {formatDate(data.fetchedAt)}
            </span>
          ) : null}
        </div>

        {error !== null && error !== undefined ? (
          <ApiErrorNotice
            error={error}
            onRetry={
              isConfigurationError(error) ? undefined : () => void query.refetch()
            }
          />
        ) : null}

        {data !== undefined && data.serpFeatures.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              SERP features on this page
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.serpFeatures.map((feature) => (
                <Badge key={feature} variant="neutral">
                  {formatSerpFeature(feature)}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col gap-2" aria-live="polite" aria-busy="true">
            <span className="sr-only">Loading search results…</span>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full rounded-app" />
            ))}
          </div>
        ) : items.length === 0 && error === null ? (
          <EmptyState
            icon={SearchX}
            title="No organic results"
            description="Google returned no organic listings for this keyword in this market. Features like ads or an AI overview may still occupy the page."
          />
        ) : items.length > 0 ? (
          <div className="overflow-hidden rounded-app border border-border">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                {`Organic results for ${keyword}`}
              </caption>
              <thead className="bg-surface-muted">
                <tr>
                  <th
                    scope="col"
                    className="border-b border-border px-4 py-2.5 text-left font-medium text-muted-foreground"
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="border-b border-border px-4 py-2.5 text-left font-medium text-muted-foreground"
                  >
                    Result
                  </th>
                  <th
                    scope="col"
                    className="border-b border-border px-4 py-2.5 text-left font-medium text-muted-foreground"
                  >
                    Domain
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, index) => (
                  <SerpResultRow
                    key={`${row.url ?? "row"}-${index}`}
                    row={row}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          A Domain Score column for each result arrives with the Backlinks
          module.
        </p>
      </div>
    </Dialog>
  );
}
