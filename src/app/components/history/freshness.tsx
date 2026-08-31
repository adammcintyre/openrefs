/**
 * "How old is what I am looking at, and how do I make it new?"
 *
 * Two chips and a button, sitting together on every research header that can be
 * re-opened from the search trail:
 *
 *  - **Updated N ago** reads `ResultMeta.fetchedAt` — when the DataForSEO
 *    payload was actually pulled from the wire, which on a cache hit is *not*
 *    when this request happened. Absent means the endpoint has not been
 *    threaded yet, so the chip disappears rather than guessing.
 *  - **cached · may be outdated** is the treatment `ResultMeta.stale` asks for
 *    in src/shared/api.ts. It appears when the copy on screen was served past
 *    its normal lifetime — which is exactly what opening an entry from the
 *    trail does, deliberately, to keep that click free.
 *  - **Refresh** is the only control here that spends. It says so on hover,
 *    because everything else on this row is about *not* spending.
 */
import { RefreshCw } from "lucide-react";

import type { ResultMeta } from "../../../shared/api";
import { Badge, Button } from "../ui";
import { exactTime, relativeTime } from "./relative-time";

/**
 * The age of a result, or nothing.
 *
 * `now` is injectable so a test can pin the wording without freezing the clock;
 * nothing in the app passes it.
 */
export function UpdatedChip({
  meta,
  now,
}: {
  meta: Pick<ResultMeta, "fetchedAt" | "stale"> | null | undefined;
  now?: Date;
}) {
  const fetchedAt = meta?.fetchedAt;
  const age = relativeTime(fetchedAt, now);
  if (age === null) return null;

  const exact = exactTime(fetchedAt);
  return (
    <Badge
      variant="neutral"
      title={
        exact === null
          ? "When DataForSEO last fetched this data."
          : `DataForSEO fetched this data at ${exact}.`
      }
    >
      {`Updated ${age}`}
    </Badge>
  );
}

/**
 * The "this is older than we would normally serve" warning.
 *
 * Rendered only for `stale`, never merely for `cached`: an ordinary cache hit
 * is inside its TTL and is not something to warn about — saying so on every
 * repeat query would train users to ignore the chip that matters.
 */
export function StaleChip({
  meta,
}: {
  meta: Pick<ResultMeta, "stale"> | null | undefined;
}) {
  if (meta?.stale !== true) return null;
  return (
    <Badge
      variant="warning"
      title="Served from this workspace's cache past its normal lifetime, so this click cost nothing. Refresh to fetch it again."
    >
      cached · may be outdated
    </Badge>
  );
}

/**
 * One deliberate, billed re-fetch.
 *
 * A button rather than an automatic refetch on mount, and never wired to a
 * query's `refetch` — a refresh here sets `fresh=true`, which bypasses the
 * server cache and bills the workspace's own DataForSEO key.
 */
export function RefreshButton({
  onClick,
  loading = false,
  disabled = false,
  title = "Fetches this report again from DataForSEO. This spends credits.",
  label = "Refresh",
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
  label?: string;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={onClick}
      loading={loading}
      disabled={disabled}
      title={title}
    >
      <RefreshCw className="size-3.5" aria-hidden="true" />
      {label}
    </Button>
  );
}
