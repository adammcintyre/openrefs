import { describe, expect, it } from "vitest";

import { formatPageRange, pageRange } from "./pagination";

describe("pageRange", () => {
  it("numbers the first page from 1", () => {
    expect(pageRange(0, 25, 320)).toEqual({
      from: 1,
      to: 25,
      total: 320,
      pageCount: 13,
    });
  });

  it("offsets later pages by whole pages", () => {
    expect(pageRange(2, 25, 320)).toMatchObject({ from: 51, to: 75 });
  });

  it("stops the last page at the real row count", () => {
    // 320 rows / 25 = 13 pages; the 13th holds only 20.
    expect(pageRange(12, 25, 320)).toMatchObject({ from: 301, to: 320 });
  });

  it("reports zeros for an empty table rather than 1-0", () => {
    expect(pageRange(0, 25, 0)).toEqual({
      from: 0,
      to: 0,
      total: 0,
      pageCount: 0,
    });
  });

  it("clamps a page index left over from a larger result set", () => {
    // Filters cut 320 rows to 10; the stale index 12 must fall back to page 1.
    expect(pageRange(12, 25, 10)).toMatchObject({
      from: 1,
      to: 10,
      pageCount: 1,
    });
  });

  it("handles a single row", () => {
    expect(pageRange(0, 25, 1)).toMatchObject({
      from: 1,
      to: 1,
      pageCount: 1,
    });
  });

  it("handles an exactly-full final page", () => {
    expect(pageRange(1, 10, 20)).toMatchObject({
      from: 11,
      to: 20,
      pageCount: 2,
    });
  });

  it("survives nonsense input without dividing by zero", () => {
    expect(pageRange(-5, 0, -3)).toEqual({
      from: 0,
      to: 0,
      total: 0,
      pageCount: 0,
    });
    expect(pageRange(0, 0, 5)).toMatchObject({ pageCount: 5, from: 1, to: 1 });
  });
});

describe("formatPageRange", () => {
  it("reads as a range", () => {
    expect(formatPageRange(pageRange(0, 25, 320))).toBe("1–25 of 320");
  });

  it("says so when there is nothing to page through", () => {
    expect(formatPageRange(pageRange(0, 25, 0))).toBe("No rows");
  });
});
