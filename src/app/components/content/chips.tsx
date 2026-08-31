/**
 * Provenance chips for a composed result.
 *
 * Content Discovery needs its own rather than reusing `keywords/chips.tsx`,
 * because the standard `CostChip` answers "what did this request cost?" and on
 * this screen that question has a misleading answer. A cached composition costs
 * $0.00 *now*, but the set on screen was built from a dozen paid SERPs, and a
 * bare "Cached" badge tells a user nothing about where forty pages of data came
 * from or what re-running the sweep would cost them.
 *
 * So `BuildCostChip` reports what the set cost **to build**, always — the
 * `costs` breakdown travels on every response, cached or not — and the cached
 * state becomes a second, quieter chip beside it. Two facts, two chips, neither
 * pretending to be the other.
 */
import { Clock, Database, Receipt } from "lucide-react";

import type { ContentDiscoverCosts } from "../../../shared/content";
import { Badge } from "../ui";
import { describeCosts, formatCostHint } from "./cost";

/**
 * "Built for $0.07" — what this composition cost, whoever paid it and whenever.
 *
 * Deliberately not "live"/"cached" phrasing: the number is a property of the
 * result set, not of this request. `describeCosts` breaks it into its parts in
 * the tooltip, because a single figure for a four-endpoint composition is
 * exactly the sort of number people distrust when they cannot see inside it.
 */
export function BuildCostChip({
  costs,
  className = "",
}: {
  costs: ContentDiscoverCosts | undefined;
  className?: string;
}) {
  if (costs === undefined) return null;

  return (
    <Badge variant="info" className={className} title={describeCosts(costs)}>
      <Receipt className="size-3" aria-hidden="true" />
      {`Built for ${formatCostHint(costs.totalUsd)}`}
    </Badge>
  );
}

/**
 * Whether this particular request spent anything.
 *
 * Shown only when it did not, because "cached" is the interesting case: it is
 * what makes filtering and paging free, and a user who understands that will
 * use the knobs rather than nurse them.
 */
export function CachedChip({
  cached,
  className = "",
}: {
  cached: boolean | undefined;
  className?: string;
}) {
  if (cached !== true) return null;

  return (
    <Badge
      variant="neutral"
      className={className}
      title="This view came from your workspace's cached composition — no DataForSEO call was made. Filtering, sorting and paging all read from it, which is why they are free."
    >
      <Database className="size-3" aria-hidden="true" />
      Cached
    </Badge>
  );
}

/**
 * The stale-if-error chip.
 *
 * `stale: true` means a refresh timed out and the Worker served the last good
 * copy rather than an error (docs/ARCHITECTURE.md, "Stale-if-error"). That is
 * the right trade — data beats a spinner — but it must be visible, because the
 * numbers may describe a SERP that has since moved. Never shown for a
 * spend-cap or credential refusal: those are errors, and they get a notice.
 */
export function StaleChip({
  stale,
  className = "",
}: {
  stale: boolean | undefined;
  className?: string;
}) {
  if ((stale ?? false) !== true) return null;

  return (
    <Badge
      variant="warning"
      className={className}
      title="DataForSEO did not answer in time, so this is the last copy we hold. It is real data, but it may describe an older version of these search results."
    >
      <Clock className="size-3" aria-hidden="true" />
      cached · may be outdated
    </Badge>
  );
}
