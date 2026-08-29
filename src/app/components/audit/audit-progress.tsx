/**
 * The waiting state — a crawl takes one to three minutes and nothing useful
 * exists until it ends.
 *
 * `progress` is null until the first poll of DataForSEO's queue comes back, so
 * this has to work both with and without numbers. With them it shows a real bar
 * ("48 of 250 pages"); without them it says what it is waiting for in words.
 * What it never does is show a determinate bar built from a guess.
 */
import { Loader } from "lucide-react";

import type { AuditProgress } from "../../../shared/audits";
import { Card } from "../ui";
import { pluralPages } from "./format";

export function AuditProgressCard({
  progress,
  pagesLimit,
  domain,
}: {
  progress: AuditProgress | null;
  pagesLimit: number;
  domain: string;
}) {
  /*
   * The denominator is the crawl's own limit when the poll has told us one,
   * and the requested ceiling otherwise. Never zero: a bar dividing by zero
   * renders as NaN% wide, which in practice means full.
   */
  const limit = Math.max(1, progress?.pagesLimit || pagesLimit || 1);
  const crawled = progress?.pagesCrawled ?? 0;
  const percent = progress === null ? null : Math.min(100, Math.round((crawled / limit) * 100));

  return (
    <Card className="flex flex-col gap-3 p-5" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Loader className="size-4 animate-spin" aria-hidden="true" />
        {`Crawling ${domain}`}
      </p>

      {percent === null ? (
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The crawl has been queued with DataForSEO and starts within a minute.
          This page updates itself — most audits finish in one to three minutes.
        </p>
      ) : (
        <>
          {/*
            A native <progress>: it announces its own value, respects forced
            colours, and needs no ARIA. The text beside it repeats the numbers
            because a bar alone is not a page count.
          */}
          <progress
            value={crawled}
            max={limit}
            className="h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-surface-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
          >
            {`${percent}%`}
          </progress>
          <p className="text-sm text-muted-foreground tabular-nums">
            {`${crawled.toLocaleString("en")} of ${pluralPages(limit)} crawled`}
            {progress !== null && progress.pagesInQueue > 0
              ? ` · ${progress.pagesInQueue.toLocaleString("en")} in queue`
              : ""}
          </p>
        </>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        You can leave this page — the crawl runs on DataForSEO's side and the
        result is stored when it lands.
      </p>
    </Card>
  );
}
