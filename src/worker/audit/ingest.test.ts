import { describe, expect, it } from "vitest";

import { AUDIT_CATEGORIES } from "../../shared/audits";
import type { CrawledPage } from "./ingest";
import { checkFails, classifyCrawl, definitionFor } from "./ingest";

/**
 * Fixtures use real DataForSEO check names, but the point of these tests is
 * the *counting rules*, not the mapping table — taxonomy.test.ts pins that.
 */
function page(
  url: string,
  checks: Record<string, boolean>,
  statusCode: number | null = 200,
): CrawledPage {
  return { url, statusCode, checks, details: {} };
}

describe("definitionFor", () => {
  it("routes an unknown check to the visible `other` bucket", () => {
    // The property that keeps an audit honest when DataForSEO add a check:
    // unclassified, but never invisible.
    const definition = definitionFor("some_check_invented_next_year");
    expect(definition.category).toBe("other");
    expect(definition.severity).toBe("notice");
    // Labelled with the raw key, so a human can see what turned up.
    expect(definition.label).toBe("some_check_invented_next_year");
  });

  it("counts an unmapped check only when it is true", () => {
    const definition = definitionFor("some_check_invented_next_year");
    expect(checkFails(definition, true)).toBe(true);
    expect(checkFails(definition, false)).toBe(false);
  });
});

describe("classifyCrawl", () => {
  it("always reports every category, findings or not", () => {
    // A fixed-length list is what lets the UI diff two audits position by
    // position for the comparison chips.
    const result = classifyCrawl([page("https://x.test/", {})]);
    expect(result.categories.map((c) => c.category)).toEqual([
      ...AUDIT_CATEGORIES,
    ]);
  });

  it("counts a page once per category however many of its checks fail", () => {
    // One page, three title problems. The table says "1 page", the breakdown
    // says which three checks — summing the breakdown would say 3 and be wrong.
    const result = classifyCrawl([
      page("https://x.test/a", {
        no_title: true,
        title_too_long: true,
        title_too_short: true,
      }),
    ]);

    const titles = result.categories.find((c) => c.category === "titles");
    expect(titles?.affectedPages).toBe(1);
    expect(titles?.checks.reduce((sum, c) => sum + c.pages, 0)).toBe(3);
    expect(result.pagesWithIssues).toBe(1);
    expect(result.totalIssues).toBe(3);
  });

  it("counts distinct pages per category across the crawl", () => {
    const result = classifyCrawl([
      page("https://x.test/a", { no_title: true }),
      page("https://x.test/b", { no_title: true }),
      page("https://x.test/c", { no_description: true }),
    ]);

    const titles = result.categories.find((c) => c.category === "titles");
    expect(titles?.affectedPages).toBe(2);
    expect(result.pagesWithIssues).toBe(3);
  });

  it("ignores a passing check", () => {
    const result = classifyCrawl([
      page("https://x.test/a", { no_title: false, title_too_long: false }),
    ]);
    expect(result.totalIssues).toBe(0);
    expect(result.pagesWithIssues).toBe(0);
    expect(result.categories.every((c) => c.affectedPages === 0)).toBe(true);
  });

  it("honours reversed polarity — a positive check fails when false", () => {
    // `meta_charset_consistency` is good when true. Treating every check as
    // "true is bad" would report every correctly-encoded page as an issue.
    const consistent = classifyCrawl([
      page("https://x.test/a", { meta_charset_consistency: true }),
    ]);
    expect(consistent.totalIssues).toBe(0);

    const inconsistent = classifyCrawl([
      page("https://x.test/a", { meta_charset_consistency: false }),
    ]);
    expect(inconsistent.totalIssues).toBe(1);
  });

  it("never counts an informational check, either way round", () => {
    // `is_https` describes a page rather than faulting it — the insecure case
    // is reported by `is_http`, so counting both would double-report one page.
    // A regression here would put "412 pages are on HTTPS" in the issues table.
    expect(
      classifyCrawl([page("https://x.test/a", { is_https: true })]).totalIssues,
    ).toBe(0);
    expect(
      classifyCrawl([page("http://x.test/a", { is_https: false })]).totalIssues,
    ).toBe(0);
    // The fault half of the pair still fires.
    expect(
      classifyCrawl([page("http://x.test/a", { is_http: true })]).totalIssues,
    ).toBe(1);
  });

  it("reports the worst severity actually observed, not the category default", () => {
    // Indexability's baseline is `error`, but a lone canonical notice must not
    // be painted as an emergency.
    const result = classifyCrawl([
      page("https://x.test/a", { canonical_to_redirect: true }),
    ]);
    const indexability = result.categories.find(
      (c) => c.category === "indexability",
    );
    expect(indexability?.affectedPages).toBe(1);
    expect(indexability?.severity).not.toBe("error");
  });

  it("escalates a category to its worst finding", () => {
    const result = classifyCrawl([
      page("https://x.test/a", { canonical_to_redirect: true }),
      page("https://x.test/b", { is_4xx_code: true }, 404),
    ]);
    const indexability = result.categories.find(
      (c) => c.category === "indexability",
    );
    expect(indexability?.severity).toBe("error");
  });

  it("orders a category's checks worst-count first, then by name", () => {
    const result = classifyCrawl([
      page("https://x.test/a", { no_title: true, title_too_long: true }),
      page("https://x.test/b", { title_too_long: true }),
    ]);
    const titles = result.categories.find((c) => c.category === "titles");
    expect(titles?.checks.map((c) => c.check)).toEqual([
      "title_too_long",
      "no_title",
    ]);
  });

  it("keeps the affected pages per category for the drill-down", () => {
    const result = classifyCrawl([
      page("https://x.test/a", { no_title: true }),
      page("https://x.test/b", { no_description: true }),
    ]);

    expect(result.issuePages.get("titles")?.map((p) => p.url)).toEqual([
      "https://x.test/a",
    ]);
    expect(
      result.issuePages.get("meta_descriptions")?.map((p) => p.url),
    ).toEqual(["https://x.test/b"]);
  });

  it("records which checks a page failed, for the drill-down table", () => {
    const result = classifyCrawl([
      page("https://x.test/a", { no_title: true, title_too_long: true }),
    ]);
    expect(result.issuePages.get("titles")?.[0]?.checks).toEqual([
      "no_title",
      "title_too_long",
    ]);
  });

  it("handles an empty crawl without inventing findings", () => {
    const result = classifyCrawl([]);
    expect(result.totalIssues).toBe(0);
    expect(result.pagesWithIssues).toBe(0);
    expect(result.categories).toHaveLength(AUDIT_CATEGORIES.length);
  });

  it("skips non-boolean values rather than guessing at them", () => {
    const malformed = {
      url: "https://x.test/a",
      statusCode: 200,
      checks: { no_title: null as unknown as boolean },
      details: {},
    };
    expect(classifyCrawl([malformed]).totalIssues).toBe(0);
  });
});
