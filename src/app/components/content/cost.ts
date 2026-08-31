/**
 * What a Content Discovery sweep costs, and how to say so before it is spent.
 *
 * Content Discovery is the only module whose price the user picks from a menu:
 * the Expansion select turns one topic into 1, 6 or 11 SERPs, and the difference
 * between the cheapest and dearest option is roughly twenty-fold. So each option
 * has to carry its own figure at the moment of choosing, not after.
 *
 * **Three facts shape every number here.**
 *
 * 1. **The SERP fan-out is the bill.** `expand=N` buys `1 + N` live SERPs. That
 *    count is derived from the expansion value rather than tabulated, so adding
 *    an option to `CONTENT_EXPAND_OPTIONS` cannot leave a stale price behind.
 * 2. **Enrichment is per-page and unknowable in advance.** Domain Scores and
 *    traffic estimates are bought for however many unique pages the SERPs turn
 *    out to hold — which is exactly what nobody knows before running it. The
 *    estimate therefore covers the flat, certain part and the copy says the rest
 *    is "a fraction of a cent per page", rather than inventing a page count.
 * 3. **The real figure arrives with the result.** Every discover response
 *    carries a `ContentDiscoverCosts` breakdown — even a cached one, where it
 *    describes what the set cost to *build* rather than what this request cost.
 *    Once that is on screen it is the truth and these estimates step aside.
 *
 * **Where these numbers live.** The authoritative copies are in the Worker's
 * DataForSEO wrappers — `SERP_DEFAULT_DEPTH` and the live-SERP rate noted beside
 * `SERP_TASK_PRICE_PER_10_RESULTS_USD` in `src/worker/dataforseo/serp.ts`,
 * `BULK_TRAFFIC_ESTIMATION_PRICE_PER_TASK_USD` and `…_PER_ITEM_USD` in
 * `src/worker/dataforseo/labs.ts`, and `CONTENT_PARSING_PRICE_PER_URL_USD` in
 * `src/worker/dataforseo/on-page.ts`. They are re-declared here rather than
 * imported for the same reason `components/audit/cost.ts` re-declares its own:
 * the SPA must not pull Worker modules, which import the DataForSEO client and
 * Hono. `cost.test.ts` pins these values so the copies cannot drift unnoticed;
 * the fix that removes the duplication is to lift them into
 * `src/shared/content.ts` and have both sides import from there.
 */
import type { ContentDiscoverCosts, ContentExpand } from "../../../shared/content";
import { CONTENT_WORDCOUNT_MAX_URLS } from "../../../shared/content";

/**
 * Live SERP, USD per 10 results. Their live tier is dearer than the queued one
 * ($0.002 vs $0.0006) and this module only ever reads live — a topic sweep that
 * returned yesterday's SERP would be describing yesterday's opportunity.
 */
export const CONTENT_SERP_PRICE_PER_10_RESULTS_USD = 0.002;

/** Results per SERP the Worker asks for (`SERP_DEFAULT_DEPTH`). */
export const CONTENT_SERP_DEPTH = 20;

/**
 * One SERP at the depth we actually buy. Derived, so changing either input
 * above cannot leave the select quoting a rate we no longer pay.
 */
export const CONTENT_SERP_PRICE_USD =
  CONTENT_SERP_PRICE_PER_10_RESULTS_USD * (CONTENT_SERP_DEPTH / 10);

/**
 * One `keyword_suggestions` lookup — the call that turns a topic into its
 * expansion keywords. Bought once per sweep, and only when `expand > 0`.
 *
 * Measured live rather than taken from a rate card: Labs keyword endpoints are
 * priced per request with a volume component, and $0.0126 is what the Worker
 * observed on 2026-08-31 (recorded in the `EXPANSION_SORT` note in
 * `src/worker/routes/content.ts`). It dominates the cheap end of the menu —
 * more than three SERPs' worth — so leaving it out would make "+5 related" look
 * half its real price.
 */
export const CONTENT_EXPANSION_PRICE_USD = 0.0126;

/** Flat fee for one `bulk_traffic_estimation` call, before its per-item rate. */
export const CONTENT_TRAFFIC_PRICE_PER_TASK_USD = 0.012;

/** Per-target rate on top of that flat fee. */
export const CONTENT_TRAFFIC_PRICE_PER_ITEM_USD = 0.00012;

/** One URL parsed for its word count (`content_parsing/live`). */
export const CONTENT_WORDCOUNT_PRICE_PER_URL_USD = 0.00015;

/**
 * SERPs bought for an expansion setting: the topic, plus one per related
 * keyword.
 *
 * Deliberately arithmetic rather than a lookup table keyed by expand value —
 * a table is a second place for the truth to live, and the whole point of the
 * select is that its three options are the same shape at different scales.
 */
export function serpCallsForExpand(expand: number): number {
  return 1 + Math.max(0, expand);
}

/**
 * The certain part of a sweep's price: every SERP, the expansion lookup when
 * there is one, and the flat traffic-estimation fee that is charged once
 * however many pages come back.
 *
 * What it deliberately excludes is the per-page enrichment — traffic at
 * $0.00012 a page and the Domain Score lookup — because both scale with a page
 * count that does not exist until the SERPs land. Excluding them makes this an
 * under-estimate by design, which is why nothing in the UI presents it as a
 * ceiling: `formatExpandCostHint` prefixes it with "from".
 */
export function estimateDiscoverCostUsd(expand: number): number {
  const serps = serpCallsForExpand(expand) * CONTENT_SERP_PRICE_USD;
  const expansion = expand > 0 ? CONTENT_EXPANSION_PRICE_USD : 0;
  return round6(serps + expansion + CONTENT_TRAFFIC_PRICE_PER_TASK_USD);
}

/** What counting words for `urls` URLs costs. One parse per URL, no batching. */
export function estimateWordCountCostUsd(urls: number): number {
  return round6(Math.max(0, urls) * CONTENT_WORDCOUNT_PRICE_PER_URL_USD);
}

function round6(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * A cost figure for display.
 *
 * Four decimals below a cent rather than rounding a real charge to "$0.00" and
 * implying it was free — the same rule as `components/audit/cost.ts`, applied
 * to the same class of sub-cent number.
 */
export function formatCostHint(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * The label suffix on one Expansion option, e.g. "from $0.0296".
 *
 * "from" and not "≈": the figure omits per-page enrichment (see
 * `estimateDiscoverCostUsd`), so it is a floor. Saying "≈" for a number that
 * can only be exceeded is the kind of small dishonesty that costs trust the
 * first time someone checks their DataForSEO bill.
 */
export function formatExpandCostHint(expand: ContentExpand | number): string {
  return `from ${formatCostHint(estimateDiscoverCostUsd(expand))}`;
}

/**
 * The bulk word-count button's label, priced at a full batch.
 *
 * Quoted per `CONTENT_WORDCOUNT_MAX_URLS` rather than per selected row because
 * the per-URL figure ($0.00015) rounds to a number with more zeros than
 * meaning, and the cap is what the button is bounded by anyway.
 */
export function formatWordCountHint(): string {
  return `≈${formatCostHint(
    estimateWordCountCostUsd(CONTENT_WORDCOUNT_MAX_URLS),
  )} per ${CONTENT_WORDCOUNT_MAX_URLS}`;
}

/**
 * The sentence behind the cost chip: what the composed set was made of.
 *
 * Reads from the response's own breakdown, so it describes what was actually
 * bought rather than what we predicted. `serpCalls` is quoted from the payload
 * for the same reason — a sweep can legitimately buy fewer SERPs than the
 * expansion asked for when the topic has few suggestions above the volume
 * floor, and claiming eleven when six were bought would be wrong.
 */
export function describeCosts(costs: ContentDiscoverCosts): string {
  const parts = [
    `${costs.serpCalls} SERP${costs.serpCalls === 1 ? "" : "s"} ${formatCostHint(costs.serpUsd)}`,
  ];
  if (costs.expansionUsd > 0) {
    parts.push(`related keywords ${formatCostHint(costs.expansionUsd)}`);
  }
  if (costs.scoresUsd > 0) {
    parts.push(`Domain Scores ${formatCostHint(costs.scoresUsd)}`);
  }
  if (costs.trafficUsd > 0) {
    parts.push(`traffic estimates ${formatCostHint(costs.trafficUsd)}`);
  }
  return `${parts.join(" · ")} — ${formatCostHint(costs.totalUsd)} total`;
}
