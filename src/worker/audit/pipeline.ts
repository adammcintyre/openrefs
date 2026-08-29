/**
 * Ingest: crawl → audit. The one place the OnPage wire shapes, the taxonomy
 * and R2 meet.
 *
 * It runs once per audit, when the crawl reports finished, and does four
 * things in order: pull every section, store the raw pulls, classify the
 * pages, then write the rollup and the per-category drill-downs. Retrieval is
 * free (see the note at the top of dataforseo/on-page.ts), so the cost of this
 * function is subrequests and CPU, not money — which is why it pulls
 * everything in one pass rather than spreading the work over polls.
 *
 * Two things here are not obvious from the wire format:
 *
 *  - **The site itself is classified as a page.** DataForSEO report robots.txt,
 *    sitemap, SSL and the sitewide tests once per *crawl*, in
 *    `domain_info.checks`, not per page. They are folded into a synthetic page
 *    for the homepage so that "no sitemap" appears in the issues table like
 *    everything else, rather than needing a second, parallel notion of a
 *    finding.
 *  - **Core Web Vitals come from Lighthouse, not the crawl.** The crawl only
 *    measures real LCP/CLS with `enable_browser_rendering`, which costs 34×
 *    basic. So the `cwv_*` checks are derived from the homepage Lighthouse run
 *    against Google's published thresholds and attached to the same synthetic
 *    page.
 */
import type {
  AuditCategory,
  AuditCategoryResult,
  AuditIssuePage,
  AuditLighthouse,
  AuditSummary,
} from "../../shared/audits";
import type { DataForSeoApi } from "../dataforseo";
import type { OnPagePageItem, OnPageSummary } from "../dataforseo/on-page";
import {
  booleanRecord,
  ON_PAGE_MAX_SECTION_LIMIT,
} from "../dataforseo/on-page";
import type { CrawledPage } from "./ingest";
import { classifyCrawl } from "./ingest";
import { CATEGORY_DEFINITIONS } from "./taxonomy";
import type { AuditSection } from "./storage";
import { auditIssuesKey, auditSectionKey, putAuditJson } from "./storage";

/**
 * Google's "good" thresholds for the Core Web Vitals, and the lab stand-in for
 * INP.
 *
 * https://web.dev/articles/vitals (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms). Total
 * Blocking Time is used in place of INP because a Lighthouse *lab* run has no
 * INP audit — INP needs field data — and 200ms is Lighthouse's own boundary
 * between a good and a middling TBT.
 */
export const CWV_LCP_GOOD_MS = 2500;
export const CWV_CLS_GOOD = 0.1;
export const CWV_TBT_GOOD_MS = 200;

export interface IngestOptions {
  dfs: DataForSeoApi;
  bucket: R2Bucket;
  workspaceId: string;
  auditId: string;
  taskId: string;
  domain: string;
  pagesLimit: number;
  renderJs: boolean;
  crawlSummary: OnPageSummary;
  /** The homepage Lighthouse run, when it arrived. Drives the `cwv_*` checks. */
  lighthouse: AuditLighthouse | null;
}

export interface IngestResult {
  /**
   * The rollup, less the two fields the caller owns: `lighthouse` /
   * `lighthouseNote` (the job knows why Lighthouse is missing) and
   * `ingestedAt` (the job's clock, so a run is reproducible).
   */
  summary: Omit<AuditSummary, "lighthouse" | "lighthouseNote" | "ingestedAt">;
  sectionsWritten: string[];
  blobsWritten: number;
}

/**
 * Pulls, stores, classifies and rolls up one finished crawl.
 */
export async function ingestCrawl(options: IngestOptions): Promise<IngestResult> {
  const { dfs, bucket, workspaceId, auditId, taskId, crawlSummary } = options;

  const sectionsWritten: string[] = [];
  let blobsWritten = 0;

  /** Stores one section's raw response and notes it. */
  const store = async (
    section: AuditSection,
    n: number,
    raw: unknown,
  ): Promise<void> => {
    await putAuditJson(bucket, auditSectionKey(workspaceId, auditId, section, n), raw);
    sectionsWritten.push(`${section}-${n}`);
    blobsWritten += 1;
  };

  /*
   * The five sections, in one pass. `pages` is the backbone — every per-page
   * check comes from it — and the other four are pulled for the detail they
   * carry that `pages` does not (why a page is non-indexable, what a duplicate
   * group contains, where a redirect chain goes, which link is broken).
   *
   * Sequential rather than parallel: they share one Worker invocation's
   * subrequest budget, and a section that fails should not take the others'
   * responses down with it via Promise.all.
   */
  const pages = await dfs.onPage.pages(taskId, {
    limit: ON_PAGE_MAX_SECTION_LIMIT,
  });
  await store("pages", 0, pages.raw);

  const nonIndexable = await dfs.onPage.nonIndexable(taskId);
  await store("non_indexable", 0, nonIndexable.raw);

  // `type` is required and takes `duplicate_title` / `duplicate_description`,
  // so this is two calls, stored as pull 0 and pull 1 of one section.
  const duplicateTitles = await dfs.onPage.duplicateTags(
    taskId,
    "duplicate_title",
  );
  await store("duplicate_tags", 0, duplicateTitles.raw);

  const duplicateDescriptions = await dfs.onPage.duplicateTags(
    taskId,
    "duplicate_description",
  );
  await store("duplicate_tags", 1, duplicateDescriptions.raw);

  const redirectChains = await dfs.onPage.redirectChains(taskId);
  await store("redirect_chains", 0, redirectChains.raw);

  const links = await dfs.onPage.links(taskId);
  await store("links", 0, links.raw);

  /* ---------------------------------------------------------------------- */
  /* Classify                                                                */
  /* ---------------------------------------------------------------------- */

  const crawled: CrawledPage[] = [
    siteLevelPage(options),
    ...pages.items.map(toCrawledPage),
  ];

  const classified = classifyCrawl(crawled);

  // One blob per category with findings. Categories with nothing to show get
  // no blob at all — `getAuditJson` returns null and the drill-down renders an
  // empty state, which is cheaper than writing 17 empty arrays per audit.
  for (const [category, issuePages] of classified.issuePages) {
    if (issuePages.length === 0) continue;
    await putAuditJson(
      bucket,
      auditIssuesKey(workspaceId, auditId, category),
      issuePages,
    );
    blobsWritten += 1;
  }

  return {
    summary: {
      // One decimal: OnPage scores arrive with a long float tail and nobody
      // reads a health score to two decimal places.
      score:
        crawlSummary.onPageScore === null
          ? null
          : Math.round(crawlSummary.onPageScore * 10) / 10,
      pagesCrawled: crawlSummary.pagesCrawled,
      pagesLimit: crawlSummary.maxCrawlPages ?? options.pagesLimit,
      renderJs: options.renderJs,
      domain: crawlSummary.domain ?? options.domain,
      categories: classified.categories,
      pagesWithIssues: classified.pagesWithIssues,
      totalIssues: classified.totalIssues,
      brokenLinks: crawlSummary.brokenLinks,
      brokenResources: crawlSummary.brokenResources,
      nonIndexablePages: crawlSummary.nonIndexable,
      duplicateTitlePages: crawlSummary.duplicateTitle,
      duplicateDescriptionPages: crawlSummary.duplicateDescription,
      duplicateContentPages: crawlSummary.duplicateContent,
    },
    sectionsWritten,
    blobsWritten,
  };
}

/* -------------------------------------------------------------------------- */
/* Page projection                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One crawled page, reduced to checks plus the values a drill-down shows.
 *
 * The five top-level booleans are merged into the checks map here — they are
 * checks in every sense except where DataForSEO put them, and the taxonomy
 * classifies them by name like any other.
 */
export function toCrawledPage(item: OnPagePageItem): CrawledPage {
  const checks: Record<string, boolean> = booleanRecord(item.checks);

  mergeFlag(checks, "broken_links", item.broken_links);
  mergeFlag(checks, "broken_resources", item.broken_resources);
  mergeFlag(checks, "duplicate_title", item.duplicate_title);
  mergeFlag(checks, "duplicate_description", item.duplicate_description);
  mergeFlag(checks, "duplicate_content", item.duplicate_content);

  const meta = item.meta ?? null;
  const socialTags = meta?.social_media_tags ?? null;
  // Derived: there is no upstream check for social markup, so its absence is
  // the signal. Only asserted for real HTML pages — a 404 has no business
  // being told it is missing an og:title.
  if (item.resource_type === "html_page" || item.resource_type === "html") {
    checks["no_social_media_tags"] =
      socialTags === null || Object.keys(socialTags).length === 0;
  }

  const timing = item.page_timing ?? null;
  const content = meta?.content ?? null;

  return {
    url: item.url ?? "",
    statusCode: item.status_code,
    checks,
    details: {
      title: meta?.title ?? null,
      titleLength: meta?.title_length ?? null,
      description: meta?.description ?? null,
      descriptionLength: meta?.description_length ?? null,
      canonical: meta?.canonical ?? null,
      wordCount: content?.plain_text_word_count ?? null,
      readability: content?.automated_readability_index ?? null,
      loadTimeMs: timing?.duration_time ?? null,
      waitingTimeMs: timing?.waiting_time ?? null,
      sizeBytes: item.size,
      clickDepth: item.click_depth,
      internalLinks: meta?.internal_links_count ?? null,
      externalLinks: meta?.external_links_count ?? null,
      images: meta?.images_count ?? null,
      h1Count: countH1(meta?.htags ?? null),
    },
  };
}

/** Adds a top-level boolean flag to the checks map, when it is one. */
function mergeFlag(
  checks: Record<string, boolean>,
  name: string,
  value: boolean | null | undefined,
): void {
  if (typeof value === "boolean") checks[name] = value;
}

/** How many H1s the page has, for the `h1` drill-down. */
function countH1(htags: Record<string, unknown> | null): number | null {
  if (htags === null) return null;
  const h1 = htags["h1"];
  return Array.isArray(h1) ? h1.length : 0;
}

/**
 * The synthetic page carrying site-level findings.
 *
 * Its URL is the homepage because that is where a person would go to check any
 * of these, and because the Lighthouse run these CWV checks come from measured
 * exactly that URL.
 */
export function siteLevelPage(options: {
  domain: string;
  crawlSummary: OnPageSummary;
  lighthouse: AuditLighthouse | null;
}): CrawledPage {
  const { domain, crawlSummary, lighthouse } = options;
  const checks: Record<string, boolean> = { ...crawlSummary.domainChecks };

  if (lighthouse !== null) {
    if (lighthouse.lcpMs !== null) {
      checks["cwv_lcp"] = lighthouse.lcpMs > CWV_LCP_GOOD_MS;
    }
    if (lighthouse.cls !== null) {
      checks["cwv_cls"] = lighthouse.cls > CWV_CLS_GOOD;
    }
    if (lighthouse.tbtMs !== null) {
      checks["cwv_tbt"] = lighthouse.tbtMs > CWV_TBT_GOOD_MS;
    }
  }

  return {
    url: `https://${domain}/`,
    statusCode: null,
    checks,
    details: {
      scope: "site",
      crawlStopReason: crawlSummary.crawlStopReason,
      // The field that distinguishes "clean site" from "we were blocked and
      // saw nothing" — worth surfacing in the drill-down rather than only in
      // the job log.
      extendedCrawlStatus: crawlSummary.extendedCrawlStatus,
      lcpMs: lighthouse?.lcpMs ?? null,
      cls: lighthouse?.cls ?? null,
      tbtMs: lighthouse?.tbtMs ?? null,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Late Lighthouse attach                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Recomputes just the Core Web Vitals row of an already-published audit.
 *
 * Used when Lighthouse arrives after the crawl was ingested — the common case,
 * since a small crawl finishes in under a minute and their Lighthouse queue is
 * quoted at up to 45. Only this one category can change: nothing else in the
 * rollup was derived from Lighthouse, so re-pulling the crawl to recompute the
 * other sixteen would spend a subrequest budget to arrive at the same answers.
 *
 * It runs the real `classifyCrawl` over a one-page crawl rather than
 * hand-rolling the counts, so the thresholds, severity and labels come from the
 * same tested path as a first-pass ingest and cannot drift from it.
 */
export function withCoreWebVitals(
  categories: readonly AuditCategoryResult[],
  lighthouse: AuditLighthouse,
  domain: string,
): AuditCategoryResult[] {
  const recomputed = coreWebVitalsResult(lighthouse, domain);
  return categories.map((category) =>
    category.category === "core_web_vitals" ? recomputed.category : category,
  );
}

/** The Core Web Vitals category and its affected page, from Lighthouse alone. */
export function coreWebVitalsResult(
  lighthouse: AuditLighthouse,
  domain: string,
): { category: AuditCategoryResult; pages: AuditIssuePage[] } {
  const page = siteLevelPage({
    domain,
    // An empty crawl summary: this pass is only about the `cwv_*` checks, and
    // the site-level checks were already classified at ingest. Including them
    // again would double-count robots.txt and friends.
    crawlSummary: EMPTY_CRAWL_CHECKS,
    lighthouse,
  });

  const classified = classifyCrawl([page]);
  const category = classified.categories.find(
    (entry) => entry.category === "core_web_vitals",
  );

  return {
    // `classifyCrawl` always returns every category, so this is total; the
    // fallback exists only to satisfy the type.
    category: category ?? {
      category: "core_web_vitals",
      label: CATEGORY_DEFINITIONS.core_web_vitals.label,
      description: CATEGORY_DEFINITIONS.core_web_vitals.description,
      severity: CATEGORY_DEFINITIONS.core_web_vitals.baseSeverity,
      affectedPages: 0,
      checks: [],
    },
    pages: classified.issuePages.get("core_web_vitals") ?? [],
  };
}

/**
 * A crawl summary carrying no checks, for the Lighthouse-only pass above.
 * Every count is zero because nothing here is read for anything but its
 * (empty) `domainChecks`.
 */
const EMPTY_CRAWL_CHECKS: OnPageSummary = {
  finished: true,
  crawlProgress: "finished",
  crawlStopReason: null,
  pagesCrawled: 0,
  pagesInQueue: 0,
  maxCrawlPages: null,
  onPageScore: null,
  domain: null,
  extendedCrawlStatus: null,
  domainChecks: {},
  brokenLinks: 0,
  brokenResources: 0,
  nonIndexable: 0,
  duplicateTitle: 0,
  duplicateDescription: 0,
  duplicateContent: 0,
};

/** Categories, for callers that want the fixed order without importing shared. */
export type { AuditCategory };
