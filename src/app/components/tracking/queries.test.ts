/**
 * The rank-summary request, against a mocked `fetch`.
 *
 * This endpoint is a contract between two packages built in parallel, so the
 * URL is worth pinning rather than assuming: the path, the workspace scope and
 * the window all have to arrive the way the Worker expects them.
 *
 * It is also the one tracking read that is genuinely free — the Worker rolls it
 * up out of D1 and never calls DataForSEO — which is why this hook keeps the
 * app-wide retry default that every paid hook opts out of.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RankSummaryResponse } from "../../../shared/tracking";
import {
  DEFAULT_RANK_SUMMARY_RANGE,
  RANK_SUMMARY_RANGES,
  fetchRankSummary,
  trackingKeys,
} from "./queries";

const RESPONSE: RankSummaryResponse = { days: 30, points: [] };

/** Records the URL each call asked for, and answers with `RESPONSE`. */
function mockFetch(): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (input: string) => {
    urls.push(String(input));
    return Promise.resolve(
      new Response(JSON.stringify(RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchRankSummary", () => {
  it("asks the project's summary endpoint, scoped to the workspace", async () => {
    const urls = mockFetch();
    await fetchRankSummary("ws-1", "proj-1", 30);

    const url = new URL(urls[0] ?? "", "https://openrefs.test");
    expect(url.pathname).toBe("/api/v1/projects/proj-1/rank/summary");
    expect(url.searchParams.get("workspace")).toBe("ws-1");
    expect(url.searchParams.get("days")).toBe("30");
  });

  it("carries whichever window the toggle is on", async () => {
    const urls = mockFetch();
    await fetchRankSummary("ws-1", "proj-1", 90);
    expect(urls[0]).toContain("days=90");
  });

  /** An id lands in a path segment; it does not go in unescaped. */
  it("escapes the project id", async () => {
    const urls = mockFetch();
    await fetchRankSummary("ws-1", "proj/../secret", 30);
    expect(urls[0]).toContain("proj%2F..%2Fsecret");
    expect(urls[0]).not.toContain("proj/../secret");
  });

  it("returns the parsed rollup", async () => {
    mockFetch();
    await expect(fetchRankSummary("ws-1", "proj-1", 30)).resolves.toEqual(
      RESPONSE,
    );
  });
});

describe("the summary key", () => {
  /**
   * The window *is* in the key, unlike the research modules' cache modes: 30
   * and 90 days are two different answers from the server, not two views of one.
   */
  it("keeps the two ranges apart", () => {
    expect(trackingKeys.summary("ws-1", "proj-1", 30)).not.toEqual(
      trackingKeys.summary("ws-1", "proj-1", 90),
    );
  });

  it("scopes by workspace and project", () => {
    expect(trackingKeys.summary("ws-1", "proj-1", 30)).toEqual([
      "tracking",
      "summary",
      "ws-1",
      "proj-1",
      30,
    ]);
  });
});

describe("the offered ranges", () => {
  it("defaults to the shorter one", () => {
    expect(RANK_SUMMARY_RANGES).toContain(DEFAULT_RANK_SUMMARY_RANGE);
    expect(DEFAULT_RANK_SUMMARY_RANGE).toBe(30);
  });
});
