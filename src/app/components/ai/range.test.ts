import { describe, expect, it } from "vitest";

import {
  DEFAULT_WINDOW,
  RESULT_WINDOWS,
  isResultWindowId,
  toIsoDay,
  windowRange,
} from "./range";

describe("windowRange", () => {
  it("ends today and counts back inclusively", () => {
    // 7 days ending 2026-08-29 is the 23rd through the 29th, not the 22nd.
    expect(windowRange("7", new Date("2026-08-29T12:00:00Z"))).toEqual({
      from: "2026-08-23",
      to: "2026-08-29",
    });
  });

  it("spans months and years correctly", () => {
    expect(windowRange("30", new Date("2026-01-05T00:00:00Z"))).toEqual({
      from: "2025-12-07",
      to: "2026-01-05",
    });
  });

  it("covers 90 days by default window", () => {
    const { from, to } = windowRange("90", new Date("2026-08-29T00:00:00Z"));
    expect(to).toBe("2026-08-29");
    expect(from).toBe("2026-06-01");
  });

  /*
   * The bug this guards. Snapshots are UTC days; deriving the range from local
   * time would, west of UTC, end the window yesterday and hide a run that
   * happened this morning.
   */
  it("uses UTC days, not the viewer's timezone", () => {
    // 23:30 UTC on the 29th is still the 29th, even where it is already the
    // 30th locally — and 00:30 UTC is the 30th even where it is still the 29th.
    expect(windowRange("7", new Date("2026-08-29T23:30:00Z")).to).toBe(
      "2026-08-29",
    );
    expect(windowRange("7", new Date("2026-08-30T00:30:00Z")).to).toBe(
      "2026-08-30",
    );
  });

  it("falls back to 90 days for an unknown window", () => {
    const { from, to } = windowRange(
      "nonsense" as never,
      new Date("2026-08-29T00:00:00Z"),
    );
    expect(to).toBe("2026-08-29");
    expect(from).toBe("2026-06-01");
  });
});

describe("toIsoDay", () => {
  it("formats as YYYY-MM-DD in UTC", () => {
    expect(toIsoDay(new Date("2026-08-29T23:59:59Z"))).toBe("2026-08-29");
  });
});

describe("isResultWindowId", () => {
  it("accepts the offered windows and nothing else", () => {
    for (const window of RESULT_WINDOWS) {
      expect(isResultWindowId(window.id)).toBe(true);
    }
    expect(isResultWindowId("365")).toBe(false);
    expect(isResultWindowId(null)).toBe(false);
    expect(isResultWindowId(7)).toBe(false);
  });

  it("has a default that is one of the offered windows", () => {
    expect(isResultWindowId(DEFAULT_WINDOW)).toBe(true);
  });
});
