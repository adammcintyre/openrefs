/**
 * The module's billing invariants, asserted as request URLs.
 *
 * Keyword Research spends the user's own DataForSEO balance, so "what did that
 * click cost?" has to be answerable from the code rather than from a bill.
 * These tests pin the three rules the Phase 9 cache work rests on:
 *
 * 1. Mounting a tab, switching tabs and reopening a search send no `fresh`.
 * 2. A tab reopened from the history trail sends `stale=true`, which the Worker
 *    answers from its stored copy for $0.
 * 3. Refresh — the only deliberate spend — sends `fresh=true` exactly once per
 *    request it makes, and makes exactly two.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { KeywordListResponse, KeywordOverviewResponse } from "../../../shared/keywords";
import {
  PAGE_SIZE,
  keywordKeys,
  keywordListPath,
  keywordOverviewPath,
  keywordRefreshPaths,
  refreshKeywordSearch,
} from "./queries";
import type { MarketSelection } from "./market";

const WORKSPACE = "ws-1";
const KEYWORD = "photo booth templates";
const UK: MarketSelection = { locationCode: 2826, languageCode: "en" };

/** The query half of a path, as something assertable. */
const params = (path: string) =>
  new URLSearchParams(path.slice(path.indexOf("?") + 1));

describe("keywordOverviewPath", () => {
  it("carries the workspace, keyword and market", () => {
    const query = params(keywordOverviewPath(WORKSPACE, KEYWORD, UK));
    expect(query.get("workspace")).toBe(WORKSPACE);
    expect(query.get("keyword")).toBe(KEYWORD);
    expect(query.get("location")).toBe("2826");
    expect(query.get("language")).toBe("en");
  });

  // Invariant 1: a mount is not a purchase decision.
  it("asks for neither a fresh nor a stale copy by default", () => {
    const query = params(keywordOverviewPath(WORKSPACE, KEYWORD, UK, "auto"));
    expect(query.has("fresh")).toBe(false);
    expect(query.has("stale")).toBe(false);
  });

  // Invariant 2: reopening a past search is free, and never accidentally both.
  it("asks for the stored copy in stale mode, and never for a fresh one", () => {
    const query = params(keywordOverviewPath(WORKSPACE, KEYWORD, UK, "stale"));
    expect(query.get("stale")).toBe("true");
    expect(query.has("fresh")).toBe(false);
  });

  it("tolerates a workspace that has not resolved yet", () => {
    expect(params(keywordOverviewPath(null, KEYWORD, UK)).get("workspace")).toBe("");
  });
});

describe("keywordListPath", () => {
  it("pages the tab it was asked for", () => {
    const path = keywordListPath(WORKSPACE, "suggestions", KEYWORD, UK, 100);
    expect(path.startsWith("/keywords/suggestions?")).toBe(true);
    expect(params(path).get("offset")).toBe("100");
    expect(params(path).get("limit")).toBe(String(PAGE_SIZE));
  });

  /*
   * Switching between Suggestions, Related and Ideas mounts a new panel and so
   * makes a new request. It must still be an ordinary one: the tab switch is
   * what authorises the spend, and `fresh` would double it.
   */
  it.each(["suggestions", "related", "ideas"] as const)(
    "sends no fresh flag when the %s tab mounts",
    (tab) => {
      const query = params(keywordListPath(WORKSPACE, tab, KEYWORD, UK, 0));
      expect(query.has("fresh")).toBe(false);
      expect(query.has("stale")).toBe(false);
    },
  );

  it("carries stale through to Load more, so a reopened tab stays free", () => {
    const query = params(
      keywordListPath(WORKSPACE, "related", KEYWORD, UK, PAGE_SIZE, "stale"),
    );
    expect(query.get("stale")).toBe("true");
    expect(query.has("fresh")).toBe(false);
  });
});

describe("query keys", () => {
  /*
   * The rule that keeps a mode change free: `cacheMode` is a queryFn argument,
   * so the same search has one cache entry whatever mode it is in. Adding a
   * mode parameter to a key builder would silently give it two — and TanStack
   * would fetch the second one.
   */
  it("do not take the cache mode", () => {
    expect(keywordKeys.overview.length).toBe(3);
    expect(keywordKeys.list.length).toBe(4);
  });

  it("name the search alone", () => {
    expect(keywordKeys.overview(WORKSPACE, KEYWORD, UK)).toEqual([
      "keywords",
      "overview",
      WORKSPACE,
      KEYWORD,
      2826,
      "en",
    ]);
  });
});

describe("keywordRefreshPaths", () => {
  const paths = keywordRefreshPaths(WORKSPACE, KEYWORD, UK, "related");

  it("bills the overview once", () => {
    expect(paths.overview.startsWith("/keywords/overview?")).toBe(true);
    expect(params(paths.overview).get("fresh")).toBe("true");
  });

  it("bills the active tab's first page once, and only the first", () => {
    expect(paths.list.startsWith("/keywords/related?")).toBe(true);
    expect(params(paths.list).get("fresh")).toBe("true");
    expect(params(paths.list).get("offset")).toBe("0");
  });

  // `fresh` + `stale` together is a 422 upstream; they can never be sent as a
  // pair because they are built on separate code paths.
  it("never asks for fresh and stale at once", () => {
    expect(params(paths.overview).has("stale")).toBe(false);
    expect(params(paths.list).has("stale")).toBe(false);
  });

  it("refreshes the tab the user is looking at, not a fixed one", () => {
    expect(
      keywordRefreshPaths(WORKSPACE, KEYWORD, UK, "ideas").list.startsWith(
        "/keywords/ideas?",
      ),
    ).toBe(true);
  });
});

describe("refreshKeywordSearch", () => {
  const overview = { costUsd: 0.114, cached: false } as KeywordOverviewResponse;
  const list = { costUsd: 0.011, cached: false } as KeywordListResponse;

  /** Records every URL fetched and answers with the two payloads above. */
  function mockFetch(): string[] {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        seen.push(input);
        const body = input.includes("/keywords/overview") ? overview : list;
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );
    return seen;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes exactly two requests for one press", async () => {
    const seen = mockFetch();
    await refreshKeywordSearch(WORKSPACE, KEYWORD, UK, "suggestions");
    expect(seen).toHaveLength(2);
  });

  /*
   * The invariant in its strongest form: count the `fresh=true` flags that
   * actually left the browser. One per request, two in total, and nothing else
   * on the screen adds a third.
   */
  it("sends fresh=true exactly once per request it makes", async () => {
    const seen = mockFetch();
    await refreshKeywordSearch(WORKSPACE, KEYWORD, UK, "suggestions");

    for (const url of seen) {
      expect(url.match(/(^|[?&])fresh=true(&|$)/g)).toHaveLength(1);
      expect(url).not.toContain("stale=");
    }
    expect(seen.filter((url) => url.includes("fresh=true"))).toHaveLength(2);
  });

  it("hits the overview and the active tab, nothing else", async () => {
    const seen = mockFetch();
    await refreshKeywordSearch(WORKSPACE, KEYWORD, UK, "suggestions");

    expect(seen.some((url) => url.includes("/api/v1/keywords/overview?"))).toBe(true);
    expect(seen.some((url) => url.includes("/api/v1/keywords/suggestions?"))).toBe(true);
    expect(seen.some((url) => url.includes("/keywords/related?"))).toBe(false);
    expect(seen.some((url) => url.includes("/keywords/ideas?"))).toBe(false);
    expect(seen.some((url) => url.includes("/keywords/serp?"))).toBe(false);
  });

  // What the toast reports. Two priced endpoints, one number the user can
  // reconcile against their DataForSEO statement.
  it("reports what the pass cost, both halves", async () => {
    mockFetch();
    const result = await refreshKeywordSearch(WORKSPACE, KEYWORD, UK, "suggestions");
    expect(result.costUsd).toBeCloseTo(0.125, 5);
  });
});
