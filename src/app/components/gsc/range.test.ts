import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GSC_DATA_LAG_DAYS, GSC_DEFAULT_RANGE_DAYS } from "../../../shared/gsc";
import {
  DEFAULT_GSC_RANGE,
  GSC_RANGE_PRESETS,
  clientFreshTo,
  gscRangePreset,
  gscRangeQuery,
  gscRangeRequest,
  isGscRangeId,
  parseStoredGscRange,
  readLastGscRange,
  writeLastGscRange,
} from "./range";

/** A fixed "now" so the arithmetic is checkable by hand. */
const NOW = new Date("2026-08-29T11:30:00Z");

describe("presets", () => {
  it("offers 28 days, 3 months and 6 months, defaulting to 28 days", () => {
    expect(GSC_RANGE_PRESETS.map((preset) => preset.id)).toEqual([
      "28d",
      "3m",
      "6m",
    ]);
    expect(DEFAULT_GSC_RANGE).toBe("28d");
  });

  it("matches the server's own default window length", () => {
    expect(gscRangePreset("28d").days).toBe(GSC_DEFAULT_RANGE_DAYS);
  });

  it("validates preset ids", () => {
    expect(isGscRangeId("3m")).toBe(true);
    expect(isGscRangeId("12m")).toBe(false);
    expect(isGscRangeId(null)).toBe(false);
    expect(isGscRangeId(28)).toBe(false);
  });
});

describe("clientFreshTo", () => {
  it("backs off the documented data lag, in UTC", () => {
    expect(clientFreshTo(NOW)).toBe("2026-08-27");
    expect(GSC_DATA_LAG_DAYS).toBe(2);
  });

  /*
   * A late-evening UTC time and an early-morning one must land on the same
   * finalised day: the lag is in days, and reading the clock in local time
   * would move the window for anyone west of Greenwich.
   */
  it("does not drift with the time of day", () => {
    expect(clientFreshTo(new Date("2026-08-29T00:00:01Z"))).toBe("2026-08-27");
    expect(clientFreshTo(new Date("2026-08-29T23:59:59Z"))).toBe("2026-08-27");
  });

  it("crosses a month boundary correctly", () => {
    expect(clientFreshTo(new Date("2026-09-01T09:00:00Z"))).toBe("2026-08-30");
  });
});

describe("gscRangeRequest", () => {
  /*
   * The default sends nothing at all: "the last 28 complete days" is already
   * the server's default, and the server's clock is the one that decides what
   * counts as complete.
   */
  it("sends no dates for the default preset", () => {
    expect(gscRangeRequest("28d", NOW)).toEqual({});
    expect(gscRangeQuery("28d", NOW)).toBe("");
  });

  /*
   * `to` is never sent. A browser clock running slow could only ever end the
   * window early, silently dropping the most recent day — the exact failure
   * the data-lag clamp exists to prevent.
   */
  it("sends only a start date, never an end date", () => {
    const request = gscRangeRequest("3m", NOW);
    expect(request.from).toBeDefined();
    expect(Object.keys(request)).toEqual(["from"]);
  });

  it("counts 90 days inclusively back from the finalised day", () => {
    // 2026-08-27 inclusive, 90 days: 27 Aug back to 30 May.
    expect(gscRangeRequest("3m", NOW)).toEqual({ from: "2026-05-30" });
  });

  // 2026 is not a leap year, so 180 days inclusive back from 27 Aug is 1 Mar.
  it("counts 180 days inclusively for six months", () => {
    expect(gscRangeRequest("6m", NOW)).toEqual({ from: "2026-03-01" });
  });

  it("builds an escaped query fragment", () => {
    expect(gscRangeQuery("3m", NOW)).toBe("&from=2026-05-30");
  });

  it("produces a window of exactly the advertised length", () => {
    for (const preset of GSC_RANGE_PRESETS) {
      if (preset.id === DEFAULT_GSC_RANGE) continue;
      const { from } = gscRangeRequest(preset.id, NOW);
      const start = new Date(`${from ?? ""}T00:00:00Z`).getTime();
      const end = new Date(`${clientFreshTo(NOW)}T00:00:00Z`).getTime();
      const days = (end - start) / 86_400_000 + 1;
      expect(days).toBe(preset.days);
    }
  });
});

describe("persistence", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a choice", () => {
    writeLastGscRange("proj-1", "6m");
    expect(readLastGscRange("proj-1")).toBe("6m");
  });

  /*
   * Per project, not per workspace: a six-year-old site and one launched last
   * month do not want the same window, and they often live side by side.
   */
  it("keeps each project's choice separate", () => {
    writeLastGscRange("proj-1", "6m");
    writeLastGscRange("proj-2", "3m");
    expect(readLastGscRange("proj-1")).toBe("6m");
    expect(readLastGscRange("proj-2")).toBe("3m");
  });

  it("has no opinion about a project that was never stored", () => {
    expect(readLastGscRange("proj-unknown")).toBeNull();
  });

  it("ignores a null or empty project id in both directions", () => {
    writeLastGscRange(null, "6m");
    writeLastGscRange("", "6m");
    expect(readLastGscRange(null)).toBeNull();
    expect(readLastGscRange("")).toBeNull();
    expect(store.size).toBe(0);
  });

  /*
   * A value written by an older build must fall back to the default rather
   * than reaching a request as an unrecognised range.
   */
  it("rejects a stored value it does not recognise", () => {
    expect(parseStoredGscRange("12m")).toBeNull();
    expect(parseStoredGscRange("")).toBeNull();
    expect(parseStoredGscRange(null)).toBeNull();
    expect(parseStoredGscRange("6m")).toBe("6m");

    store.set("openrefs.searchConsole.range:proj-1", "everything");
    expect(readLastGscRange("proj-1")).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readLastGscRange("proj-1")).toBeNull();
    expect(() => writeLastGscRange("proj-1", "3m")).not.toThrow();
  });
});
