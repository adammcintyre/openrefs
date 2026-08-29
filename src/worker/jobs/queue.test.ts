import { describe, expect, it } from "vitest";

import {
  backoffMs,
  chunk,
  DAILY_SEED_HOUR_UTC,
  isExhausted,
  JOB_MAX_ATTEMPTS,
  nextDailySeedAt,
  nextRunAfterFailure,
} from "./queue";

describe("backoffMs", () => {
  it("doubles from five minutes per attempt", () => {
    // `attempts` is the post-claim value, so a first failure has attempts = 1.
    expect(backoffMs(0)).toBe(5 * 60_000);
    expect(backoffMs(1)).toBe(10 * 60_000);
    expect(backoffMs(2)).toBe(20 * 60_000);
    expect(backoffMs(3)).toBe(40 * 60_000);
    expect(backoffMs(4)).toBe(80 * 60_000);
  });

  it("never waits longer than 80 minutes, because attempts run out first", () => {
    // The ceiling is JOB_MAX_ATTEMPTS, not a clamp. If this fails, someone
    // raised the attempt limit without adding one.
    const longest = backoffMs(JOB_MAX_ATTEMPTS - 1);
    expect(longest).toBe(80 * 60_000);
  });

  it("treats a nonsense attempt count as the first one", () => {
    expect(backoffMs(-3)).toBe(5 * 60_000);
    expect(backoffMs(1.7)).toBe(backoffMs(1));
  });
});

describe("nextRunAfterFailure", () => {
  it("adds the backoff to the sweep's clock", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");
    expect(nextRunAfterFailure(now, 2).toISOString()).toBe(
      "2026-08-29T12:20:00.000Z",
    );
  });
});

describe("isExhausted", () => {
  it("fails a job at the attempt limit, not before", () => {
    expect(isExhausted(JOB_MAX_ATTEMPTS - 1)).toBe(false);
    expect(isExhausted(JOB_MAX_ATTEMPTS)).toBe(true);
    expect(isExhausted(JOB_MAX_ATTEMPTS + 1)).toBe(true);
  });
});

describe("nextDailySeedAt", () => {
  it("picks today's slot when it is still ahead", () => {
    expect(
      nextDailySeedAt(new Date("2026-08-29T02:59:59.000Z")).toISOString(),
    ).toBe("2026-08-29T03:00:00.000Z");
  });

  it("rolls to tomorrow once the slot has passed", () => {
    expect(
      nextDailySeedAt(new Date("2026-08-29T03:00:01.000Z")).toISOString(),
    ).toBe("2026-08-30T03:00:00.000Z");
  });

  it("is strictly after now, so a seed running at 03:00 schedules tomorrow", () => {
    // The re-entrancy case: not strict, and the job re-schedules its own slot
    // and runs again immediately, forever.
    expect(
      nextDailySeedAt(new Date("2026-08-29T03:00:00.000Z")).toISOString(),
    ).toBe("2026-08-30T03:00:00.000Z");
  });

  it("rolls over a month end", () => {
    expect(
      nextDailySeedAt(new Date("2026-08-31T23:00:00.000Z")).toISOString(),
    ).toBe("2026-09-01T03:00:00.000Z");
  });

  it("rolls over a year end", () => {
    expect(
      nextDailySeedAt(new Date("2026-12-31T12:00:00.000Z")).toISOString(),
    ).toBe("2027-01-01T03:00:00.000Z");
  });

  it("rolls over a leap day", () => {
    expect(
      nextDailySeedAt(new Date("2028-02-28T09:00:00.000Z")).toISOString(),
    ).toBe("2028-02-29T03:00:00.000Z");
  });

  it("always lands on the configured UTC hour", () => {
    const at = nextDailySeedAt(new Date("2026-06-15T18:22:41.123Z"));
    expect(at.getUTCHours()).toBe(DAILY_SEED_HOUR_UTC);
    expect(at.getUTCMinutes()).toBe(0);
    expect(at.getUTCSeconds()).toBe(0);
    expect(at.getUTCMilliseconds()).toBe(0);
  });
});

describe("chunk", () => {
  it("splits into runs of at most size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk when the input fits", () => {
    expect(chunk([1, 2, 3], 100)).toEqual([[1, 2, 3]]);
  });

  it("returns nothing for an empty list", () => {
    expect(chunk([], 100)).toEqual([]);
  });

  it("splits an exact multiple without a trailing empty chunk", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("batches 250 keywords into DataForSEO's 100-task calls", () => {
    const keywords = Array.from({ length: 250 }, (_, i) => i);
    const batches = chunk(keywords, 100);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    // Nothing lost, nothing duplicated — the property that matters, since a
    // dropped keyword is an invisible hole in a chart.
    expect(batches.flat()).toEqual(keywords);
  });

  it("clamps a non-positive size rather than looping forever", () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
    expect(chunk([1, 2], -5)).toEqual([[1], [2]]);
  });
});
