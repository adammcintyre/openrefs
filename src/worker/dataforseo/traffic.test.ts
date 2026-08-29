/**
 * `bulk_traffic_estimation` — the two documented behaviours that are silent
 * wrong answers if assumed away: asymmetric target formatting, and results
 * that come back reordered with unknown targets simply missing.
 */
import { describe, expect, it } from "vitest";

import type {
  DataForSeoClient,
  DataForSeoRequest,
  DataForSeoResponse,
} from "./client";
import {
  BULK_TRAFFIC_ESTIMATION_MAX_TARGETS,
  GOOGLE_BULK_TRAFFIC_ESTIMATION_LIVE,
  createLabsApi,
  estimateTrafficEstimationCostUsd,
  normalizeTrafficTarget,
  normalizeTrafficTargetList,
  toTrafficEstimateMap,
} from "./labs";

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
        tasks: [],
        costUsd: 0.0132,
        cached: false,
        stale: false,
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

/**
 * The wrapper's `result[0]`, in the documented shape — deliberately returning
 * the targets in a DIFFERENT order from the request, as their own example
 * does, and with `local_pack` / `featured_snippet` null because neither was
 * requested.
 */
const trafficResult = {
  se_type: "google",
  location_code: 2826,
  language_code: "en",
  total_count: 2,
  items_count: 2,
  items: [
    {
      se_type: "google",
      target: "https://www.example.com/blog/photo-booth-templates",
      metrics: {
        organic: { etv: 1820.5, count: 143 },
        paid: { etv: 0, count: 0 },
        local_pack: null,
        featured_snippet: null,
      },
    },
    {
      se_type: "google",
      target: "example.com",
      metrics: {
        organic: { etv: 91234.75, count: 8812 },
        paid: null,
        local_pack: null,
        featured_snippet: null,
      },
    },
  ],
};

describe("normalizeTrafficTarget", () => {
  /*
   * Verbatim from the docs: "domains and subdomains should be specified
   * without https:// and www.; pages should be specified with absolute URL,
   * including https:// and www."
   */
  it("passes a page URL through untouched, scheme, www, path and case", () => {
    const url = "https://www.Example.com/Blog/Photo-Booth";
    expect(normalizeTrafficTarget(url)).toBe(url);
  });

  it("flattens a domain to a bare lowercase host", () => {
    expect(normalizeTrafficTarget("  WWW.Example.com/  ")).toBe("example.com");
    expect(normalizeTrafficTarget("example.com.")).toBe("example.com");
  });

  it("keeps a subdomain, which is a first-class target here", () => {
    expect(normalizeTrafficTarget("blog.example.com")).toBe("blog.example.com");
  });

  it("does NOT strip the path off a page — that would ask a different question", () => {
    // The bug this pins: reusing labs.ts's `normalizeTarget`, which flattens
    // everything to a hostname, would turn every page estimate into a domain
    // estimate and report the whole site's traffic for one article.
    expect(normalizeTrafficTarget("https://example.com/a/b?c=d")).toBe(
      "https://example.com/a/b?c=d",
    );
  });

  it("de-duplicates and sorts so one target set shares one cache entry", () => {
    expect(
      normalizeTrafficTargetList(["b.com", "www.a.com", "a.com", "  "]),
    ).toEqual(["a.com", "b.com"]);
  });
});

describe("googleBulkTrafficEstimationLive", () => {
  it("sends targets, market and item types in the documented shape", async () => {
    const { client, requests } = fakeClient(trafficResult);

    await createLabsApi(client).googleBulkTrafficEstimationLive({
      targets: ["www.example.com", "https://www.example.com/blog/x"],
      locationCode: 2826,
      languageCode: "en",
      itemTypes: ["organic"],
    });

    expect(requests[0]?.endpoint).toBe(GOOGLE_BULK_TRAFFIC_ESTIMATION_LIVE);
    expect(requests[0]?.ttl).toBe("short");
    expect(requests[0]?.payload).toEqual([
      {
        targets: ["example.com", "https://www.example.com/blog/x"],
        location_code: 2826,
        language_code: "en",
        item_types: ["organic"],
        ignore_synonyms: undefined,
      },
    ]);
  });

  it("reads the lean {etv, count} block and nulls the types it did not ask for", async () => {
    const { client } = fakeClient(trafficResult);

    const result = await createLabsApi(client).googleBulkTrafficEstimationLive({
      targets: ["example.com"],
      locationCode: 2826,
      languageCode: "en",
    });

    const page = result.items[0];
    expect(page?.organic).toEqual({ etv: 1820.5, count: 143 });
    expect(page?.paid).toEqual({ etv: 0, count: 0 });
    // Not requested → null upstream → null here, never zero. "We did not ask"
    // must not render as "there are none".
    expect(page?.localPack).toEqual({ etv: null, count: null });
    expect(page?.featuredSnippet).toEqual({ etv: null, count: null });
    expect(result.itemsCount).toBe(2);
  });

  it("is joined by target string, because the response is reordered", async () => {
    const { client } = fakeClient(trafficResult);

    const result = await createLabsApi(client).googleBulkTrafficEstimationLive({
      // Sent domain-first; the canned response returns the page first.
      targets: ["example.com", "https://www.example.com/blog/photo-booth-templates"],
      locationCode: 2826,
      languageCode: "en",
    });

    const byTarget = toTrafficEstimateMap(result.items);
    expect(byTarget.get("example.com")?.organic.etv).toBe(91234.75);
    expect(
      byTarget.get("https://www.example.com/blog/photo-booth-templates")?.organic
        .etv,
    ).toBe(1820.5);
    // A target their index has never seen is absent, not zeroed — callers must
    // treat a miss as "unknown".
    expect(byTarget.has("never-crawled.example")).toBe(false);
  });

  it("rejects a batch over the documented 1000-target ceiling", async () => {
    const { client } = fakeClient(trafficResult);
    const tooMany = Array.from(
      { length: BULK_TRAFFIC_ESTIMATION_MAX_TARGETS + 1 },
      (_, i) => `site-${i}.com`,
    );

    await expect(
      createLabsApi(client).googleBulkTrafficEstimationLive({
        targets: tooMany,
        locationCode: 2826,
        languageCode: "en",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("estimateTrafficEstimationCostUsd", () => {
  it("matches DataForSEO's worked example for a full batch", () => {
    // $0.012 per task + $0.00012 per item → 1000 targets is $0.132.
    expect(estimateTrafficEstimationCostUsd(1000)).toBeCloseTo(0.132, 6);
  });

  it("shows why small batches are the expensive mistake", () => {
    // The flat per-task fee dominates. Ten calls of 100 are $0.24 for exactly
    // the data one $0.132 call of 1000 returns — 1.8×, all of it request fees.
    const oneBigCall = estimateTrafficEstimationCostUsd(1000);
    const tenSmallCalls = 10 * estimateTrafficEstimationCostUsd(100);
    expect(oneBigCall).toBeCloseTo(0.132, 6);
    expect(tenSmallCalls).toBeCloseTo(0.24, 6);
    expect(tenSmallCalls / oneBigCall).toBeGreaterThan(1.8);
  });

  it("charges one task fee per 1000 targets", () => {
    expect(estimateTrafficEstimationCostUsd(1001)).toBeCloseTo(
      2 * 0.012 + 1001 * 0.00012,
      6,
    );
    expect(estimateTrafficEstimationCostUsd(0)).toBe(0);
  });
});
