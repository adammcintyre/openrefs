import { describe, expect, it } from "vitest";

import { clampHistoryTo } from "./backlinks";

/**
 * The rule being pinned here is not in DataForSEO's documentation — it was
 * found by calling the endpoint (2026-08-29). `backlinks/history/live` rejects
 * a `date_to` of today with
 * `40501 Invalid Field: 'date_to - must be earlier than present date'`, and
 * bills for the failed task. A "last 12 months" range picker produces exactly
 * that date, so the clamp is what stands between a normal UI action and a paid
 * error.
 */
describe("clampHistoryTo", () => {
  const now = new Date("2026-08-29T09:00:00.000Z");

  it("pulls today back to yesterday", () => {
    expect(clampHistoryTo("2026-08-29", now)).toBe("2026-08-28");
  });

  it("pulls a future date back to yesterday too", () => {
    expect(clampHistoryTo("2026-12-31", now)).toBe("2026-08-28");
  });

  it("leaves a past date alone", () => {
    expect(clampHistoryTo("2026-07-31", now)).toBe("2026-07-31");
    expect(clampHistoryTo("2019-01-01", now)).toBe("2019-01-01");
  });

  it("leaves yesterday itself alone — it is the newest date they accept", () => {
    expect(clampHistoryTo("2026-08-28", now)).toBe("2026-08-28");
  });

  it("passes an absent date through so their own default applies", () => {
    expect(clampHistoryTo(undefined, now)).toBeUndefined();
  });

  it("crosses a month boundary correctly", () => {
    expect(clampHistoryTo("2026-03-01", new Date("2026-03-01T00:30:00.000Z"))).toBe(
      "2026-02-28",
    );
  });

  it("crosses a year boundary correctly", () => {
    expect(clampHistoryTo("2026-01-01", new Date("2026-01-01T12:00:00.000Z"))).toBe(
      "2025-12-31",
    );
  });
});
