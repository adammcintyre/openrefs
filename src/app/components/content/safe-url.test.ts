import { describe, expect, it } from "vitest";

import { displayPath, safeHttpUrl } from "./safe-url";

describe("safeHttpUrl", () => {
  it("passes http and https through", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  /*
   * The whole reason this function exists. These values arrive from a scraped
   * SERP; in an href they would run script on our origin with the user's
   * session cookie attached.
   */
  it("refuses javascript:", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("JavaScript:alert(1)")).toBeNull();
  });

  it("refuses data: and other schemes that can execute or mislead", () => {
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses anything that will not parse as a URL", () => {
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl("/relative/path")).toBeNull();
  });

  it("treats empty and missing as nothing to link to", () => {
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe("displayPath", () => {
  it("drops the host, which has its own column", () => {
    expect(displayPath("https://example.com/blog/booths")).toBe("/blog/booths");
  });

  it("keeps a query string, which can be the whole identity of a page", () => {
    expect(displayPath("https://example.com/index.php?p=12")).toBe(
      "/index.php?p=12",
    );
  });

  it("shows a root as '/' rather than as nothing", () => {
    expect(displayPath("https://example.com")).toBe("/");
  });

  it("falls back to the raw string rather than rendering a blank", () => {
    expect(displayPath("not a url")).toBe("not a url");
  });
});
