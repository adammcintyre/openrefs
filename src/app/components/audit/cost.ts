/**
 * What an audit costs, and how to say so honestly.
 *
 * Three things about audit pricing shape every function here, and each one is a
 * misleading number on screen if you assume otherwise:
 *
 * 1. **The estimate is a ceiling, not a bill.** DataForSEO charge for the pages
 *    actually crawled and refund the difference when a site turns out to have
 *    fewer pages than requested. A 1000-page crawl of a 40-page site costs the
 *    40 pages. So every string this file produces says "up to".
 * 2. **JS rendering is 10× the base rate, not 2×.** docs/specs/PHASE4.md says
 *    "≈2× cost"; the spec predates the price check. The toggle must be labelled
 *    from these constants.
 * 3. **Lighthouse is a flat per-audit charge that dominates a small crawl.** One
 *    Lighthouse run ($0.005) costs more than an entire 25-page crawl ($0.00375),
 *    so it cannot be rounded away — an estimate that ignored it would understate
 *    a 25-page audit by more than half.
 *
 * **Where these numbers live.** The authoritative copies are
 * `ON_PAGE_PRICE_PER_PAGE_USD`, `ON_PAGE_PRICE_PER_PAGE_JS_USD` and
 * `LIGHTHOUSE_PRICE_PER_TASK_USD` in `src/worker/dataforseo/on-page.ts`
 * (verified against DataForSEO's price list on 2026-08-29, source URL recorded
 * there). They are re-declared here rather than imported because the SPA must
 * not pull Worker modules — that file imports the DataForSEO client and Hono's
 * exception type — and rather than read from `src/shared/audits.ts`, which is
 * where the pair belongs but does not yet export them. `cost.test.ts` pins these
 * values so the copy cannot drift unnoticed; the fix that removes the
 * duplication is to move all three into `src/shared/audits.ts` and have both
 * sides import from there.
 *
 * The estimate is a hint either way. The authoritative figure is what the client
 * meters into `api_usage` when the task is posted, which is why the create
 * response carries its own `estimatedCostUsd` and the UI prefers that once it
 * has one.
 */
import type { AuditCrawlSize } from "../../../shared/audits";

/** Basic crawl, USD per crawled page. $0.15 per 1000. */
export const AUDIT_PRICE_PER_PAGE_USD = 0.00015;

/**
 * With JavaScript rendering, USD per page — **10× basic**, not 2×. Their
 * formula is `basic + basic × 9`.
 */
export const AUDIT_PRICE_PER_PAGE_JS_USD = 0.0015;

/** One homepage Lighthouse run, USD. Flat, charged once per audit. */
export const AUDIT_LIGHTHOUSE_PRICE_USD = 0.005;

/**
 * How much dearer JS rendering is, for the toggle's label. 10 today.
 *
 * Rounded, because the division it is derived from is not exact in IEEE754 —
 * `0.0015 / 0.00015` evaluates to 9.999999999999998, and a toggle labelled
 * "≈9.999999999999998× cost" is worse than no label. Derived rather than
 * hardcoded so that changing either rate above cannot leave the label lying.
 */
export const AUDIT_JS_COST_MULTIPLIER = Math.round(
  AUDIT_PRICE_PER_PAGE_JS_USD / AUDIT_PRICE_PER_PAGE_USD,
);

/** USD per page for a crawl with these options. */
export function perPageCostUsd(renderJs: boolean): number {
  return renderJs ? AUDIT_PRICE_PER_PAGE_JS_USD : AUDIT_PRICE_PER_PAGE_USD;
}

/**
 * The ceiling for one audit: every page at the per-page rate, plus Lighthouse.
 *
 * Rounded to six decimal places because the arithmetic is on numbers as small
 * as $0.00015 and IEEE754 otherwise leaves `0.008750000000000001` on screen.
 */
export function estimateAuditCostUsd(
  maxCrawlPages: number,
  renderJs: boolean,
): number {
  const crawl = Math.max(0, maxCrawlPages) * perPageCostUsd(renderJs);
  return round6(crawl + AUDIT_LIGHTHOUSE_PRICE_USD);
}

function round6(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * A cost figure for display.
 *
 * Audit estimates are almost always sub-cent, so this keeps four decimals below
 * $0.01 rather than rounding a real charge to "$0.00" and implying the crawl is
 * free. Mirrors `formatCostHint` in components/tracking/format.ts — the same
 * rule, applied to the same class of number; a later cleanup should lift one
 * copy into components/domains/format.ts and delete the other.
 */
export function formatCostHint(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * The sentence under the Run button.
 *
 * Always "up to", never a bare figure: see note 1 in the file header. Unused
 * pages are refunded, and a user who is told "$0.15" for a 1000-page crawl of a
 * 30-page site has been told something untrue.
 */
export function formatCostCeiling(usd: number): string {
  return `up to ${formatCostHint(usd)}`;
}

/**
 * The per-page rate itself.
 *
 * Finer than `formatCostHint`, which floors at four decimals and would render
 * the base rate of $0.00015 as "$0.0002" — a 33% overstatement of the number
 * the sentence goes on to multiply. Trailing zeros are stripped so the JS rate
 * reads "$0.0015" rather than "$0.00150".
 */
export function formatPerPageRate(usd: number): string {
  const fixed = usd.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
  return `$${fixed}`;
}

/**
 * The full explanation, for the hint line beside the crawl-size select.
 *
 * Names both halves of the estimate because they behave differently: the crawl
 * half is refundable and the Lighthouse half is not.
 */
export function costBreakdown(
  maxCrawlPages: AuditCrawlSize | number,
  renderJs: boolean,
): string {
  const perPage = perPageCostUsd(renderJs);
  const crawl = round6(maxCrawlPages * perPage);
  return (
    `${maxCrawlPages.toLocaleString("en")} pages × ${formatPerPageRate(perPage)} = ` +
    `${formatCostHint(crawl)}, plus ${formatCostHint(AUDIT_LIGHTHOUSE_PRICE_USD)} ` +
    `for one Lighthouse run on the homepage. You are charged for the pages ` +
    `actually crawled — the rest is refunded.`
  );
}
