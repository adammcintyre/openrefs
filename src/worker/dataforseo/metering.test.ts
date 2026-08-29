import { describe, expect, it } from "vitest";

import { isOverCap, monthStartUtc } from "./metering";

describe("isOverCap", () => {
  it("blocks everything at a cap of 0, even with nothing spent", () => {
    // $0 is the "no paid calls" setting, not "unlimited".
    expect(isOverCap(0, 0)).toBe(true);
  });

  it("allows spending below the cap", () => {
    expect(isOverCap(0, 25)).toBe(false);
    expect(isOverCap(24.99, 25)).toBe(false);
  });

  it("treats reaching the cap exactly as over", () => {
    // The next call would spend past the ceiling, so the ceiling is reached.
    expect(isOverCap(25, 25)).toBe(true);
  });

  it("blocks once past the cap", () => {
    expect(isOverCap(25.01, 25)).toBe(true);
    expect(isOverCap(1000, 25)).toBe(true);
  });

  it("handles the fractional costs DataForSEO actually bills", () => {
    expect(isOverCap(0.0102, 0.02)).toBe(false);
    expect(isOverCap(0.0201, 0.02)).toBe(true);
  });

  it("blocks on a negative cap rather than treating it as headroom", () => {
    expect(isOverCap(0, -1)).toBe(true);
  });

  it("fails closed on every non-finite input", () => {
    // A cap is only honoured when it is a real, finite ceiling. Anything else
    // is a corrupt row or a future "unlimited" encoding nobody taught this
    // function about, and blocking is the cheap failure: loud, and free.
    expect(isOverCap(0, Number.NaN)).toBe(true);
    expect(isOverCap(Number.NaN, 25)).toBe(true);
    expect(isOverCap(0, Number.POSITIVE_INFINITY)).toBe(true);
    expect(isOverCap(Number.POSITIVE_INFINITY, 25)).toBe(true);
  });
});

describe("monthStartUtc", () => {
  it("returns midnight on the 1st, in UTC", () => {
    const start = monthStartUtc(new Date("2026-08-29T13:44:05.123Z"));
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("is already the boundary at the boundary", () => {
    const boundary = new Date("2026-08-01T00:00:00.000Z");
    expect(monthStartUtc(boundary).getTime()).toBe(boundary.getTime());
  });

  it("rolls into January without walking off the year", () => {
    expect(monthStartUtc(new Date("2027-01-03T00:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("uses UTC, not the host's local month", () => {
    // 23:30 on 31 Jan UTC is already February in UTC+2 — the cap must not
    // reset a day early (or late) depending on where the Worker ran.
    const lateOnTheLastDay = new Date("2026-01-31T23:30:00.000Z");
    expect(monthStartUtc(lateOnTheLastDay).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("handles a leap February", () => {
    expect(monthStartUtc(new Date("2028-02-29T12:00:00Z")).toISOString()).toBe(
      "2028-02-01T00:00:00.000Z",
    );
  });
});
