/**
 * Contract for `/api/v1/projects/:id/audits` and `/api/v1/audits/:auditId` —
 * Site Audit.
 *
 * An audit is a crawl DataForSEO performs on our behalf. We orchestrate it,
 * ingest the result, and present it; the crawler is theirs. That shapes every
 * type here:
 *
 *  - **An audit is asynchronous and slow.** Creating one returns immediately
 *    with `status: "pending"` and a task id; the numbers arrive minutes later
 *    when the `audit_poll` job ingests them. The UI polls `GET /audits/:id`.
 *  - **The rollup is complete and self-contained.** Everything the audit screen
 *    renders — score, page counts, per-category issue counts, Lighthouse — is
 *    in `AuditSummary`, which is one D1 row. Only the drill-down (which pages
 *    have this issue) reads R2, and only when someone opens a category.
 *  - **Two audits' summaries are directly comparable.** The category list is
 *    fixed and always complete, every category present in both rollups whether
 *    or not it has any issues, so the UI's "+3 / −7 vs previous" chip is a
 *    subtraction over two `AuditSummary` objects and needs no extra request.
 */
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Requests                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Crawl sizes we offer. A fixed set, not a free number: crawl cost is per
 * page, and a text field is one typo away from a 100,000-page bill.
 */
export const AUDIT_CRAWL_SIZES = [25, 100, 250, 500, 1000] as const;
export type AuditCrawlSize = (typeof AUDIT_CRAWL_SIZES)[number];

export const createAuditSchema = z.object({
  maxCrawlPages: z
    .union([
      z.literal(25),
      z.literal(100),
      z.literal(250),
      z.literal(500),
      z.literal(1000),
    ])
    .optional()
    .default(25),
  /**
   * Render JavaScript before analysing each page. Materially more expensive
   * (see `AUDIT_PAGE_PRICE_*` in src/worker/dataforseo/on-page.ts) and slower,
   * but the only way to audit a site whose content is client-rendered.
   */
  renderJs: z.boolean().optional().default(false),
});
export type CreateAuditBody = z.input<typeof createAuditSchema>;

/* -------------------------------------------------------------------------- */
/* Issue taxonomy                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The fixed category ids, in display order (docs/specs/PHASE4.md).
 *
 * `other` is last and is not decorative: any DataForSEO check we have not
 * explicitly mapped lands there rather than being dropped, so a check they add
 * upstream shows up as a visible "we do not classify this yet" bucket instead
 * of silently vanishing from an audit that claims to be complete.
 */
export const AUDIT_CATEGORIES = [
  "slow_pages",
  "core_web_vitals",
  "heavy_pages",
  "titles",
  "meta_descriptions",
  "h1",
  "content",
  "duplicates",
  "indexability",
  "social_tags",
  "localization",
  "links",
  "redirects",
  "images",
  "robots_sitemaps",
  "structured_data",
  "other",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/**
 * How much an issue matters.
 *
 * `error` breaks indexing or serving, `warning` measurably hurts, `notice` is
 * worth knowing. A category reports the **highest severity actually observed**
 * among its failing checks, so a category whose only finding is a missing
 * Open Graph tag does not shout in the same colour as one with 5xx pages.
 */
export const AUDIT_SEVERITIES = ["error", "warning", "notice"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/** One DataForSEO check, as it appears in a category's breakdown. */
export interface AuditCheckCount {
  /** DataForSEO's own check key, e.g. "title_too_long". */
  check: string;
  /** Human-readable label from our mapping table. */
  label: string;
  severity: AuditSeverity;
  /** Pages failing this check. */
  pages: number;
}

/** One row of the issues table. */
export interface AuditCategoryResult {
  category: AuditCategory;
  label: string;
  /** One line explaining what this category covers. */
  description: string;
  /** Highest severity among the checks that actually fired here. */
  severity: AuditSeverity;
  /**
   * Distinct pages affected by at least one check in this category.
   *
   * **Not the sum of `checks[].pages`** — one page failing three checks in the
   * same category counts once here and three times there. The table shows this
   * number; the drill-down explains it.
   */
  affectedPages: number;
  /** Per-check breakdown, highest count first. Empty when nothing fired. */
  checks: AuditCheckCount[];
}

/* -------------------------------------------------------------------------- */
/* Lighthouse                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Lighthouse for the **homepage only** (v1) — per-page Lighthouse is priced
 * per run, so auditing every page would cost more than the crawl itself.
 *
 * Null on an audit whose Lighthouse task failed or never returned: the crawl is
 * the audit, and losing the CWV strip must not lose the other 16 categories.
 * `AuditSummary.lighthouseNote` says why when it is null.
 */
export interface AuditLighthouse {
  /** The URL actually measured. */
  url: string;
  /** Whether the run emulated a mobile device. */
  mobile: boolean;
  /** Category scores, 0–100 (Lighthouse's native 0–1 is scaled on ingest). */
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  /** Largest Contentful Paint, milliseconds. */
  lcpMs: number | null;
  /** Cumulative Layout Shift — unitless, already the real value (e.g. 0.08). */
  cls: number | null;
  /**
   * Interaction to Next Paint, milliseconds.
   *
   * Often null: INP needs field data, and a lab run reports Total Blocking
   * Time instead. `tbtMs` is the lab stand-in and is what the UI should fall
   * back to rather than showing an empty tile.
   */
  inpMs: number | null;
  /** First Contentful Paint, milliseconds. */
  fcpMs: number | null;
  /** Total Blocking Time, milliseconds. The lab proxy for INP. */
  tbtMs: number | null;
  /** Speed Index, milliseconds. */
  speedIndexMs: number | null;
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The whole audit screen in one object — this is what `audits.summary_json`
 * holds and what both the detail view and the history comparison read.
 */
export interface AuditSummary {
  /**
   * OnPage score, 0–100. DataForSEO's own `onpage_score`, rounded to one
   * decimal. Null until the crawl finishes.
   *
   * Called "Page Score" in the UI — never "Domain Authority" or any other
   * vendor's mark (CLAUDE.md hard rule #2).
   */
  score: number | null;
  /** Pages the crawler actually fetched. */
  pagesCrawled: number;
  /** Pages the crawl was allowed to fetch — the requested ceiling. */
  pagesLimit: number;
  /** Whether this crawl rendered JavaScript. */
  renderJs: boolean;
  /** The domain crawled. */
  domain: string;

  /** Every category, always all of them, in `AUDIT_CATEGORIES` order. */
  categories: AuditCategoryResult[];

  /** Distinct pages with at least one issue of any category. */
  pagesWithIssues: number;
  /** Total failing (check, page) pairs. The "issues found" headline number. */
  totalIssues: number;

  /** Homepage Lighthouse, or null — see `AuditLighthouse`. */
  lighthouse: AuditLighthouse | null;
  /** Why `lighthouse` is null, when it is. Null when Lighthouse succeeded. */
  lighthouseNote: string | null;

  /** Headline crawl counts, straight from the OnPage summary. */
  brokenLinks: number;
  brokenResources: number;
  nonIndexablePages: number;
  duplicateTitlePages: number;
  duplicateDescriptionPages: number;
  duplicateContentPages: number;

  /** ISO 8601 — when ingest completed. Null while still crawling. */
  ingestedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Responses                                                                   */
/* -------------------------------------------------------------------------- */

export const AUDIT_STATUSES = ["pending", "running", "done", "failed"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

/** A row of the audit history list. */
export interface AuditListItem {
  id: string;
  projectId: string;
  status: AuditStatus;
  /** ISO 8601. */
  createdAt: string;
  /** Null until the crawl finishes. */
  score: number | null;
  pagesCrawled: number;
  pagesLimit: number;
  renderJs: boolean;
  /** Present on a failed audit — the upstream reason, ready to display. */
  error: string | null;
}

/** GET /api/v1/projects/:id/audits?workspace=<id> */
export interface AuditListResponse {
  projectId: string;
  domain: string;
  audits: AuditListItem[];
  /** True while an audit for this project is queued or crawling. */
  auditInProgress: boolean;
}

/**
 * GET /api/v1/audits/:auditId?workspace=<id>
 *
 * `summary` is null while `status` is pending — there is nothing to show yet,
 * and an empty rollup would render as a site with a score of zero and no
 * issues, which is the opposite of the truth.
 */
export interface AuditDetailResponse {
  id: string;
  projectId: string;
  domain: string;
  status: AuditStatus;
  createdAt: string;
  summary: AuditSummary | null;
  error: string | null;
  /**
   * Crawl progress while running, so the UI can show "48 of 250 pages" rather
   * than an indeterminate spinner. Null before the first poll.
   */
  progress: AuditProgress | null;
  /** The previous finished audit's rollup, for the comparison chips. */
  previous: AuditComparison | null;
}

/** Where the crawler has got to. */
export interface AuditProgress {
  /** DataForSEO's `crawl_progress`, e.g. "in_progress" | "finished". */
  state: string;
  pagesCrawled: number;
  pagesInQueue: number;
  pagesLimit: number;
}

/**
 * Enough of the previous audit to render "+3 / −7 vs previous" per category
 * without a second request. Deliberately not the whole summary: the chips need
 * counts, not the per-check breakdown.
 */
export interface AuditComparison {
  auditId: string;
  createdAt: string;
  score: number | null;
  /** Affected-page count per category id. */
  categoryCounts: Record<string, number>;
}

/** POST /api/v1/projects/:id/audits?workspace=<id> */
export interface AuditCreatedResponse {
  audit: AuditListItem;
  /** DataForSEO's task id — exposed for support, not for the UI to display. */
  taskId: string | null;
  /**
   * What this crawl is expected to cost, USD. A hint computed from our price
   * constants; the authoritative figure is what the client meters into
   * `api_usage` when the task is posted.
   */
  estimatedCostUsd: number;
  /** The per-page price the estimate used, so the UI can explain the number. */
  costPerPageUsd: number;
  /** Pages the estimate assumed. */
  pagesLimit: number;
  /** True when JS rendering inflated the estimate. */
  renderJs: boolean;
}

/** One affected page in a category drill-down. */
export interface AuditIssuePage {
  url: string;
  /** HTTP status the crawler saw. */
  statusCode: number | null;
  /** Which of this category's checks this page fails. */
  checks: string[];
  /**
   * The specific failing values, where the section data carries them —
   * current title and its length, redirect target, response time, and so on.
   * Keys are stable per category; the UI renders whatever is present.
   */
  details: Record<string, string | number | null>;
}

/** Pages per drill-down page. */
export const AUDIT_ISSUES_PAGE_SIZE = 50;

/** GET /api/v1/audits/:auditId/issues/:category?workspace=<id>&page=<n> */
export interface AuditIssuesResponse {
  auditId: string;
  category: AuditCategory;
  label: string;
  severity: AuditSeverity;
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Total affected pages across every page of this drill-down. */
  total: number;
  pages: AuditIssuePage[];
}

/** DELETE /api/v1/audits/:auditId?workspace=<id> */
export interface AuditDeletedResponse {
  deleted: true;
  id: string;
  /** R2 objects removed with the row. Proof the blobs went too. */
  blobsDeleted: number;
}
