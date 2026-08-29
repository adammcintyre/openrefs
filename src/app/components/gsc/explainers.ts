/**
 * The sentence under each opportunity table.
 *
 * **Every number in this copy comes from the response.** The rules run
 * worker-side and return the exact thresholds they used
 * (`GscOpportunityThresholds`), precisely so the explanation cannot drift from
 * the computation. Hardcoding "at least 100 impressions" here would be a lie
 * the moment the rule changed — and for striking distance it would be a lie
 * immediately, because that threshold is *the median of this property's own
 * query set*. It is a different number for every property and every window, and
 * saying so is most of what makes the list trustworthy: it is not an arbitrary
 * cut-off, it is "busier than half of your own queries".
 *
 * These return plain strings rather than JSX so they can be asserted directly.
 */
import type {
  GscOpportunityList,
  GscOpportunityThresholds,
} from "../../../shared/gsc";
import { formatGscCount, formatGscPosition, formatGscShare } from "./format";

/**
 * Position 5–20, above-median impressions.
 *
 * The median is named as a median rather than presented as a bare number: "at
 * least 1,204 impressions" invites "why 1,204?", and the answer — half your
 * queries get fewer — is the justification for the whole list.
 */
export function strikingDistanceExplainer(
  thresholds: GscOpportunityThresholds["strikingDistance"],
): string {
  const from = formatGscPosition(thresholds.minPosition);
  const to = formatGscPosition(thresholds.maxPosition);
  const impressions = formatGscCount(thresholds.minImpressions);
  return (
    `Queries averaging position ${from} to ${to} that were seen at least ` +
    `${impressions} times — the median for this property's queries in this ` +
    `window, so every one of these is busier than half your other searches. ` +
    `Real demand, just short of page one: the smallest gap you can close.`
  );
}

/**
 * Top-10 positions clicking below half the expected curve.
 *
 * The ratio arrives as a fraction and is stated as a percentage, because
 * "below 0.5 of expected" is a sentence nobody reads correctly at a glance.
 */
export function lowCtrExplainer(
  thresholds: GscOpportunityThresholds["lowCtr"],
): string {
  const position = formatGscPosition(thresholds.maxPosition);
  const ratio = formatGscShare(thresholds.ratio);
  return (
    `Queries ranking at position ${position} or better whose click-through ` +
    `rate is under ${ratio} of what a result in that position normally earns. ` +
    `You already have the ranking; the title and description are not ` +
    `persuading anyone to use it.`
  );
}

/** Two or more pages splitting one query's clicks. */
export function cannibalizationExplainer(
  thresholds: GscOpportunityThresholds["cannibalization"],
): string {
  const share = formatGscShare(thresholds.minShareOfClicks);
  const pages = thresholds.minPages;
  return (
    `Queries where ${pages} or more of your pages each take at least ` +
    `${share} of the clicks. The site is competing with itself: consolidate ` +
    `them, or make each page clearly answer a different question.`
  );
}

/**
 * "Showing 200 of 843", or nothing at all.
 *
 * Returns null for a complete list rather than "showing 12 of 12", which reads
 * as a warning about nothing. Without this line a capped list is
 * indistinguishable from a complete one — the reason `total` is in the response
 * at all.
 */
export function truncationNote<T>(
  list: GscOpportunityList<T> | undefined,
): string | null {
  if (list === undefined) return null;
  const shown = list.items.length;
  if (list.total <= shown) return null;
  return (
    `Showing the top ${formatGscCount(shown)} of ${formatGscCount(list.total)}. ` +
    `Work through these and re-run the report to see the next ones.`
  );
}

/**
 * The note that a query may appear more than once across the three lists.
 *
 * Not a caveat so much as a finding: a query that is both in striking distance
 * and under-clicked is a page with two separate, independently fixable
 * problems, and seeing it twice is the point.
 */
export const GSC_OVERLAP_NOTE =
  "A query can appear in more than one list. That is not double-counting — " +
  "a search that is both short of page one and under-clicked has two separate " +
  "problems, and each one is fixed differently.";
