import { describe, expect, it } from "vitest";

import type {
  DataForSeoClient,
  DataForSeoRequest,
  DataForSeoResponse,
} from "./client";
import { GOOGLE_KEYWORD_OVERVIEW_LIVE, createLabsApi } from "./labs";

/**
 * A DataForSeoClient that answers with a canned `result[0]` and records the
 * request it was handed. The wrappers' whole job is translating between our
 * params and DataForSEO's wire shape, so both directions are worth asserting —
 * and neither needs a network, a binding or a cache.
 */
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
        // Labs endpoints are not task-based, so there is nothing here to keep.
        tasks: [],
        costUsd: 0.01212,
        cached: false,
        stale: false,
        fetchedAt: Date.now(),
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
 * One `items[]` element, trimmed to the fields the wrapper reads, copied from
 * the shape documented at
 * https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live/
 */
const overviewItem = {
  se_type: "google",
  keyword: "seo tools",
  location_code: 2826,
  language_code: "en",
  keyword_info: {
    se_type: "google",
    last_updated_time: "2026-08-01 00:00:00 +00:00",
    // Already 0–1 on Labs. The bug this pins: dividing by 100 again.
    competition: 0.42,
    competition_level: "MEDIUM",
    cpc: 3.75,
    search_volume: 14800,
    low_top_of_page_bid: 1.2,
    high_top_of_page_bid: 6.4,
    // NEWEST-first, as the docs' own example shows.
    monthly_searches: [
      { year: 2026, month: 7, search_volume: 15000 },
      { year: 2026, month: 6, search_volume: 14000 },
    ],
  },
  keyword_properties: {
    se_type: "google",
    keyword_difficulty: 61,
    detected_language: "en",
  },
  search_intent_info: {
    se_type: "google",
    main_intent: "commercial",
    // Plain strings here — not the `{label, probability}` objects that
    // search_intent/live returns under `secondary_keyword_intents`.
    foreign_intent: ["informational", "transactional"],
    last_updated_time: "2026-08-01 00:00:00 +00:00",
  },
};

/**
 * `result[0]` verbatim: five keys, and NO `total_count` / `offset`. Pinning
 * their absence is the point — the shared wrapper schema has to tolerate it.
 */
const overviewResult = {
  se_type: "google",
  location_code: 2826,
  language_code: "en",
  items_count: 1,
  items: [overviewItem],
};

describe("googleKeywordOverviewLive", () => {
  it("posts one task with the keywords ARRAY and the market", async () => {
    const { client, requests } = fakeClient(overviewResult);

    await createLabsApi(client).googleKeywordOverviewLive({
      keywords: ["SEO Tools"],
      locationCode: 2826,
      languageCode: "en",
    });

    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req?.endpoint).toBe(GOOGLE_KEYWORD_OVERVIEW_LIVE);
    expect(req?.endpoint).toBe("dataforseo_labs/google/keyword_overview/live");
    // Volume, difficulty and intent all move on the monthly database clock.
    expect(req?.ttl).toBe("long");
    expect(req?.payload).toEqual([
      {
        // Plural array, lowercased — not the singular `keyword` that
        // keyword_suggestions takes.
        keywords: ["seo tools"],
        location_code: 2826,
        language_code: "en",
      },
    ]);
  });

  it("keeps competition on the 0–1 scale DataForSEO already sent", async () => {
    // The regression this exists for: the previous Google Ads composition
    // divided `competition_index` by 100. Doing that to this field would
    // report 0.0042 as the competition for a keyword at 0.42.
    const { client } = fakeClient(overviewResult);

    const result = await createLabsApi(client).googleKeywordOverviewLive({
      keywords: ["seo tools"],
      locationCode: 2826,
      languageCode: "en",
    });

    expect(result.items[0]?.metrics.competition).toBe(0.42);
    expect(result.items[0]?.metrics.competitionLevel).toBe("MEDIUM");
  });

  it("carries volume, CPC, bids, difficulty and both intent fields", async () => {
    const { client } = fakeClient(overviewResult);

    const result = await createLabsApi(client).googleKeywordOverviewLive({
      keywords: ["seo tools"],
      locationCode: 2826,
      languageCode: "en",
    });

    const row = result.items[0];
    expect(row?.keyword).toBe("seo tools");
    expect(row?.metrics.searchVolume).toBe(14800);
    expect(row?.metrics.cpc).toBe(3.75);
    expect(row?.metrics.lowTopOfPageBid).toBe(1.2);
    expect(row?.metrics.highTopOfPageBid).toBe(6.4);
    expect(row?.keywordDifficulty).toBe(61);
    expect(row?.mainIntent).toBe("commercial");
    // `foreign_intent`, flattened to the strings it actually holds.
    expect(row?.secondaryIntents).toEqual(["informational", "transactional"]);
    expect(result.itemsCount).toBe(1);
    expect(result.costUsd).toBe(0.01212);
  });

  it("passes monthly searches through untouched, newest-first as sent", async () => {
    // Ordering is the route's business (it sorts ascending and takes 12); the
    // wrapper must not quietly reorder or truncate.
    const { client } = fakeClient(overviewResult);

    const result = await createLabsApi(client).googleKeywordOverviewLive({
      keywords: ["seo tools"],
      locationCode: 2826,
      languageCode: "en",
    });

    expect(result.items[0]?.metrics.monthlySearches).toEqual([
      { year: 2026, month: 7, searchVolume: 15000 },
      { year: 2026, month: 6, searchVolume: 14000 },
    ]);
  });

  it("parses a result that carries no total_count or offset", async () => {
    const { client } = fakeClient(overviewResult);

    const result = await createLabsApi(client).googleKeywordOverviewLive({
      keywords: ["seo tools"],
      locationCode: 2826,
      languageCode: "en",
    });

    expect(result.items).toHaveLength(1);
  });

  it("returns no rows when the keyword is absent from their database", async () => {
    // Documented behaviour: an unknown keyword is OMITTED from `items` rather
    // than returned with null metrics, and is not billed. The route must be
    // able to answer with an all-null overview instead of throwing.
    const { client } = fakeClient({ ...overviewResult, items: [], items_count: 0 });

    const result = await createLabsApi(client).googleKeywordOverviewLive({
      keywords: ["a keyword nobody has ever searched for"],
      locationCode: 2826,
      languageCode: "en",
    });

    expect(result.items).toEqual([]);
    expect(result.itemsCount).toBe(0);
  });

  it("de-duplicates and sorts keywords so one question is one cache entry", async () => {
    const { client, requests } = fakeClient(overviewResult);

    await createLabsApi(client).googleKeywordOverviewLive({
      keywords: ["Zebra", "apple", "APPLE"],
      locationCode: 2826,
      languageCode: "en",
    });

    expect(requests[0]?.payload).toEqual([
      expect.objectContaining({ keywords: ["apple", "zebra"] }),
    ]);
  });

  it("rejects a request over the documented 700-keyword ceiling", async () => {
    const { client } = fakeClient(overviewResult);
    const tooMany = Array.from({ length: 701 }, (_, i) => `keyword ${i}`);

    await expect(
      createLabsApi(client).googleKeywordOverviewLive({
        keywords: tooMany,
        locationCode: 2826,
        languageCode: "en",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
