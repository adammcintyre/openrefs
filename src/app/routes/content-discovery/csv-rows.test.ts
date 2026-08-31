import { describe, expect, it } from "vitest";

import type { ContentPageRow } from "../../../shared/content";
import {
  contentCsvFilename,
  contentCsvHeaders,
  contentCsvRows,
  formatKeywordList,
} from "./csv-rows";

function row(patch: Partial<ContentPageRow> = {}): ContentPageRow {
  return {
    url: "https://example.com/blog/booths",
    domain: "example.com",
    title: "Photo booth templates",
    domainScore: 18,
    pageScore: null,
    estTraffic: 940,
    keywords: [
      { keyword: "photo booth template", position: 3, volume: 1200 },
      { keyword: "booth strips", position: 11, volume: 90 },
    ],
    totalVolume: 1290,
    bestPosition: 3,
    wordCount: null,
    ...patch,
  };
}

describe("contentCsvHeaders", () => {
  it("omits Page Score when the sweep produced none", () => {
    expect(contentCsvHeaders(false)).not.toContain("Page Score");
  });

  it("includes it when it has something to say", () => {
    expect(contentCsvHeaders(true)).toContain("Page Score");
  });

  it("keeps headers and cells the same width in both shapes", () => {
    for (const available of [true, false]) {
      const cells = contentCsvRows([row()], { pageScoresAvailable: available });
      expect(cells[0]).toHaveLength(contentCsvHeaders(available).length);
    }
  });
});

describe("contentCsvRows", () => {
  it("exports raw values so a spreadsheet can do arithmetic on them", () => {
    const [cells] = contentCsvRows([row()], { pageScoresAvailable: false });
    expect(cells).toContain(940);
    expect(cells).toContain(1290);
    // Not "—": an em dash in a numeric column cannot be summed.
    expect(cells).not.toContain("—");
  });

  it("writes an unknown value as an empty cell, not a zero", () => {
    const [cells] = contentCsvRows([row({ estTraffic: null, domainScore: null })], {
      pageScoresAvailable: false,
    });
    expect(cells).toContain(null);
    expect(cells).not.toContain(0);
  });

  /*
   * bestPosition is seeded with Infinity and reduced over the keyword list, so
   * a row that somehow carries no keywords would export "Infinity" — a value no
   * spreadsheet knows what to do with.
   */
  it("exports a non-finite best position as empty", () => {
    const [cells] = contentCsvRows(
      [row({ keywords: [], bestPosition: Number.POSITIVE_INFINITY })],
      { pageScoresAvailable: false },
    );
    expect(cells).not.toContain(Number.POSITIVE_INFINITY);
  });

  it("prefers a word count bought since the sweep over the row's null", () => {
    const [cells] = contentCsvRows([row()], {
      pageScoresAvailable: false,
      wordCounts: new Map([["https://example.com/blog/booths", 1840]]),
    });
    expect(cells).toContain(1840);
  });

  it("leaves rows nobody counted empty", () => {
    const [cells] = contentCsvRows([row()], {
      pageScoresAvailable: false,
      wordCounts: new Map([["https://other.example/x", 100]]),
    });
    expect(cells).not.toContain(100);
  });
});

describe("formatKeywordList", () => {
  it("keeps positions with the keywords they belong to", () => {
    expect(formatKeywordList(row())).toBe(
      "photo booth template (3); booth strips (11)",
    );
  });

  it("separates with semicolons, since a comma is the field separator", () => {
    expect(formatKeywordList(row())).not.toContain(", ");
  });

  it("is empty for a page with no recorded keywords", () => {
    expect(formatKeywordList(row({ keywords: [] }))).toBe("");
  });
});

describe("contentCsvFilename", () => {
  const search = {
    topic: "Photo Booth Template",
    location: 2826,
    language: "en",
    expand: 5 as const,
    sort: "estTraffic" as const,
    filters: {},
  };

  it("names the topic, the expansion and the market", () => {
    expect(contentCsvFilename(search)).toBe(
      "photo-booth-template-content-discovery-expand5-2826-en.csv",
    );
  });

  it("survives a topic made entirely of punctuation", () => {
    expect(contentCsvFilename({ ...search, topic: "!!!" })).toBe(
      "topic-content-discovery-expand5-2826-en.csv",
    );
  });
});
