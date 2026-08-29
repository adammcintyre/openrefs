/**
 * Turning a crawl into an audit: the classification pass.
 *
 * Everything here is pure. It takes normalised crawled pages and produces the
 * two artefacts the product is made of — the per-category rollup that goes in
 * `audits.summary_json`, and the per-category list of affected pages that goes
 * to R2. No bindings, no fetches, so the taxonomy's behaviour is testable
 * against fixtures rather than against a live crawl.
 *
 * The counting rules are the subtle part, and they differ on purpose:
 *
 *  - `AuditCategoryResult.affectedPages` counts **distinct pages**. One page
 *    failing three title checks is one page with a title problem.
 *  - `AuditCheckCount.pages` counts pages **per check**, so the same page
 *    appears under each check it fails.
 *  - `AuditSummary.totalIssues` counts **(check, page) pairs** — the headline
 *    "N issues found".
 *
 * Summing the per-check numbers to get the category number is therefore wrong,
 * and is the mistake this comment exists to prevent.
 */
import type {
  AuditCategory,
  AuditCategoryResult,
  AuditCheckCount,
  AuditIssuePage,
  AuditSeverity,
} from "../../shared/audits";
import { AUDIT_CATEGORIES } from "../../shared/audits";
import type { CheckDefinition } from "./taxonomy";
import {
  CATEGORY_DEFINITIONS,
  CHECK_DEFINITIONS,
  worstSeverity,
} from "./taxonomy";

/**
 * One crawled page, reduced to what classification needs.
 *
 * Built by the OnPage wrapper from a `pages` result item; kept separate from
 * the wire shape so the taxonomy is not coupled to DataForSEO's field names.
 */
export interface CrawledPage {
  url: string;
  statusCode: number | null;
  /** DataForSEO's per-page `checks` map, verbatim. */
  checks: Record<string, boolean>;
  /**
   * The specific failing values worth showing in a drill-down — current title
   * and its length, response time, size, and so on. Passed through to
   * `AuditIssuePage.details`.
   */
  details: Record<string, string | number | null>;
}

/**
 * How an unmapped check is treated.
 *
 * DataForSEO add checks over time, and a check that appeared upstream after
 * this table was written must still be visible — an audit that silently
 * ignored it would claim a completeness it does not have. So it lands in
 * `other`, at `notice`, counted when **true**.
 *
 * Counting-when-true is an assumption, and a stated one: their check names are
 * overwhelmingly named for the fault (`no_title`, `is_broken`, `high_loading_time`),
 * so `true` means "the page has this problem" for almost all of them. The
 * exceptions are named for the desirable state (`is_https`, `has_html_doctype`)
 * and every documented one of those is mapped explicitly with `failsWhen:
 * false`. A new positive-polarity check would therefore be over-reported in
 * `other` until it is mapped — visible and wrong-in-the-safe-direction, rather
 * than invisible.
 */
export const UNMAPPED_CHECK: Omit<CheckDefinition, "category"> = {
  severity: "notice",
  label: "Unclassified check",
  failsWhen: true,
};

/** The definition for a check, or the `other` fallback. */
export function definitionFor(check: string): CheckDefinition {
  const known = CHECK_DEFINITIONS[check];
  if (known !== undefined) return known;
  return { ...UNMAPPED_CHECK, category: "other", label: check };
}

/**
 * True when this page's value for `check` means "has the problem".
 *
 * `failsWhen: null` is informational and can never fail — which is why this
 * cannot be written as `value === definition.failsWhen` alone and then
 * simplified: `null` is not a boolean, so the comparison is already false, but
 * saying so explicitly is what stops someone "tidying" the null case away.
 */
export function checkFails(
  definition: CheckDefinition,
  value: boolean,
): boolean {
  if (definition.failsWhen === null) return false;
  return value === definition.failsWhen;
}

export interface ClassificationResult {
  /** Every category, always all of them, in display order. */
  categories: AuditCategoryResult[];
  /** Affected pages per category — what the drill-down blobs hold. */
  issuePages: Map<AuditCategory, AuditIssuePage[]>;
  /** Distinct pages with at least one finding. */
  pagesWithIssues: number;
  /** (check, page) pairs. */
  totalIssues: number;
}

/**
 * Classifies a whole crawl.
 *
 * Every category is present in the output whether or not it has findings —
 * an empty category is a meaningful statement ("no redirect problems"), and a
 * fixed-length list is what lets the UI diff two audits' rollups position by
 * position for the comparison chips.
 */
export function classifyCrawl(
  pages: readonly CrawledPage[],
): ClassificationResult {
  /** category → check → pages failing it */
  const perCategoryChecks = new Map<AuditCategory, Map<string, number>>();
  /** category → the affected pages, in crawl order */
  const issuePages = new Map<AuditCategory, AuditIssuePage[]>();
  /** category → worst severity actually seen */
  const observedSeverity = new Map<AuditCategory, AuditSeverity>();

  let pagesWithIssues = 0;
  let totalIssues = 0;

  for (const page of pages) {
    // Which categories this page has trouble in, and the specific checks —
    // gathered per page so a page is counted once per category no matter how
    // many of that category's checks it fails.
    const failedByCategory = new Map<AuditCategory, string[]>();

    for (const [check, value] of Object.entries(page.checks)) {
      if (typeof value !== "boolean") continue;
      const definition = definitionFor(check);
      if (!checkFails(definition, value)) continue;

      const category = definition.category;
      const list = failedByCategory.get(category) ?? [];
      list.push(check);
      failedByCategory.set(category, list);

      const checkCounts = perCategoryChecks.get(category) ?? new Map();
      checkCounts.set(check, (checkCounts.get(check) ?? 0) + 1);
      perCategoryChecks.set(category, checkCounts);

      const previous = observedSeverity.get(category);
      observedSeverity.set(
        category,
        previous === undefined
          ? definition.severity
          : worstSeverity(previous, definition.severity),
      );

      totalIssues += 1;
    }

    if (failedByCategory.size === 0) continue;
    pagesWithIssues += 1;

    for (const [category, checks] of failedByCategory) {
      const list = issuePages.get(category) ?? [];
      list.push({
        url: page.url,
        statusCode: page.statusCode,
        checks,
        details: page.details,
      });
      issuePages.set(category, list);
    }
  }

  const categories: AuditCategoryResult[] = AUDIT_CATEGORIES.map((category) => {
    const definition = CATEGORY_DEFINITIONS[category];
    const checkCounts = perCategoryChecks.get(category) ?? new Map();

    const checks: AuditCheckCount[] = [...checkCounts.entries()]
      .map(([check, count]) => {
        const checkDefinition = definitionFor(check);
        return {
          check,
          label: checkDefinition.label,
          severity: checkDefinition.severity,
          pages: count,
        };
      })
      // Worst-first, then by name, so the order is stable between two audits
      // of the same site and the eye lands on the biggest problem.
      .sort((a, b) => b.pages - a.pages || a.check.localeCompare(b.check));

    return {
      category,
      label: definition.label,
      description: definition.description,
      /*
       * The worst severity actually observed — or `notice` when the category
       * is empty.
       *
       * Not the category's baseline: `links` has a baseline of `error`, so
       * falling back to it rendered a clean site's link row as "error, 0
       * pages" — an empty category painted red. Severity describes findings,
       * and with no findings there is nothing to be alarmed about.
       */
      severity: observedSeverity.get(category) ?? "notice",
      affectedPages: issuePages.get(category)?.length ?? 0,
      checks,
    };
  });

  return { categories, issuePages, pagesWithIssues, totalIssues };
}
