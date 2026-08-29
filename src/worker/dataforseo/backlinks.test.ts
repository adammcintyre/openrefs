import { describe, expect, it } from "vitest";

import {
  BACKLINKS_BULK_RANKS_LIVE,
  BACKLINKS_SUMMARY_LIVE,
  createBacklinksApi,
  normalizeBacklinksTarget,
  normalizeTargetList,
  toDofollowSplit,
  toHistoryPeriod,
} from "./backlinks";
import type {
  DataForSeoClient,
  DataForSeoRequest,
  DataForSeoResponse,
} from "./client";

function fakeClient(result: unknown): {
  client: DataForSeoClient;
  requests: DataForSeoRequest<unknown>[];
} {
  const requests: DataForSeoRequest<unknown>[] = [];
  const client: DataForSeoClient = {
    async request<TResult>(
      req: DataForSeoRequest<unknown>,
    ): Promise<DataForSeoResponse<TResult>> {
      requests.push(req);
      return {
        results: [result as TResult],
        costUsd: 0.024,
        cached: false,
        statusCode: 20000,
        statusMessage: "Ok.",
      };
    },
    async balance() {
      return { balanceUsd: 0 };
    },
  };
  return { client, requests };
}

/** summary's `result[0]`: a flat object with no `items` wrapper. */
const summaryResult = {
  target: "example.com",
  first_seen: "2019-01-20 10:33:56 +00:00",
  lost_date: null,
  rank: 371,
  backlinks: 32064,
  backlinks_spam_score: 20,
  crawled_pages: 5857,
  info: { server: "nginx", country: "US", is_ip: false },
  internal_links_count: 506274,
  external_links_count: 19667,
  broken_backlinks: 0,
  broken_pages: 11,
  referring_domains: 2299,
  referring_domains_nofollow: 100,
  referring_main_domains: 2148,
  referring_main_domains_nofollow: 90,
  referring_ips: 639,
  referring_subnets: 457,
  referring_pages: 30594,
  referring_pages_nofollow: 2863,
  referring_links_attributes: { nofollow: 2861, ugc: 146 },
  referring_links_types: { image: 24187, anchor: 6404 },
};

describe("summaryLive", () => {
  it("pins rank_scale rather than inheriting DataForSEO's default", () => {
    // If their default ever moved to one_hundred, every Domain Score would
    // silently become a tenth of itself. Sending it explicitly is the guard.
    const { client, requests } = fakeClient(summaryResult);
    return createBacklinksApi(client)
      .summaryLive({ target: "example.com" })
      .then(() => {
        expect(requests[0]?.endpoint).toBe(BACKLINKS_SUMMARY_LIVE);
        expect(requests[0]?.ttl).toBe("short");
        expect(requests[0]?.payload).toEqual([
          expect.objectContaining({
            target: "example.com",
            rank_scale: "one_thousand",
          }),
        ]);
      });
  });

  it("publishes a 0–100 Domain Score and never the raw rank", async () => {
    const { client } = fakeClient(summaryResult);
    const result = await createBacklinksApi(client).summaryLive({
      target: "example.com",
    });

    expect(result.domainScore).toBe(37);
    // The 0–1000 number must not survive anywhere on the returned type.
    expect(JSON.stringify({ ...result, raw: null })).not.toContain("371");
  });

  it("derives the dofollow split the API does not report", async () => {
    const { client } = fakeClient(summaryResult);
    const result = await createBacklinksApi(client).summaryLive({
      target: "example.com",
    });

    expect(result.dofollow.dofollowPages).toBe(30594 - 2863);
    expect(result.dofollow.nofollowPages).toBe(2863);
    expect(result.dofollow.dofollowRatio).toBeCloseTo(0.9064, 4);
  });

  it("carries the counts and the open-keyed attribute maps", async () => {
    const { client } = fakeClient(summaryResult);
    const result = await createBacklinksApi(client).summaryLive({
      target: "example.com",
    });

    expect(result.backlinks).toBe(32064);
    expect(result.referringDomains).toBe(2299);
    expect(result.referringMainDomains).toBe(2148);
    expect(result.brokenPages).toBe(11);
    expect(result.server).toBe("nginx");
    expect(result.countryIsoCode).toBe("US");
    expect(result.linkAttributes).toEqual({ nofollow: 2861, ugc: 146 });
  });
});

describe("bulkRanksLive", () => {
  it("scores every target and matches by name, not by position", async () => {
    // DataForSEO returns URLs before bare domains regardless of input order,
    // so callers must key on `target`. This pins that the wrapper preserves
    // the target string rather than assuming an order.
    const { client } = fakeClient({
      items_count: 3,
      items: [
        { target: "https://example.com/page", rank: 848 },
        { target: "b.com", rank: 300 },
        { target: "a.com", rank: 0 },
      ],
    });

    const result = await createBacklinksApi(client).bulkRanksLive({
      targets: ["a.com", "b.com", "https://example.com/page"],
    });

    expect(result.items).toEqual([
      { target: "https://example.com/page", domainScore: 85 },
      { target: "b.com", domainScore: 30 },
      // Rank 0 is a real answer — crawled, no authority — and is not null.
      { target: "a.com", domainScore: 0 },
    ]);
  });

  it("sends a sorted, de-duplicated targets array", async () => {
    const { client, requests } = fakeClient({ items_count: 0, items: [] });

    await createBacklinksApi(client).bulkRanksLive({
      targets: ["b.com", "A.com", "a.com"],
    });

    expect(requests[0]?.endpoint).toBe(BACKLINKS_BULK_RANKS_LIVE);
    expect(requests[0]?.payload).toEqual([
      { targets: ["a.com", "b.com"], rank_scale: "one_thousand" },
    ]);
  });
});

describe("historyLive", () => {
  it("parses a result that has no total_count and derives a period", async () => {
    const { client } = fakeClient({
      target: "example.com",
      date_from: "2025-09-01",
      date_to: "2026-08-28",
      items_count: 2,
      items: [
        {
          date: "2025-09-30 00:00:00 +00:00",
          rank: 370,
          backlinks: 41678,
          new_backlinks: 2256,
          lost_backlinks: 552,
          referring_domains: 2547,
        },
        {
          date: "2025-10-31 00:00:00 +00:00",
          rank: 365,
          backlinks: 40399,
        },
      ],
    });

    const result = await createBacklinksApi(client).historyLive({
      target: "example.com",
    });

    expect(result.itemsCount).toBe(2);
    expect(result.items[0]?.period).toBe("2025-09");
    expect(result.items[0]?.domainScore).toBe(37);
    expect(result.items[0]?.newBacklinks).toBe(2256);
    expect(result.items[1]?.period).toBe("2025-10");
    // Absent fields are null, not zero — "not reported" is not "no change".
    expect(result.items[1]?.newBacklinks).toBeNull();
  });

  it("uses the long TTL — a monthly series does not move daily", async () => {
    const { client, requests } = fakeClient({ items_count: 0, items: [] });
    await createBacklinksApi(client).historyLive({ target: "example.com" });
    expect(requests[0]?.ttl).toBe("long");
  });
});

describe("backlinksLive", () => {
  it("converts both ranks on a row to scores", async () => {
    const { client } = fakeClient({
      target: "example.com",
      mode: "one_per_domain",
      total_count: 2244,
      items_count: 1,
      items: [
        {
          domain_from: "4.bing.com",
          url_from: "https://4.bing.com/images/search",
          url_to: "https://example.com/page",
          anchor: "example.com",
          dofollow: true,
          is_broken: false,
          page_from_rank: 0,
          domain_from_rank: 770,
          group_count: 247,
        },
      ],
    });

    const result = await createBacklinksApi(client).backlinksLive({
      target: "example.com",
      mode: "one_per_domain",
    });

    const row = result.items[0];
    expect(row?.domainScore).toBe(77);
    // Rank 0 on the linking page is a real 0, not a missing value.
    expect(row?.pageScore).toBe(0);
    expect(row?.dofollow).toBe(true);
    expect(row?.groupCount).toBe(247);
    expect(result.totalCount).toBe(2244);
  });

  it("encodes a single filter as a bare triple, as the docs require", async () => {
    const { client, requests } = fakeClient({
      target: "example.com",
      total_count: 0,
      items_count: 0,
      items: [],
    });

    await createBacklinksApi(client).backlinksLive({
      target: "example.com",
      filters: [{ field: "dofollow", operator: "=", value: true }],
      sorts: [{ field: "domain_from_rank", direction: "desc" }],
    });

    const payload = (requests[0]?.payload as Record<string, unknown>[])[0];
    // One condition is a flat triple — NOT wrapped in an outer array.
    expect(payload?.["filters"]).toEqual(["dofollow", "=", true]);
    expect(payload?.["order_by"]).toEqual(["domain_from_rank,desc"]);
  });

  it("joins several filters with a bare `and` string", async () => {
    const { client, requests } = fakeClient({
      target: "example.com",
      total_count: 0,
      items_count: 0,
      items: [],
    });

    await createBacklinksApi(client).backlinksLive({
      target: "example.com",
      filters: [
        { field: "dofollow", operator: "=", value: true },
        { field: "domain_from_rank", operator: ">=", value: 500 },
      ],
    });

    const payload = (requests[0]?.payload as Record<string, unknown>[])[0];
    expect(payload?.["filters"]).toEqual([
      ["dofollow", "=", true],
      "and",
      ["domain_from_rank", ">=", 500],
    ]);
  });
});

describe("toDofollowSplit", () => {
  it("subtracts nofollow from the total", () => {
    expect(toDofollowSplit(100, 25)).toEqual({
      dofollowPages: 75,
      nofollowPages: 25,
      dofollowRatio: 0.75,
    });
  });

  it("reports null rather than a fake 100% when the total is unknown", () => {
    // The failure this prevents: an unreported profile rendering as "100%
    // dofollow", which is the most flattering possible lie.
    expect(toDofollowSplit(null, 25)).toEqual({
      dofollowPages: null,
      nofollowPages: 25,
      dofollowRatio: null,
    });
    expect(toDofollowSplit(100, null).dofollowRatio).toBeNull();
  });

  it("never reports a negative count when the two aggregates disagree", () => {
    expect(toDofollowSplit(10, 25).dofollowPages).toBe(0);
  });

  it("leaves the ratio null for a profile with no referring pages", () => {
    expect(toDofollowSplit(0, 0)).toEqual({
      dofollowPages: 0,
      nofollowPages: 0,
      dofollowRatio: null,
    });
  });
});

describe("normalizeBacklinksTarget", () => {
  it("keeps a full URL intact — these endpoints take pages too", () => {
    // The difference from labs.ts's normalizeTarget, which flattens to a host.
    expect(normalizeBacklinksTarget("https://example.com/blog/post")).toBe(
      "https://example.com/blog/post",
    );
  });

  it("strips www and a trailing slash from a bare host", () => {
    expect(normalizeBacklinksTarget("www.Example.com/")).toBe("example.com");
    expect(normalizeBacklinksTarget("  EXAMPLE.com.  ")).toBe("example.com");
  });
});

describe("normalizeTargetList", () => {
  it("de-duplicates and sorts so one question is one cache entry", () => {
    expect(normalizeTargetList(["b.com", "www.A.com", "a.com"])).toEqual([
      "a.com",
      "b.com",
    ]);
  });
});

describe("toHistoryPeriod", () => {
  it("slices the month out without reinterpreting the timezone", () => {
    // Parsing as a Date would shift a month-end point into the previous month
    // in any negative-offset runtime.
    expect(toHistoryPeriod("2020-08-31 00:00:00 +00:00")).toBe("2020-08");
    expect(toHistoryPeriod("2026-01-31 00:00:00 +00:00")).toBe("2026-01");
  });

  it("returns null for absent or unparseable dates", () => {
    expect(toHistoryPeriod(null)).toBeNull();
    expect(toHistoryPeriod("not a date")).toBeNull();
  });
});
