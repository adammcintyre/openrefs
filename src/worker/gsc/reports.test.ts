import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GSC_DATA_LAG_DAYS, GSC_DEFAULT_RANGE_DAYS } from "../../shared/gsc";
import type { SearchAnalyticsRow } from "./api";
import {
  GSC_CACHE_TTL_SECONDS,
  cachedPull,
  freshTo,
  pacificToday,
  paginate,
  pullCacheKey,
  resolveRange,
  toDaily,
  toIsoDate,
  toPageRows,
  toQueryPageRows,
  toQueryRows,
  totalsFromDaily,
} from "./reports";

const WS = "ws-1";
const PROJECT = "proj-1";
const PROPERTY = "sc-domain:example.com";

/** Midday UTC, so the Pacific-offset shift cannot cross a date boundary. */
const NOON = new Date("2026-08-29T12:00:00.000Z");

class FakeKv {
  readonly store = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();
  getCalls = 0;

  async get(key: string, _type?: string): Promise<unknown> {
    this.getCalls += 1;
    const raw = this.store.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, value);
    this.ttls.set(key, options?.expirationTtl);
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A fresh `Response` per call. A `Response` body can only be read once, so a
 * `mockResolvedValue` holding a single instance fails the *second* call with a
 * confusing "non-JSON response" — the body is simply already consumed.
 */
function googleRows(rows: unknown[]): () => Response {
  return () =>
    new Response(JSON.stringify({ rows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

/* -------------------------------------------------------------------------- */

describe("pacificToday", () => {
  it("uses the Pacific date, not the UTC one", () => {
    // 02:00 UTC on the 29th is still the 28th in Pacific Time.
    expect(toIsoDate(pacificToday(new Date("2026-08-29T02:00:00.000Z")))).toBe(
      "2026-08-28",
    );
    expect(toIsoDate(pacificToday(new Date("2026-08-29T12:00:00.000Z")))).toBe(
      "2026-08-29",
    );
  });

  it("errs behind, never ahead", () => {
    // Assuming UTC-8 year-round means that during PDT the computed date can
    // lag the real Pacific date by an hour's worth of boundary — which only
    // ever makes the window end earlier, never asks Google for a day it has
    // not finalised.
    const midnightPdt = new Date("2026-08-29T07:30:00.000Z"); // 00:30 PDT
    expect(toIsoDate(pacificToday(midnightPdt))).toBe("2026-08-28");
  });
});

describe("freshTo", () => {
  it("is the Pacific date minus the documented lag", () => {
    expect(freshTo(NOON)).toBe("2026-08-27");
    expect(GSC_DATA_LAG_DAYS).toBe(2);
  });
});

describe("resolveRange", () => {
  it("defaults to the last 28 complete days, inclusive of both ends", () => {
    const range = resolveRange({}, NOON);
    expect(range).toEqual({
      from: "2026-07-31",
      to: "2026-08-27",
      freshTo: "2026-08-27",
    });

    const days =
      (Date.parse(`${range.to}T00:00:00Z`) -
        Date.parse(`${range.from}T00:00:00Z`)) /
        86_400_000 +
      1;
    expect(days).toBe(GSC_DEFAULT_RANGE_DAYS);
  });

  it("clamps a `to` past the freshness boundary instead of rejecting it", () => {
    // A date picker offering "today" is reasonable; erroring about a lag the
    // user has never heard of is not.
    const range = resolveRange({ to: "2026-08-29" }, NOON);
    expect(range.to).toBe("2026-08-27");
  });

  it("re-anchors the default window to the clamped end", () => {
    const range = resolveRange({ to: "2026-08-29" }, NOON);
    expect(range.from).toBe("2026-07-31");
  });

  it("honours an explicit window inside the boundary", () => {
    expect(resolveRange({ from: "2026-08-01", to: "2026-08-10" }, NOON)).toEqual(
      { from: "2026-08-01", to: "2026-08-10", freshTo: "2026-08-27" },
    );
  });

  it("allows a single-day window", () => {
    const range = resolveRange({ from: "2026-08-10", to: "2026-08-10" }, NOON);
    expect(range.from).toBe(range.to);
  });

  it("rejects a backwards range", () => {
    expect(() =>
      resolveRange({ from: "2026-08-20", to: "2026-08-10" }, NOON),
    ).toThrow(/after its end/);
  });

  it("rejects a range whose `from` is past the clamped `to`", () => {
    // `to` clamps to 08-27, so a `from` of 08-28 is now backwards.
    expect(() =>
      resolveRange({ from: "2026-08-28", to: "2026-08-29" }, NOON),
    ).toThrow();
  });

  it("reports freshTo even when the window ends earlier", () => {
    expect(resolveRange({ from: "2026-01-01", to: "2026-01-31" }, NOON).freshTo)
      .toBe("2026-08-27");
  });
});

/* -------------------------------------------------------------------------- */

describe("pullCacheKey", () => {
  const range = { from: "2026-07-31", to: "2026-08-27" };

  it("sits under the workspace prefix so deletion sweeps it", async () => {
    const key = await pullCacheKey(WS, PROJECT, PROPERTY, "query", range);
    expect(key.startsWith(`ws:${WS}:gsc:${PROJECT}:`)).toBe(true);
    expect(key.endsWith(":query:2026-07-31:2026-08-27")).toBe(true);
  });

  it("changes with the property, so re-pointing cannot serve stale numbers", async () => {
    const a = await pullCacheKey(WS, PROJECT, PROPERTY, "query", range);
    const b = await pullCacheKey(WS, PROJECT, "sc-domain:other.com", "query", range);
    expect(a).not.toBe(b);
  });

  it("changes with the dimensions and the window", async () => {
    const base = await pullCacheKey(WS, PROJECT, PROPERTY, "query", range);
    expect(
      await pullCacheKey(WS, PROJECT, PROPERTY, "query,page", range),
    ).not.toBe(base);
    expect(
      await pullCacheKey(WS, PROJECT, PROPERTY, "query", {
        from: "2026-07-30",
        to: "2026-08-27",
      }),
    ).not.toBe(base);
  });

  it("never lets one workspace read another's entry", async () => {
    const a = await pullCacheKey("ws-a", PROJECT, PROPERTY, "query", range);
    const b = await pullCacheKey("ws-b", PROJECT, PROPERTY, "query", range);
    expect(a).not.toBe(b);
  });
});

describe("cachedPull", () => {
  function ctx(kv: FakeKv) {
    return {
      kv: kv as unknown as KVNamespace,
      accessToken: "ya29.token",
      workspaceId: WS,
      projectId: PROJECT,
      property: PROPERTY,
      range: { from: "2026-07-31", to: "2026-08-27", freshTo: "2026-08-27" },
    };
  }

  it("calls Google on a miss and caches for 24 hours", async () => {
    const kv = new FakeKv();
    fetchMock.mockImplementation(
      googleRows([{ keys: ["seo"], clicks: 5, impressions: 100, ctr: 0.05, position: 4 }]),
    );

    const first = await cachedPull(ctx(kv), "query");
    expect(first.cached).toBe(false);
    expect(first.rows).toHaveLength(1);
    expect([...kv.ttls.values()][0]).toBe(GSC_CACHE_TTL_SECONDS);
    expect(GSC_CACHE_TTL_SECONDS).toBe(86_400);
  });

  it("serves the second call from KV without touching Google", async () => {
    const kv = new FakeKv();
    fetchMock.mockImplementation(googleRows([{ keys: ["seo"], clicks: 5 }]));

    await cachedPull(ctx(kv), "query");
    const second = await cachedPull(ctx(kv), "query");

    expect(second.cached).toBe(true);
    expect(second.rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps dimension sets in separate entries", async () => {
    const kv = new FakeKv();
    fetchMock.mockImplementation(googleRows([]));

    await cachedPull(ctx(kv), "query");
    await cachedPull(ctx(kv), "query,page");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(kv.store.size).toBe(2);
  });

  it("splits the dimension string into the array Google expects", async () => {
    const kv = new FakeKv();
    fetchMock.mockImplementation(googleRows([]));

    await cachedPull(ctx(kv), "query,page");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { dimensions: string[] };
    expect(body.dimensions).toEqual(["query", "page"]);
  });

  it("ignores a cache entry written by an older format version", async () => {
    const kv = new FakeKv();
    const key = await pullCacheKey(WS, PROJECT, PROPERTY, "query", {
      from: "2026-07-31",
      to: "2026-08-27",
    });
    kv.store.set(key, JSON.stringify({ v: 0, rows: [{ keys: ["stale"] }] }));
    fetchMock.mockImplementation(googleRows([{ keys: ["fresh"] }]));

    const result = await cachedPull(ctx(kv), "query");
    expect(result.cached).toBe(false);
    expect(result.rows[0]?.keys).toEqual(["fresh"]);
  });
});

/* -------------------------------------------------------------------------- */

function row(
  keys: string[],
  over: Partial<SearchAnalyticsRow> = {},
): SearchAnalyticsRow {
  return { keys, clicks: 0, impressions: 0, ctr: 0, position: 0, ...over };
}

describe("shaping", () => {
  it("sorts the daily series oldest first, whatever order Google sent", () => {
    const daily = toDaily([
      row(["2026-08-03"], { clicks: 3 }),
      row(["2026-08-01"], { clicks: 1 }),
      row(["2026-08-02"], { clicks: 2 }),
    ]);
    expect(daily.map((point) => point.date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("sorts query and page rows by clicks, then impressions", () => {
    const queries = toQueryRows([
      row(["a"], { clicks: 1, impressions: 10 }),
      row(["b"], { clicks: 9, impressions: 10 }),
      row(["c"], { clicks: 1, impressions: 99 }),
    ]);
    expect(queries.map((r) => r.query)).toEqual(["b", "c", "a"]);

    const pages = toPageRows([
      row(["/a"], { clicks: 1 }),
      row(["/b"], { clicks: 4 }),
    ]);
    expect(pages.map((r) => r.page)).toEqual(["/b", "/a"]);
  });

  it("unpacks query+page keys in the order they were requested", () => {
    const rows = toQueryPageRows([
      row(["seo tools", "/tools"], { clicks: 3, impressions: 40 }),
    ]);
    expect(rows).toEqual([
      { query: "seo tools", page: "/tools", clicks: 3, impressions: 40, ctr: 0, position: 0 },
    ]);
  });

  it("drops rows with missing keys rather than inventing empty ones", () => {
    expect(toQueryRows([row([])])).toEqual([]);
    // A query+page row needs both halves to mean anything.
    expect(toQueryPageRows([row(["only-query"])])).toEqual([]);
  });
});

describe("totalsFromDaily", () => {
  it("sums clicks and impressions and derives CTR from them", () => {
    const totals = totalsFromDaily([
      { date: "2026-08-01", clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { date: "2026-08-02", clicks: 30, impressions: 300, ctr: 0.1, position: 5 },
    ]);
    expect(totals.clicks).toBe(40);
    expect(totals.impressions).toBe(400);
    expect(totals.ctr).toBeCloseTo(0.1, 10);
  });

  it("weights average position by impressions, not by day", () => {
    // A quiet day at position 50 must not drag a busy day at position 2 to 26.
    const totals = totalsFromDaily([
      { date: "2026-08-01", clicks: 0, impressions: 9900, ctr: 0, position: 2 },
      { date: "2026-08-02", clicks: 0, impressions: 100, ctr: 0, position: 50 },
    ]);
    expect(totals.position).toBeCloseTo(2.48, 10);
  });

  it("is all zeroes for an empty series, position included", () => {
    // 0 is outside the 1-based position scale, so the UI can tell it apart
    // from a real average.
    expect(totalsFromDaily([])).toEqual({
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    });
  });

  it("does not divide by zero when a day had impressions but no clicks", () => {
    const totals = totalsFromDaily([
      { date: "2026-08-01", clicks: 0, impressions: 10, ctr: 0, position: 8 },
    ]);
    expect(totals.ctr).toBe(0);
    expect(totals.position).toBe(8);
  });
});

describe("paginate", () => {
  const rows = [1, 2, 3, 4, 5];

  it("windows the set and reports the size behind it", () => {
    expect(paginate(rows, 2, 0)).toEqual({ rows: [1, 2], total: 5 });
    expect(paginate(rows, 2, 2)).toEqual({ rows: [3, 4], total: 5 });
  });

  it("returns an empty page past the end, still reporting the total", () => {
    expect(paginate(rows, 2, 99)).toEqual({ rows: [], total: 5 });
  });
});
