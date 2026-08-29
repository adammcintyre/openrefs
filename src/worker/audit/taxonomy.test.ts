import { describe, expect, it } from "vitest";

import { AUDIT_CATEGORIES, AUDIT_SEVERITIES } from "../../shared/audits";
import type { AuditCategory } from "../../shared/audits";
import {
  CATEGORY_DEFINITIONS,
  CHECK_DEFINITIONS,
  worstSeverity,
} from "./taxonomy";

/**
 * The 61 per-page booleans DataForSEO document in `checks`, verbatim from
 * https://docs.dataforseo.com/v3/on_page/pages/ (2026-08-29).
 *
 * This list is the contract with the upstream API. If DataForSEO add a check,
 * the "maps every documented check" test below keeps passing (the new one
 * lands in `other` by design) but this constant is where a human records that
 * it was seen and decided on.
 */
const DOCUMENTED_PAGE_CHECKS = [
  "no_content_encoding",
  "high_loading_time",
  "is_redirect",
  "is_4xx_code",
  "is_5xx_code",
  "is_broken",
  "is_www",
  "is_https",
  "is_http",
  "high_waiting_time",
  "has_micromarkup",
  "has_micromarkup_errors",
  "no_doctype",
  "has_html_doctype",
  "canonical",
  "no_encoding_meta_tag",
  "no_h1_tag",
  "https_to_http_links",
  "size_greater_than_3mb",
  "meta_charset_consistency",
  "has_meta_refresh_redirect",
  "has_render_blocking_resources",
  "redirect_chain",
  "low_content_rate",
  "high_content_rate",
  "low_character_count",
  "high_character_count",
  "small_page_size",
  "large_page_size",
  "low_readability_rate",
  "irrelevant_description",
  "irrelevant_title",
  "irrelevant_meta_keywords",
  "title_too_long",
  "has_meta_title",
  "title_too_short",
  "deprecated_html_tags",
  "duplicate_meta_tags",
  "duplicate_title_tag",
  "no_image_alt",
  "no_image_title",
  "no_description",
  "no_title",
  "no_favicon",
  "seo_friendly_url",
  "flash",
  "frame",
  "lorem_ipsum",
  "has_misspelling",
  "seo_friendly_url_characters_check",
  "seo_friendly_url_dynamic_check",
  "seo_friendly_url_keywords_check",
  "seo_friendly_url_relative_length_check",
  "recursive_canonical",
  "canonical_chain",
  "canonical_to_redirect",
  "canonical_to_broken",
  "has_links_to_redirects",
  "is_orphan_page",
  "is_link_relation_conflict",
  "from_sitemap",
] as const;

/**
 * The five booleans that sit at the **top level** of a page item rather than
 * inside `checks`. Reading only `checks` loses every one of them, which is why
 * they are pinned separately.
 */
const TOP_LEVEL_PAGE_FLAGS = [
  "broken_links",
  "broken_resources",
  "duplicate_title",
  "duplicate_description",
  "duplicate_content",
] as const;

/** Site-level booleans from `domain_info.checks` that we classify. */
const SITE_LEVEL_CHECKS = [
  "sitemap",
  "robots_txt",
  "ssl",
  "http2",
  "start_page_deny_flag",
  "test_canonicalization",
  "test_www_redirect",
  "test_https_redirect",
  "test_page_not_found",
  "test_directory_browsing",
  "test_hidden_server_signature",
] as const;

/** Derived from the homepage Lighthouse run; no upstream equivalent. */
const DERIVED_CHECKS = [
  "cwv_lcp",
  "cwv_cls",
  "cwv_tbt",
  "no_social_media_tags",
] as const;

describe("category definitions", () => {
  it("defines every category exactly once, in the spec's order", () => {
    expect(Object.keys(CATEGORY_DEFINITIONS).sort()).toEqual(
      [...AUDIT_CATEGORIES].sort(),
    );
  });

  it("puts `other` last, where an unclassified bucket belongs", () => {
    expect(AUDIT_CATEGORIES.at(-1)).toBe("other");
  });

  it("gives every category a label and a user-facing description", () => {
    for (const [id, definition] of Object.entries(CATEGORY_DEFINITIONS)) {
      expect(definition.label, id).not.toBe("");
      expect(definition.description, id).not.toBe("");
      expect(AUDIT_SEVERITIES, id).toContain(definition.baseSeverity);
    }
  });
});

describe("check coverage", () => {
  it("maps every documented per-page check", () => {
    // The one test that matters most: a check DataForSEO document and we have
    // never looked at would otherwise be invisible in `other`, and an audit
    // would quietly under-report.
    const unmapped = DOCUMENTED_PAGE_CHECKS.filter(
      (check) => CHECK_DEFINITIONS[check] === undefined,
    );
    expect(unmapped).toEqual([]);
  });

  it("maps the five top-level page flags that are not inside `checks`", () => {
    const unmapped = TOP_LEVEL_PAGE_FLAGS.filter(
      (check) => CHECK_DEFINITIONS[check] === undefined,
    );
    expect(unmapped).toEqual([]);
  });

  it("maps the site-level checks from domain_info", () => {
    const unmapped = SITE_LEVEL_CHECKS.filter(
      (check) => CHECK_DEFINITIONS[check] === undefined,
    );
    expect(unmapped).toEqual([]);
  });

  it("defines the derived Core Web Vitals and social pseudo-checks", () => {
    for (const check of DERIVED_CHECKS) {
      expect(CHECK_DEFINITIONS[check], check).toBeDefined();
    }
  });

  it("has no entry that is not a real check from one of those sources", () => {
    // Stops the table growing entries for checks that do not exist — a mapping
    // for a misspelled key would never fire and never be noticed.
    const known = new Set<string>([
      ...DOCUMENTED_PAGE_CHECKS,
      ...TOP_LEVEL_PAGE_FLAGS,
      ...SITE_LEVEL_CHECKS,
      ...DERIVED_CHECKS,
    ]);
    const strays = Object.keys(CHECK_DEFINITIONS).filter(
      (check) => !known.has(check),
    );
    expect(strays).toEqual([]);
  });

  it("gives every check a valid category and severity", () => {
    for (const [check, definition] of Object.entries(CHECK_DEFINITIONS)) {
      expect(AUDIT_CATEGORIES, check).toContain(definition.category);
      expect(AUDIT_SEVERITIES, check).toContain(definition.severity);
      expect(definition.label, check).not.toBe("");
    }
  });
});

/**
 * The full mapping table, pinned.
 *
 * Every check, its category and its polarity. This is deliberately verbose:
 * the point is that re-classifying a check — or flipping a `failsWhen` and
 * turning "secure page" into an issue on every HTTPS page — cannot happen
 * without a human editing this list and saying so in a diff.
 */
describe("the mapping table", () => {
  const expected: Record<string, [AuditCategory, boolean | null]> = {
    // slow_pages
    high_loading_time: ["slow_pages", true],
    high_waiting_time: ["slow_pages", true],
    has_render_blocking_resources: ["slow_pages", true],
    http2: ["slow_pages", false],
    // core_web_vitals (derived from Lighthouse)
    cwv_lcp: ["core_web_vitals", true],
    cwv_cls: ["core_web_vitals", true],
    cwv_tbt: ["core_web_vitals", true],
    // heavy_pages
    large_page_size: ["heavy_pages", true],
    size_greater_than_3mb: ["heavy_pages", true],
    no_content_encoding: ["heavy_pages", true],
    // titles
    no_title: ["titles", true],
    title_too_long: ["titles", true],
    title_too_short: ["titles", true],
    irrelevant_title: ["titles", true],
    duplicate_title_tag: ["titles", true],
    // meta_descriptions
    no_description: ["meta_descriptions", true],
    irrelevant_description: ["meta_descriptions", true],
    // h1
    no_h1_tag: ["h1", true],
    // content
    low_character_count: ["content", true],
    high_character_count: ["content", true],
    low_content_rate: ["content", true],
    high_content_rate: ["content", true],
    low_readability_rate: ["content", true],
    small_page_size: ["content", true],
    lorem_ipsum: ["content", true],
    has_misspelling: ["content", true],
    // duplicates
    duplicate_title: ["duplicates", true],
    duplicate_description: ["duplicates", true],
    duplicate_content: ["duplicates", true],
    duplicate_meta_tags: ["duplicates", true],
    // indexability
    is_4xx_code: ["indexability", true],
    is_5xx_code: ["indexability", true],
    is_broken: ["indexability", true],
    recursive_canonical: ["indexability", true],
    canonical_to_broken: ["indexability", true],
    canonical_chain: ["indexability", true],
    canonical_to_redirect: ["indexability", true],
    is_http: ["indexability", true],
    ssl: ["indexability", false],
    start_page_deny_flag: ["indexability", true],
    test_canonicalization: ["indexability", false],
    // social_tags
    no_social_media_tags: ["social_tags", true],
    // localization
    no_encoding_meta_tag: ["localization", true],
    // Informational, not `false`: see the comment on this entry in taxonomy.ts
    // — the live crawl contradicted the natural reading of its polarity.
    meta_charset_consistency: ["localization", null],
    // links
    broken_links: ["links", true],
    broken_resources: ["links", true],
    is_orphan_page: ["links", true],
    https_to_http_links: ["links", true],
    is_link_relation_conflict: ["links", true],
    // redirects
    redirect_chain: ["redirects", true],
    has_meta_refresh_redirect: ["redirects", true],
    has_links_to_redirects: ["redirects", true],
    is_redirect: ["redirects", true],
    test_www_redirect: ["redirects", false],
    test_https_redirect: ["redirects", false],
    // images
    no_image_alt: ["images", true],
    no_image_title: ["images", true],
    // robots_sitemaps
    sitemap: ["robots_sitemaps", false],
    robots_txt: ["robots_sitemaps", false],
    // structured_data
    has_micromarkup_errors: ["structured_data", true],
    // other — deliberately classified, not unmapped
    no_doctype: ["other", true],
    no_favicon: ["other", true],
    deprecated_html_tags: ["other", true],
    flash: ["other", true],
    frame: ["other", true],
    irrelevant_meta_keywords: ["other", true],
    seo_friendly_url: ["other", false],
    seo_friendly_url_characters_check: ["other", false],
    seo_friendly_url_dynamic_check: ["other", false],
    seo_friendly_url_keywords_check: ["other", false],
    seo_friendly_url_relative_length_check: ["other", false],
    test_page_not_found: ["other", false],
    test_directory_browsing: ["other", false],
    test_hidden_server_signature: ["other", false],
    // informational — never an issue
    is_www: ["other", null],
    is_https: ["other", null],
    canonical: ["other", null],
    has_html_doctype: ["other", null],
    has_meta_title: ["other", null],
    has_micromarkup: ["other", null],
    from_sitemap: ["other", null],
  };

  it("pins every check's category and polarity", () => {
    const actual: Record<string, [AuditCategory, boolean | null]> = {};
    for (const [check, definition] of Object.entries(CHECK_DEFINITIONS)) {
      actual[check] = [definition.category, definition.failsWhen];
    }
    expect(actual).toEqual(expected);
  });

  it("pins the table's size, so an addition is a deliberate act", () => {
    expect(Object.keys(CHECK_DEFINITIONS)).toHaveLength(
      Object.keys(expected).length,
    );
  });

  it("never treats a page's good state as a finding", () => {
    // The specific regression this guards: `is_https: true` is a healthy page.
    // If its polarity were `true`, every secure page on the site would be
    // reported as an issue.
    for (const check of [
      "is_https",
      "canonical",
      "has_html_doctype",
      "has_meta_title",
      "from_sitemap",
      "is_www",
    ]) {
      expect(CHECK_DEFINITIONS[check]?.failsWhen, check).toBeNull();
    }
  });

  it("reserves `error` for things that break indexing or serving", () => {
    const errors = Object.entries(CHECK_DEFINITIONS)
      .filter(([, definition]) => definition.severity === "error")
      .map(([check]) => check)
      .sort();

    expect(errors).toEqual([
      "broken_links",
      "canonical_to_broken",
      "is_4xx_code",
      "is_5xx_code",
      "is_broken",
      "no_title",
      "recursive_canonical",
      "ssl",
      "start_page_deny_flag",
    ]);
  });
});

describe("worstSeverity", () => {
  it("ranks error above warning above notice", () => {
    expect(worstSeverity("error", "warning")).toBe("error");
    expect(worstSeverity("warning", "error")).toBe("error");
    expect(worstSeverity("warning", "notice")).toBe("warning");
    expect(worstSeverity("notice", "notice")).toBe("notice");
  });
});
