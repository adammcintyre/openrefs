import { describe, expect, it } from "vitest";

import type { AuditIssuePage } from "../../../shared/audits";
import { toCsv } from "../../lib/csv";
import {
  auditIssuesCsvFilename,
  auditIssuesCsvHeaders,
  auditIssuesCsvRows,
  detailKeys,
  humanizeDetailKey,
} from "./csv-rows";

function page(patch: Partial<AuditIssuePage>): AuditIssuePage {
  return {
    url: "https://example.com/",
    statusCode: 200,
    checks: [],
    details: {},
    ...patch,
  };
}

describe("detailKeys", () => {
  it("collects every key across the rows, in first-seen order", () => {
    const keys = detailKeys([
      page({ details: { title: "A", title_length: 12 } }),
      page({ details: { title: "B", canonical: "/b" } }),
    ]);
    expect(keys).toEqual(["title", "title_length", "canonical"]);
  });

  it("is empty when no row carries details", () => {
    expect(detailKeys([page({}), page({})])).toEqual([]);
  });
});

describe("humanizeDetailKey", () => {
  it("turns a snake_case key into a header", () => {
    expect(humanizeDetailKey("redirect_target")).toBe("Redirect target");
    expect(humanizeDetailKey("title")).toBe("Title");
  });

  it("leaves an unrecognisable key alone rather than blanking the column", () => {
    expect(humanizeDetailKey("_")).toBe("_");
  });
});

describe("auditIssuesCsvRows", () => {
  /**
   * The alignment case: row two has no `title_length`, so its cell must be
   * empty rather than shifting `canonical` into the wrong column.
   */
  it("keeps ragged detail objects aligned to the header", () => {
    const rows = [
      page({
        url: "https://example.com/a",
        details: { title: "A", title_length: 90 },
      }),
      page({ url: "https://example.com/b", details: { canonical: "/b" } }),
    ];

    expect(auditIssuesCsvHeaders(rows)).toEqual([
      "URL",
      "Status code",
      "Failing checks",
      "Title",
      "Title length",
      "Canonical",
    ]);
    expect(auditIssuesCsvRows(rows)).toEqual([
      ["https://example.com/a", 200, "", "A", 90, null],
      ["https://example.com/b", 200, "", null, null, "/b"],
    ]);
  });

  it("joins failing checks with spaces, not commas", () => {
    // A comma would be quoted by the writer and read back as one field.
    const [row] = auditIssuesCsvRows([
      page({ checks: ["title_too_long", "title_duplicate"] }),
    ]);
    expect(row?.[2]).toBe("title_too_long title_duplicate");
  });

  it("passes a null status code through as an empty cell", () => {
    const [row] = auditIssuesCsvRows([page({ statusCode: null })]);
    expect(row?.[1]).toBeNull();
  });

  it("survives the round trip through the CSV writer", () => {
    const rows = [
      page({
        url: "https://example.com/x",
        details: { title: 'He said "hi", loudly' },
      }),
    ];
    const csv = toCsv(auditIssuesCsvHeaders(rows), auditIssuesCsvRows(rows));
    expect(csv).toContain('"He said ""hi"", loudly"');
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("auditIssuesCsvFilename", () => {
  it("slugs the domain and dates the file", () => {
    const name = auditIssuesCsvFilename("brandpacks.com", "titles");
    expect(name).toMatch(/^brandpacks-com-titles-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
