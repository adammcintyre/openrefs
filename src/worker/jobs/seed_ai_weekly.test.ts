/**
 * The weekly seed's clock.
 *
 * Pure arithmetic, tested without a database for the same reason
 * `nextDailySeedAt` is: a seed that lands on the wrong instant either runs
 * twice in a week (double spend) or not at all (a flat line in every chart),
 * and neither is visible until a week has passed.
 */
import { describe, expect, it } from "vitest";

import {
  nextWeeklySeedAt,
  WEEKLY_SEED_HOUR_UTC,
  WEEKLY_SEED_WEEKDAY_UTC,
} from "./queue";

/** 2026-08-29 is a Saturday. */
const SATURDAY = new Date("2026-08-29T12:00:00.000Z");

describe("nextWeeklySeedAt", () => {
  it("lands on Monday 04:00 UTC", () => {
    const at = nextWeeklySeedAt(SATURDAY);
    expect(at.toISOString()).toBe("2026-08-31T04:00:00.000Z");
    expect(at.getUTCDay()).toBe(WEEKLY_SEED_WEEKDAY_UTC);
    expect(at.getUTCHours()).toBe(WEEKLY_SEED_HOUR_UTC);
  });

  it("is always in the future, from any day of the week", () => {
    for (let day = 0; day < 14; day++) {
      const now = new Date(SATURDAY.getTime() + day * 86_400_000);
      const at = nextWeeklySeedAt(now);
      expect(at.getTime()).toBeGreaterThan(now.getTime());
      expect(at.getUTCDay()).toBe(WEEKLY_SEED_WEEKDAY_UTC);
      expect(at.getUTCHours()).toBe(WEEKLY_SEED_HOUR_UTC);
      // Never further out than a week and a bit.
      expect(at.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
    }
  });

  /*
   * The case that would otherwise reschedule a seed into its own slot and run
   * it again on the very next tick, once every five minutes, all Monday.
   */
  it("schedules next week when it runs at exactly its own slot", () => {
    const at = nextWeeklySeedAt(new Date("2026-08-31T04:00:00.000Z"));
    expect(at.toISOString()).toBe("2026-09-07T04:00:00.000Z");
  });

  it("takes today when it is Monday and the hour has not passed", () => {
    const at = nextWeeklySeedAt(new Date("2026-08-31T03:59:59.000Z"));
    expect(at.toISOString()).toBe("2026-08-31T04:00:00.000Z");
  });

  it("rolls over a month and a year boundary", () => {
    // 2026-12-31 is a Thursday, so the next Monday is in January.
    expect(nextWeeklySeedAt(new Date("2026-12-31T23:00:00.000Z")).toISOString()).toBe(
      "2027-01-04T04:00:00.000Z",
    );
  });

  it("does not collide with the daily rank seed's hour", () => {
    // 03:00 is seed_daily. Sharing an hour would put both recurring seeds in
    // one sweep's batch of five, every Monday.
    expect(WEEKLY_SEED_HOUR_UTC).not.toBe(3);
  });
});
