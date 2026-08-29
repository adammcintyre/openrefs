/**
 * The issue taxonomy: DataForSEO's per-page `checks` flags, mapped onto the
 * sixteen categories docs/specs/PHASE4.md fixes, plus `other`.
 *
 * This file is the whole classification layer, and it is deliberately a data
 * table rather than a pile of conditionals. Three rules govern it:
 *
 *  1. **Nothing is dropped.** A check we have not mapped lands in `other`,
 *     visibly, rather than disappearing. DataForSEO add checks; an audit that
 *     silently ignored them would still claim to be a complete picture of the
 *     site. `other` existing and being rendered is what keeps that claim
 *     honest.
 *  2. **Severity belongs to the check, not the category.** "Page returns 5xx"
 *     and "canonical points elsewhere" are both indexability, and only one of
 *     them is an emergency. A category reports the highest severity that
 *     actually fired, so an all-clear-but-one-notice category does not shout
 *     in error red.
 *  3. **A check's truthiness is not its failure.** DataForSEO's `checks` map
 *     mixes polarities: `is_https` is good when true, `no_title` is bad when
 *     true. Every entry therefore declares `failsWhen`, and reading a check
 *     without consulting it is the bug this field exists to prevent.
 *
 * taxonomy.test.ts pins the entire table — every check, its category, severity
 * and polarity — so a careless edit is a failing test rather than a silently
 * re-classified audit.
 */
import type {
  AuditCategory,
  AuditSeverity,
} from "../../shared/audits";
import { AUDIT_CATEGORIES } from "../../shared/audits";

/** One check's classification. */
export interface CheckDefinition {
  /** The category this check rolls up into. */
  category: AuditCategory;
  severity: AuditSeverity;
  /** Short human label for the drill-down and the per-check breakdown. */
  label: string;
  /**
   * The boolean value that means "this page has the problem".
   *
   * `true` for checks named after the fault (`no_title`, `is_broken`), `false`
   * for checks named after the desirable state (`is_https`, `has_html_doctype`).
   * Rule 3 above.
   *
   * **`null` means the check is informational and is never an issue.** Some of
   * DataForSEO's checks simply describe a page — `is_www`, `canonical`,
   * `from_sitemap` — and reporting "412 pages are on www" as a finding would
   * bury the real ones. They are listed explicitly rather than omitted, so the
   * table stays a complete account of the 61 checks and nothing falls into
   * `other` by neglect.
   */
  failsWhen: boolean | null;
}

/** Display metadata for a category. */
export interface CategoryDefinition {
  label: string;
  description: string;
  /**
   * Severity reported when the category has findings but none of the fired
   * checks carry a severity — in practice only reachable for `other`, whose
   * members are by definition unclassified.
   */
  baseSeverity: AuditSeverity;
}

/**
 * Labels and one-line descriptions, in `AUDIT_CATEGORIES` order.
 *
 * The descriptions are user-facing copy: they appear under each row of the
 * issues table, so they say what the category means for the site rather than
 * which upstream flags feed it.
 */
export const CATEGORY_DEFINITIONS: Record<AuditCategory, CategoryDefinition> = {
  slow_pages: {
    label: "Slow pages",
    description: "Pages that take too long to respond or finish loading.",
    baseSeverity: "warning",
  },
  core_web_vitals: {
    label: "Core Web Vitals",
    description:
      "Largest Contentful Paint, layout shift and interaction delays on the homepage.",
    baseSeverity: "warning",
  },
  heavy_pages: {
    label: "Page weight",
    description:
      "Oversized HTML, CSS and JavaScript, or assets served uncompressed or unminified.",
    baseSeverity: "warning",
  },
  titles: {
    label: "Title tags",
    description: "Missing, empty, too short, too long or duplicated <title>.",
    baseSeverity: "warning",
  },
  meta_descriptions: {
    label: "Meta descriptions",
    description: "Missing, empty or badly sized meta descriptions.",
    baseSeverity: "notice",
  },
  h1: {
    label: "H1 headings",
    description: "Pages with no H1, or with more than one.",
    baseSeverity: "notice",
  },
  content: {
    label: "Content",
    description:
      "Thin pages, low readability, and pages where content is outweighed by markup.",
    baseSeverity: "notice",
  },
  duplicates: {
    label: "Duplicate content",
    description: "Repeated titles, descriptions or page content across URLs.",
    baseSeverity: "warning",
  },
  indexability: {
    label: "Indexability",
    description:
      "Pages search engines cannot index: 4xx/5xx, noindex, and canonical problems.",
    baseSeverity: "error",
  },
  social_tags: {
    label: "Social tags",
    description: "Missing Open Graph and Twitter card markup.",
    baseSeverity: "notice",
  },
  localization: {
    label: "Localization",
    description: "Missing or inconsistent language and hreflang declarations.",
    baseSeverity: "notice",
  },
  links: {
    label: "Links",
    description: "Broken internal and external links, and orphaned pages.",
    baseSeverity: "error",
  },
  redirects: {
    label: "Redirects",
    description: "Redirect chains and loops, and meta-refresh redirects.",
    baseSeverity: "warning",
  },
  images: {
    label: "Images",
    description: "Broken images, missing alt text and oversized files.",
    baseSeverity: "warning",
  },
  robots_sitemaps: {
    label: "Robots & sitemaps",
    description: "robots.txt problems and missing or invalid sitemaps.",
    baseSeverity: "warning",
  },
  structured_data: {
    label: "Structured data",
    description: "Errors in schema.org and other micro-markup.",
    baseSeverity: "notice",
  },
  other: {
    label: "Other checks",
    description:
      "Checks that do not fit the categories above, and any the crawler has added since.",
    baseSeverity: "notice",
  },
};

/* -------------------------------------------------------------------------- */
/* The mapping table                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Every check DataForSEO documents, mapped.
 *
 * Sources, verified 2026-08-29:
 *  - the 61 per-page booleans in `checks`:
 *    https://docs.dataforseo.com/v3/on_page/pages/
 *  - the 5 top-level page booleans that are NOT in `checks` (`broken_links`,
 *    `broken_resources`, `duplicate_title`, `duplicate_description`,
 *    `duplicate_content`) — same page. Reading only `checks` loses them, so
 *    they are folded in here as checks of the same name.
 *  - the 11 site-level booleans in `domain_info.checks`:
 *    https://docs.dataforseo.com/v3/on_page/summary/
 *  - the Core Web Vitals pseudo-checks this module derives from the homepage
 *    Lighthouse run (`cwv_*`), which have no upstream equivalent — the crawl
 *    only reports real LCP/CLS with `enable_browser_rendering`, which costs
 *    34× basic.
 *
 * **Polarity of the site-level `test_*` checks is inferred, not documented.**
 * Their names read as tests that pass, so `false` is treated as the failure.
 * They are all `notice` precisely to bound the damage if that reading is
 * backwards: a wrong guess produces a quiet, visible line rather than a red
 * error on every audit. Observed live against brandpacks.com on 2026-08-29 and
 * consistent with this reading.
 */
export const CHECK_DEFINITIONS: Record<string, CheckDefinition> = {
  /* --- Speed ------------------------------------------------------------- */
  high_loading_time: {
    category: "slow_pages",
    severity: "warning",
    label: "Slow to load",
    failsWhen: true,
  },
  high_waiting_time: {
    category: "slow_pages",
    severity: "warning",
    label: "Slow server response (TTFB)",
    failsWhen: true,
  },
  has_render_blocking_resources: {
    category: "slow_pages",
    severity: "warning",
    label: "Render-blocking scripts or styles",
    failsWhen: true,
  },
  http2: {
    category: "slow_pages",
    severity: "notice",
    label: "Server does not support HTTP/2",
    failsWhen: false,
  },

  /* --- Core Web Vitals (derived from the homepage Lighthouse run) --------- */
  cwv_lcp: {
    category: "core_web_vitals",
    severity: "warning",
    label: "Largest Contentful Paint above 2.5s",
    failsWhen: true,
  },
  cwv_cls: {
    category: "core_web_vitals",
    severity: "warning",
    label: "Cumulative Layout Shift above 0.1",
    failsWhen: true,
  },
  cwv_tbt: {
    category: "core_web_vitals",
    severity: "warning",
    label: "Total Blocking Time above 200ms",
    failsWhen: true,
  },

  /* --- Page weight -------------------------------------------------------- */
  large_page_size: {
    category: "heavy_pages",
    severity: "warning",
    label: "Page larger than the size threshold",
    failsWhen: true,
  },
  size_greater_than_3mb: {
    category: "heavy_pages",
    severity: "warning",
    label: "Page larger than 3 MB",
    failsWhen: true,
  },
  no_content_encoding: {
    category: "heavy_pages",
    severity: "warning",
    label: "Served without compression",
    failsWhen: true,
  },

  /* --- Titles ------------------------------------------------------------- */
  no_title: {
    category: "titles",
    severity: "error",
    label: "Missing title",
    failsWhen: true,
  },
  title_too_long: {
    category: "titles",
    severity: "warning",
    label: "Title too long",
    failsWhen: true,
  },
  title_too_short: {
    category: "titles",
    severity: "warning",
    label: "Title too short",
    failsWhen: true,
  },
  irrelevant_title: {
    category: "titles",
    severity: "notice",
    label: "Title does not match the page content",
    failsWhen: true,
  },
  // Not cross-page duplication: this is more than one <title> element on the
  // same page. Cross-page duplicates are `duplicate_title`, below.
  duplicate_title_tag: {
    category: "titles",
    severity: "warning",
    label: "More than one title tag",
    failsWhen: true,
  },

  /* --- Meta descriptions --------------------------------------------------- */
  no_description: {
    category: "meta_descriptions",
    severity: "warning",
    label: "Missing meta description",
    failsWhen: true,
  },
  irrelevant_description: {
    category: "meta_descriptions",
    severity: "notice",
    label: "Description does not match the page content",
    failsWhen: true,
  },

  /* --- Headings ------------------------------------------------------------ */
  no_h1_tag: {
    category: "h1",
    severity: "warning",
    label: "Missing H1",
    failsWhen: true,
  },

  /* --- Content ------------------------------------------------------------- */
  low_character_count: {
    category: "content",
    severity: "warning",
    label: "Thin content",
    failsWhen: true,
  },
  high_character_count: {
    category: "content",
    severity: "notice",
    label: "Very long page",
    failsWhen: true,
  },
  low_content_rate: {
    category: "content",
    severity: "notice",
    label: "Low text-to-HTML ratio",
    failsWhen: true,
  },
  high_content_rate: {
    category: "content",
    severity: "notice",
    label: "Very high text-to-HTML ratio",
    failsWhen: true,
  },
  low_readability_rate: {
    category: "content",
    severity: "notice",
    label: "Hard to read",
    failsWhen: true,
  },
  small_page_size: {
    category: "content",
    severity: "notice",
    label: "Very small page",
    failsWhen: true,
  },
  lorem_ipsum: {
    category: "content",
    severity: "warning",
    label: "Placeholder (lorem ipsum) text",
    failsWhen: true,
  },
  has_misspelling: {
    category: "content",
    severity: "notice",
    label: "Spelling mistakes",
    failsWhen: true,
  },

  /* --- Duplicates ---------------------------------------------------------- */
  // The three below are top-level booleans on a page item, not members of
  // `checks`. See the source note above.
  duplicate_title: {
    category: "duplicates",
    severity: "warning",
    label: "Title duplicated on other pages",
    failsWhen: true,
  },
  duplicate_description: {
    category: "duplicates",
    severity: "notice",
    label: "Description duplicated on other pages",
    failsWhen: true,
  },
  duplicate_content: {
    category: "duplicates",
    severity: "warning",
    label: "Content duplicated on other pages",
    failsWhen: true,
  },
  duplicate_meta_tags: {
    category: "duplicates",
    severity: "notice",
    label: "Repeated meta tags on the page",
    failsWhen: true,
  },

  /* --- Indexability -------------------------------------------------------- */
  is_4xx_code: {
    category: "indexability",
    severity: "error",
    label: "Returns 4xx",
    failsWhen: true,
  },
  is_5xx_code: {
    category: "indexability",
    severity: "error",
    label: "Returns 5xx",
    failsWhen: true,
  },
  is_broken: {
    category: "indexability",
    severity: "error",
    label: "Broken page",
    failsWhen: true,
  },
  recursive_canonical: {
    category: "indexability",
    severity: "error",
    label: "Canonical loop",
    failsWhen: true,
  },
  canonical_to_broken: {
    category: "indexability",
    severity: "error",
    label: "Canonical points to a broken page",
    failsWhen: true,
  },
  canonical_chain: {
    category: "indexability",
    severity: "warning",
    label: "Canonical chain",
    failsWhen: true,
  },
  canonical_to_redirect: {
    category: "indexability",
    severity: "warning",
    label: "Canonical points to a redirect",
    failsWhen: true,
  },
  is_http: {
    category: "indexability",
    severity: "warning",
    label: "Served over HTTP, not HTTPS",
    failsWhen: true,
  },
  ssl: {
    category: "indexability",
    severity: "error",
    label: "No valid SSL certificate",
    failsWhen: false,
  },
  start_page_deny_flag: {
    category: "indexability",
    severity: "error",
    label: "Start page denied the crawler",
    failsWhen: true,
  },
  test_canonicalization: {
    category: "indexability",
    severity: "notice",
    label: "Canonicalization test failed",
    failsWhen: false,
  },

  /* --- Social tags ---------------------------------------------------------- */
  // DataForSEO report Open Graph and Twitter markup as `meta.social_media_tags`
  // rather than as a check, so this pseudo-check is derived from that object
  // being absent or empty.
  no_social_media_tags: {
    category: "social_tags",
    severity: "notice",
    label: "No Open Graph or Twitter card tags",
    failsWhen: true,
  },

  /* --- Localization --------------------------------------------------------- */
  no_encoding_meta_tag: {
    category: "localization",
    severity: "notice",
    label: "No character-encoding meta tag",
    failsWhen: true,
  },
  /*
   * Informational, and deliberately so — this is the one check whose polarity
   * the live proof contradicted.
   *
   * Observed 2026-08-29: brandpacks.com serves `charset=UTF-8` in both the
   * HTTP `Content-Type` header and a `<meta charset>` tag — consistent by any
   * reading — and DataForSEO reported `meta_charset_consistency: false` on all
   * 25 crawled pages. Under the natural reading ("true = consistent") that
   * would have put a warning on every page of a site with nothing wrong with
   * it, which is the single worst thing an audit can do: 25 false positives
   * drown the seven real title problems.
   *
   * One site cannot tell us whether the flag is inverted or simply stricter
   * than it sounds, and guessing a *new* polarity from one sample is no better
   * than the guess it replaces. So it is counted for nobody until someone
   * establishes what it means. `no_encoding_meta_tag` carries the localization
   * category on its own and is unambiguous.
   */
  meta_charset_consistency: {
    category: "localization",
    severity: "notice",
    label: "Character encoding declaration",
    failsWhen: null,
  },

  /* --- Links ---------------------------------------------------------------- */
  broken_links: {
    category: "links",
    severity: "error",
    label: "Links to a broken page",
    failsWhen: true,
  },
  // Broken images, scripts and stylesheets. Aggregated upstream into one
  // boolean, so it cannot be split between `images` and `links`; it lives here
  // because every one of them is a broken reference from this page.
  broken_resources: {
    category: "links",
    severity: "warning",
    label: "Broken resources (images, scripts, styles)",
    failsWhen: true,
  },
  is_orphan_page: {
    category: "links",
    severity: "notice",
    label: "Orphan page — nothing links to it",
    failsWhen: true,
  },
  https_to_http_links: {
    category: "links",
    severity: "warning",
    label: "HTTPS page links to HTTP",
    failsWhen: true,
  },
  is_link_relation_conflict: {
    category: "links",
    severity: "notice",
    label: "Conflicting link relations",
    failsWhen: true,
  },

  /* --- Redirects ------------------------------------------------------------ */
  redirect_chain: {
    category: "redirects",
    severity: "warning",
    label: "Redirect chain",
    failsWhen: true,
  },
  has_meta_refresh_redirect: {
    category: "redirects",
    severity: "warning",
    label: "Meta-refresh redirect",
    failsWhen: true,
  },
  has_links_to_redirects: {
    category: "redirects",
    severity: "notice",
    label: "Links to redirecting URLs",
    failsWhen: true,
  },
  is_redirect: {
    category: "redirects",
    severity: "notice",
    label: "Page is a redirect",
    failsWhen: true,
  },
  test_www_redirect: {
    category: "redirects",
    severity: "notice",
    label: "www redirect test failed",
    failsWhen: false,
  },
  test_https_redirect: {
    category: "redirects",
    severity: "notice",
    label: "HTTPS redirect test failed",
    failsWhen: false,
  },

  /* --- Images ---------------------------------------------------------------- */
  no_image_alt: {
    category: "images",
    severity: "warning",
    label: "Images missing alt text",
    failsWhen: true,
  },
  no_image_title: {
    category: "images",
    severity: "notice",
    label: "Images missing title attributes",
    failsWhen: true,
  },

  /* --- Robots & sitemaps ------------------------------------------------------ */
  sitemap: {
    category: "robots_sitemaps",
    severity: "warning",
    label: "No XML sitemap found",
    failsWhen: false,
  },
  robots_txt: {
    category: "robots_sitemaps",
    severity: "notice",
    label: "No robots.txt found",
    failsWhen: false,
  },

  /* --- Structured data --------------------------------------------------------- */
  has_micromarkup_errors: {
    category: "structured_data",
    severity: "warning",
    label: "Errors in structured-data markup",
    failsWhen: true,
  },

  /* --- Other (deliberately classified here, not unmapped) ----------------------- */
  no_doctype: {
    category: "other",
    severity: "notice",
    label: "Missing doctype",
    failsWhen: true,
  },
  no_favicon: {
    category: "other",
    severity: "notice",
    label: "No favicon",
    failsWhen: true,
  },
  deprecated_html_tags: {
    category: "other",
    severity: "notice",
    label: "Deprecated HTML tags",
    failsWhen: true,
  },
  flash: {
    category: "other",
    severity: "notice",
    label: "Uses Flash",
    failsWhen: true,
  },
  frame: {
    category: "other",
    severity: "notice",
    label: "Uses frames",
    failsWhen: true,
  },
  irrelevant_meta_keywords: {
    category: "other",
    severity: "notice",
    label: "Meta keywords do not match the content",
    failsWhen: true,
  },
  seo_friendly_url: {
    category: "other",
    severity: "notice",
    label: "URL is not SEO-friendly",
    failsWhen: false,
  },
  seo_friendly_url_characters_check: {
    category: "other",
    severity: "notice",
    label: "URL contains awkward characters",
    failsWhen: false,
  },
  seo_friendly_url_dynamic_check: {
    category: "other",
    severity: "notice",
    label: "URL is dynamic (query parameters)",
    failsWhen: false,
  },
  seo_friendly_url_keywords_check: {
    category: "other",
    severity: "notice",
    label: "URL contains no keywords",
    failsWhen: false,
  },
  seo_friendly_url_relative_length_check: {
    category: "other",
    severity: "notice",
    label: "URL is too long",
    failsWhen: false,
  },
  test_page_not_found: {
    category: "other",
    severity: "notice",
    label: "404 handling test failed",
    failsWhen: false,
  },
  test_directory_browsing: {
    category: "other",
    severity: "notice",
    label: "Directory browsing test failed",
    failsWhen: false,
  },
  test_hidden_server_signature: {
    category: "other",
    severity: "notice",
    label: "Server signature is exposed",
    failsWhen: false,
  },

  /* --- Informational: describe a page, never a fault ---------------------------- */
  is_www: {
    category: "other",
    severity: "notice",
    label: "Served from www",
    failsWhen: null,
  },
  is_https: {
    category: "other",
    severity: "notice",
    label: "Served over HTTPS",
    // The fault is reported by `is_http`; counting both would double-report
    // one insecure page as two findings.
    failsWhen: null,
  },
  canonical: {
    category: "other",
    severity: "notice",
    label: "Has a canonical tag",
    failsWhen: null,
  },
  has_html_doctype: {
    category: "other",
    severity: "notice",
    label: "Has an HTML doctype",
    // `no_doctype` is the fault half of this pair.
    failsWhen: null,
  },
  has_meta_title: {
    category: "other",
    severity: "notice",
    label: "Has a title tag",
    // `no_title` is the fault half of this pair.
    failsWhen: null,
  },
  has_micromarkup: {
    category: "other",
    severity: "notice",
    label: "Has structured-data markup",
    failsWhen: null,
  },
  from_sitemap: {
    category: "other",
    severity: "notice",
    label: "Listed in the sitemap",
    failsWhen: null,
  },
};

/** Severity ranking, worst first — used to pick a category's headline severity. */
const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  error: 0,
  warning: 1,
  notice: 2,
};

/** The more serious of two severities. */
export function worstSeverity(
  a: AuditSeverity,
  b: AuditSeverity,
): AuditSeverity {
  return SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b;
}

/** Every category id, in display order. Re-exported so callers need one import. */
export const CATEGORY_ORDER: readonly AuditCategory[] = AUDIT_CATEGORIES;
