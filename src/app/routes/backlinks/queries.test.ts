/**
 * What the backlinks list actually asks DataForSEO for.
 *
 * Every control on that tab is a *server-side* narrowing — the sort becomes the
 * provider's `order_by`, the filters become its own conditions — so the query
 * string is where "this control spends money" is decided. These assertions are
 * how the tab's footnote stays true.
 */
import { describe, expect, it } from "vitest";

import { BACKLINKS_SPAM_HIDE_THRESHOLD } from "../../../shared/backlinks";
import { backlinksListParams } from "./queries";
import type { LinkFilters } from "./link-filters";

const TARGET = "brandpacks.com";

function params(
  over: Partial<Parameters<typeof backlinksListParams>[2]> = {},
): URLSearchParams {
  return backlinksListParams("ws-1", TARGET, {
    mode: "one_per_domain",
    filters: {},
    sort: "domain_score",
    ...over,
  });
}

describe("backlinksListParams", () => {
  it("carries the target, the mode and the page", () => {
    const query = params();
    expect(query.get("workspace")).toBe("ws-1");
    expect(query.get("target")).toBe(TARGET);
    expect(query.get("mode")).toBe("one_per_domain");
    expect(query.get("limit")).toBe("50");
    expect(query.get("offset")).toBe("0");
  });

  /** No market: none of the /backlinks endpoints accepts a location code. */
  it("sends no market", () => {
    expect(params().get("location")).toBeNull();
    expect(params().get("language")).toBeNull();
  });

  it("sends the sort upstream, whichever one is picked", () => {
    expect(params().get("sort")).toBe("domain_score");
    expect(params({ sort: "page_score" }).get("sort")).toBe("page_score");
    expect(params({ sort: "newest" }).get("sort")).toBe("newest");
    expect(params({ sort: "oldest" }).get("sort")).toBe("oldest");
  });

  it("advances the offset for a later page", () => {
    expect(params({ offset: 100 }).get("offset")).toBe("100");
  });
});

describe("the quality filters", () => {
  it("sends the spam ceiling when the toggle is on", () => {
    const filters: LinkFilters = { maxSpamScore: BACKLINKS_SPAM_HIDE_THRESHOLD };
    expect(params({ filters }).get("maxSpamScore")).toBe("30");
  });

  /**
   * Off must send nothing at all. A `maxSpamScore=100` would narrow nothing and
   * still fork the server cache into a second entry for the same rows.
   */
  it("sends nothing at all when the toggle is off", () => {
    expect(params().get("maxSpamScore")).toBeNull();
  });

  it("carries the authority and anchor filters alongside it", () => {
    const query = params({
      filters: {
        dofollow: true,
        minDomainScore: 40,
        anchor: "templates",
        maxSpamScore: BACKLINKS_SPAM_HIDE_THRESHOLD,
      },
    });
    expect(query.get("dofollow")).toBe("true");
    expect(query.get("minDomainScore")).toBe("40");
    expect(query.get("anchor")).toBe("templates");
    expect(query.get("maxSpamScore")).toBe("30");
  });

  /**
   * `dofollow=false` is a real filter upstream and returns *nofollow-only*
   * links, so "off" has to be an absent key rather than a false one.
   */
  it("never sends a false dofollow", () => {
    expect(params({ filters: {} }).get("dofollow")).toBeNull();
  });
});
