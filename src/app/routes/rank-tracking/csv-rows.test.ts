import { describe, expect, it } from "vitest";

import type { TrackedKeywordRow } from "../../../shared/tracking";
import {
  TRACKING_CSV_HEADERS,
  rowStatus,
  trackingCsvFilename,
  trackingCsvRows,
} from "./csv-rows";

function row(overrides: Partial<TrackedKeywordRow> = {}): TrackedKeywordRow {
  return {
    id: "id-1",
    keyword: "photo booth templates",
    device: "desktop",
    locationCode: 2826,
    languageCode: "en",
    createdAt: "2026-08-01T00:00:00.000Z",
    latest: null,
    previous: null,
    change1d: null,
    change7d: null,
    change30d: null,
    bestPosition: null,
    series: [],
    ...overrides,
  };
}

describe("rowStatus", () => {
  /*
   * The distinction the export exists to preserve: an empty position cell can
   * mean two different things, and a spreadsheet has no tooltip to explain
   * which.
   */
  it("separates the two kinds of missing position", () => {
    expect(rowStatus(row())).toBe("awaiting_first_check");
    expect(
      rowStatus(
        row({ latest: { date: "2026-08-20", position: null, url: null, serpFeatures: [] } }),
      ),
    ).toBe("not_in_top_100");
  });

  it("reports a real position as ranked", () => {
    expect(
      rowStatus(
        row({ latest: { date: "2026-08-20", position: 4, url: null, serpFeatures: [] } }),
      ),
    ).toBe("ranked");
  });
});

describe("trackingCsvRows", () => {
  it("emits one cell per header, in order", () => {
    const [cells] = trackingCsvRows([row()]);
    expect(cells).toHaveLength(TRACKING_CSV_HEADERS.length);
  });

  it("keeps positions as numbers rather than the screen's wording", () => {
    const cells = trackingCsvRows([
      row({
        latest: {
          date: "2026-08-20",
          position: 4,
          url: "https://brandpacks.com/templates",
          serpFeatures: ["organic"],
        },
        change1d: 0,
        change7d: 5,
        change30d: -2,
        bestPosition: 3,
      }),
    ])[0];

    expect(cells).toEqual([
      "photo booth templates",
      "desktop",
      2826,
      "en",
      "ranked",
      4,
      0,
      5,
      -2,
      3,
      "https://brandpacks.com/templates",
      "2026-08-20",
    ]);
  });

  it("writes empty cells for absent values, never a placeholder number", () => {
    const cells = trackingCsvRows([row()])[0] ?? [];
    // position, the three deltas, best, url and date are all unknown here.
    expect(cells.slice(5)).toEqual([null, null, null, null, null, null, null]);
  });

  it("distinguishes an unranked check from an unchecked keyword", () => {
    const unranked = trackingCsvRows([
      row({ latest: { date: "2026-08-20", position: null, url: null, serpFeatures: [] } }),
    ])[0];

    expect(unranked?.[4]).toBe("not_in_top_100");
    expect(unranked?.[5]).toBeNull();
    expect(unranked?.[11]).toBe("2026-08-20");
  });
});

describe("trackingCsvFilename", () => {
  it("slugs the domain and stamps the day", () => {
    expect(trackingCsvFilename("brandpacks.com", new Date("2026-08-29T10:00:00Z"))).toBe(
      "rank-tracking-brandpacks-com-2026-08-29",
    );
  });

  it("leaves no leading or trailing separator on an awkward domain", () => {
    expect(trackingCsvFilename(".example.co.uk.", new Date("2026-01-02T00:00:00Z"))).toBe(
      "rank-tracking-example-co-uk-2026-01-02",
    );
  });
});
