/**
 * Presentation rules for Site Audit. Pure functions, kept away from JSX so the
 * ones that are easy to render plausibly and wrongly can be pinned by tests.
 *
 * Four of them carry real risk:
 *
 * 1. **A category with no issues is not an error.** Every audit returns all 17
 *    categories whether or not anything fired, and an empty one carries
 *    severity `notice` (`AuditCategoryResult.severity` is the highest severity
 *    *observed*, and nothing observed floors at notice). Rendering the full list
 *    in one table paints a clean site with sixteen grey "notice" rows and buries
 *    the one real error. `partitionCategories` splits them so clean categories
 *    go in a collapsed list at the bottom.
 *
 * 2. **A missing previous count is not a delta of zero.** The comparison chip
 *    subtracts two rollups, but a category absent from the previous audit's
 *    `categoryCounts` means that audit predates the category — not that it found
 *    none. `categoryDelta` returns null there, and the chip is omitted rather
 *    than claiming "+4".
 *
 * 3. **Fewer issues is better.** Every delta here is down-is-good, the inverse
 *    of most metrics on the site, so −7 is green and +3 is red.
 *
 * 4. **`affectedPages` is not the sum of `checks[].pages`.** One page failing
 *    three checks in a category counts once in the first and three times in the
 *    second. Nothing here reconciles them; the table shows affected pages and
 *    the drill-down shows the checks.
 */
import type {
  AuditCategoryResult,
  AuditComparison,
  AuditLighthouse,
  AuditSeverity,
} from "../../../shared/audits";
import type { BadgeVariant } from "../ui";

export const EM_DASH = "—";
/** U+2212, not a hyphen: it aligns with the digits in a tabular-nums column. */
const MINUS = "−";

/* -------------------------------------------------------------------------- */
/* Severity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sort weight. Lower sorts first, so errors lead the table.
 *
 * A record rather than `AUDIT_SEVERITIES.indexOf` because the shared array's
 * order is a display concern there and a correctness concern here; pinning it
 * locally means a reorder upstream cannot silently re-rank the table.
 */
const SEVERITY_RANK: Record<AuditSeverity, number> = {
  error: 0,
  warning: 1,
  notice: 2,
};

export function severityRank(severity: AuditSeverity): number {
  return SEVERITY_RANK[severity];
}

export const SEVERITY_BADGE: Record<AuditSeverity, BadgeVariant> = {
  error: "danger",
  warning: "warning",
  notice: "neutral",
};

export const SEVERITY_LABEL: Record<AuditSeverity, string> = {
  error: "Error",
  warning: "Warning",
  notice: "Notice",
};

/* -------------------------------------------------------------------------- */
/* Category ordering                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The issues table's rows, worst first.
 *
 * Severity first, then affected pages — so 200 pages missing an Open Graph tag
 * never outranks three pages returning 500. Ties break on the shared array's
 * order, which `Array.prototype.sort` preserves for equal comparisons.
 */
export function sortByImpact(
  categories: ReadonlyArray<AuditCategoryResult>,
): AuditCategoryResult[] {
  return [...categories].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    return b.affectedPages - a.affectedPages;
  });
}

export interface PartitionedCategories {
  /** Categories with at least one affected page, worst first. */
  failing: AuditCategoryResult[];
  /** Categories that found nothing, in the contract's own order. */
  clean: AuditCategoryResult[];
}

/**
 * Split the 17 into "found something" and "found nothing" — see note 1.
 *
 * `clean` keeps the incoming order rather than being sorted: with every count
 * at zero there is nothing to rank by, and the fixed taxonomy order is the one
 * a returning user already knows.
 */
export function partitionCategories(
  categories: ReadonlyArray<AuditCategoryResult>,
): PartitionedCategories {
  const failing = categories.filter((category) => category.affectedPages > 0);
  const clean = categories.filter((category) => category.affectedPages === 0);
  return { failing: sortByImpact(failing), clean };
}

/* -------------------------------------------------------------------------- */
/* Comparison chips                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Change in affected pages for one category against the previous audit.
 *
 * Null when there is nothing honest to compare — no previous audit, or a
 * previous audit whose rollup does not carry this category (note 2). Positive
 * means the count went up, which for issues is worse.
 */
export function categoryDelta(
  category: AuditCategoryResult,
  previous: AuditComparison | null | undefined,
): number | null {
  if (previous === null || previous === undefined) return null;
  const before = previous.categoryCounts[category.category];
  if (typeof before !== "number" || !Number.isFinite(before)) return null;
  return category.affectedPages - before;
}

export type DeltaTone = "better" | "worse" | "flat";

/** Down-is-good throughout — see note 3. */
export function deltaTone(delta: number | null): DeltaTone {
  if (delta === null || delta === 0) return "flat";
  return delta < 0 ? "better" : "worse";
}

export const DELTA_TONE_BADGE: Record<DeltaTone, BadgeVariant> = {
  better: "success",
  worse: "danger",
  flat: "neutral",
};

/**
 * The chip's text: `+3`, `−7`, `0`. The sign is always shown so the number can
 * never be mistaken for the affected-page count next to it.
 */
export function formatDelta(delta: number | null): string {
  if (delta === null) return EM_DASH;
  if (delta === 0) return "0";
  return delta > 0 ? `+${delta}` : `${MINUS}${Math.abs(delta)}`;
}

/** What the chip means in words, for its `title` and for screen readers. */
export function deltaTitle(delta: number | null, category: string): string {
  if (delta === null) {
    return `No previous audit to compare ${category} against.`;
  }
  if (delta === 0) return `Unchanged from the previous audit.`;
  const pages = Math.abs(delta);
  const noun = `${pages} page${pages === 1 ? "" : "s"}`;
  return delta < 0
    ? `${noun} fewer than the previous audit.`
    : `${noun} more than the previous audit.`;
}

/**
 * Change in the headline score. Up-is-good here, unlike every other delta on
 * the screen — hence its own formatter rather than reusing `formatDelta`.
 */
export function scoreDelta(
  score: number | null,
  previous: AuditComparison | null | undefined,
): number | null {
  const before = previous?.score;
  if (score === null || before === null || before === undefined) return null;
  return Math.round((score - before) * 10) / 10;
}

export function formatScoreDelta(delta: number | null): string {
  if (delta === null) return EM_DASH;
  if (delta === 0) return "0";
  const magnitude = Math.abs(delta).toFixed(1).replace(/\.0$/, "");
  return delta > 0 ? `+${magnitude}` : `${MINUS}${magnitude}`;
}

/* -------------------------------------------------------------------------- */
/* Bands                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How a number reads at a glance. Deliberately the same three words for the
 * health score and every Core Web Vital, so one colour legend covers the screen.
 */
export type Band = "good" | "fair" | "poor" | "unknown";

/**
 * Colour per band, as a pair of tokens measured against each other in
 * theme.css. Never a background without its matching foreground.
 */
export const BAND_CLASS: Record<Band, string> = {
  good: "bg-success-subtle text-success-on-subtle",
  fair: "bg-warning-subtle text-warning-on-subtle",
  poor: "bg-danger-subtle text-danger-on-subtle",
  unknown: "bg-surface-muted text-muted-foreground",
};

/** Text-only variant, for a number that sits on the page background. */
export const BAND_TEXT_CLASS: Record<Band, string> = {
  good: "text-success",
  fair: "text-warning",
  poor: "text-danger",
  unknown: "text-muted-foreground",
};

/** The word itself — colour is never the only channel. */
export const BAND_LABEL: Record<Band, string> = {
  good: "Good",
  fair: "Needs work",
  poor: "Poor",
  unknown: "Not measured",
};

/**
 * Health score bands. DataForSEO's `onpage_score` is a 0–100 penalty score, and
 * a healthy site sits in the nineties — 85 is not a B, it is a site with real
 * problems — so the "good" gate is high.
 */
export function scoreBand(score: number | null | undefined): Band {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return "unknown";
  }
  if (score >= 90) return "good";
  if (score >= 70) return "fair";
  return "poor";
}

/**
 * Core Web Vitals thresholds, from web.dev's published good/needs-improvement
 * boundaries rather than invented here:
 *
 *   LCP  ≤ 2.5s good, ≤ 4.0s needs improvement
 *   CLS  ≤ 0.10 good, ≤ 0.25 needs improvement
 *   TBT  ≤ 200ms good, ≤ 600ms needs improvement (Lighthouse's lab scoring;
 *        INP's own 200ms/500ms gates do not apply to a lab proxy)
 *   Performance score ≥ 90 good, ≥ 50 needs improvement (Lighthouse's own)
 */
function bandFor(
  value: number | null | undefined,
  goodMax: number,
  fairMax: number,
): Band {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  if (value <= goodMax) return "good";
  if (value <= fairMax) return "fair";
  return "poor";
}

export function lcpBand(ms: number | null | undefined): Band {
  return bandFor(ms, 2500, 4000);
}

export function clsBand(value: number | null | undefined): Band {
  return bandFor(value, 0.1, 0.25);
}

export function tbtBand(ms: number | null | undefined): Band {
  return bandFor(ms, 200, 600);
}

/** Higher is better here, so the comparison inverts. */
export function performanceBand(score: number | null | undefined): Band {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return "unknown";
  }
  if (score >= 90) return "good";
  if (score >= 50) return "fair";
  return "poor";
}

/* -------------------------------------------------------------------------- */
/* Core Web Vitals                                                             */
/* -------------------------------------------------------------------------- */

export interface InteractionMetric {
  /** Which metric we actually have. */
  kind: "inp" | "tbt" | "none";
  label: string;
  ms: number | null;
  band: Band;
  /** Why this metric and not the other, for the tile's help text. */
  note: string;
}

/**
 * INP, or the lab stand-in for it.
 *
 * `inpMs` is null on every Lighthouse run we make: INP needs field data and a
 * lab run reports Total Blocking Time instead. Falling back is therefore the
 * normal path, not the edge case — and the tile must relabel itself when it
 * does, because presenting TBT under an "INP" heading would be presenting a
 * different measurement under a familiar name.
 */
export function interactionMetric(
  lighthouse: AuditLighthouse | null,
): InteractionMetric {
  if (lighthouse === null) {
    return { kind: "none", label: "INP", ms: null, band: "unknown", note: "" };
  }
  if (lighthouse.inpMs !== null && Number.isFinite(lighthouse.inpMs)) {
    return {
      kind: "inp",
      label: "INP",
      ms: lighthouse.inpMs,
      band: bandFor(lighthouse.inpMs, 200, 500),
      note: "Interaction to Next Paint, from field data.",
    };
  }
  return {
    kind: "tbt",
    label: "TBT (lab)",
    ms: lighthouse.tbtMs,
    band: tbtBand(lighthouse.tbtMs),
    note: "Total Blocking Time. Lighthouse's lab stand-in for INP, which needs real-user field data this run has none of.",
  };
}

/* -------------------------------------------------------------------------- */
/* Number formatting                                                           */
/* -------------------------------------------------------------------------- */

const INTEGER = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return INTEGER.format(value);
}

/** Milliseconds, switching to seconds where the number gets unwieldy. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EM_DASH;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

/** CLS is unitless and small; two decimals is the published convention. */
export function formatCls(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return value.toFixed(2);
}

/** The 0–100 health score. One decimal only when it has one. */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return EM_DASH;
  }
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** Plural-safe "N pages". */
export function pluralPages(count: number): string {
  return `${count.toLocaleString("en")} page${count === 1 ? "" : "s"}`;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * An audit timestamp.
 *
 * Unlike a rank snapshot (a day, formatted in UTC), an audit is a moment — you
 * can run three in an afternoon — so this keeps the clock time and renders in
 * the viewer's own timezone, where "14:32" means what they expect.
 */
export function formatAuditTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return EM_DASH;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return EM_DASH;
  return DATE_TIME.format(new Date(parsed));
}

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether an audit is still working.
 *
 * `pending` (posted, not yet polled) and `running` (crawling) are one state to
 * a user — "we are waiting" — and both are the condition for polling.
 */
export function isInFlight(status: string): boolean {
  return status === "pending" || status === "running";
}
