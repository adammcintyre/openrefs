import { describe, expect, it } from "vitest";

import { exactTime, relativeTime } from "./relative-time";

const NOW = new Date("2026-08-31T12:00:00Z");

/** `n` milliseconds before NOW, as an ISO string. */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("says nothing when there is nothing to say", () => {
    expect(relativeTime(null, NOW)).toBeNull();
    expect(relativeTime(undefined, NOW)).toBeNull();
    expect(relativeTime("", NOW)).toBeNull();
    expect(relativeTime("not a date", NOW)).toBeNull();
  });

  it("collapses the first minute", () => {
    expect(relativeTime(ago(0), NOW)).toBe("just now");
    expect(relativeTime(ago(59 * SECOND), NOW)).toBe("just now");
  });

  /**
   * A browser clock a few seconds ahead of the Worker is ordinary. "in 4
   * seconds" would read as a bug in the data rather than as clock skew.
   */
  it("treats a future timestamp as just now, not as an error", () => {
    expect(relativeTime(ago(-30 * SECOND), NOW)).toBe("just now");
  });

  it("steps through the units", () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe("1 minute ago");
    expect(relativeTime(ago(5 * MINUTE), NOW)).toBe("5 minutes ago");
    expect(relativeTime(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe("3 hours ago");
    expect(relativeTime(ago(DAY), NOW)).toBe("1 day ago");
    expect(relativeTime(ago(3 * DAY), NOW)).toBe("3 days ago");
    expect(relativeTime(ago(9 * DAY), NOW)).toBe("1 week ago");
    expect(relativeTime(ago(45 * DAY), NOW)).toBe("1 month ago");
    expect(relativeTime(ago(400 * DAY), NOW)).toBe("1 year ago");
  });

  it("keeps the singular for exactly one", () => {
    expect(relativeTime(ago(2 * DAY - 1), NOW)).toBe("1 day ago");
    expect(relativeTime(ago(2 * DAY), NOW)).toBe("2 days ago");
  });
});

describe("exactTime", () => {
  /**
   * Always UTC. A "fetched at" a user compares against the Worker's own logs is
   * useless if the browser has already shifted it into local time.
   */
  it("formats in UTC and says so", () => {
    expect(exactTime("2026-08-31T09:05:00Z")).toBe("31 Aug 2026, 09:05 UTC");
  });

  it("returns null for anything unusable", () => {
    expect(exactTime(null)).toBeNull();
    expect(exactTime("banana")).toBeNull();
  });
});
