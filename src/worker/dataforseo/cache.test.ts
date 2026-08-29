/**
 * Stale-if-error: the client's cache behaviour, end to end.
 *
 * Separate from client.test.ts because this is the one part of the client that
 * cannot be tested as a pure function — it is a conversation between KV, the
 * spend cap, `fetch` and the meter, and the thing worth pinning is the whole
 * fallback matrix rather than any one step of it.
 *
 * The rule under test, stated once: a cache entry outlives its TTL (it is
 * written with **no** KV `expirationTtl`), and a soft-expired entry is served
 * **only** when the refresh produced no response at all. A refusal — the spend
 * cap, bad credentials, an upstream error — must reach the caller, because
 * every one of those is a fact about their account that stale data would hide.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../../db";
import type { DataForSeoClient } from "./client";
import {
  CACHE_MAX_AGE_MS,
  CACHE_TTL_SECONDS,
  computeCacheKey,
  createDataForSeoClient,
  DFS_OK_STATUS,
  DFS_SANDBOX_BASE_URL,
  readCacheEntry,
} from "./client";

const ENDPOINT = "dataforseo_labs/google/keyword_ideas/live";
const PAYLOAD = [{ keywords: ["photo booth template"], location_code: 2826 }];
const DAY_MS = 24 * 60 * 60 * 1000;

/** A KV double recording what was written, with what options, and deleted. */
function fakeKv() {
  const store = new Map<string, string>();
  const puts: { key: string; options: unknown }[] = [];
  const deletes: string[] = [];
  const kv = {
    async get(key: string, type?: string) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? (JSON.parse(raw) as unknown) : raw;
    },
    async put(key: string, value: string, options?: unknown) {
      puts.push({ key, options });
      store.set(key, value);
    },
    async delete(key: string) {
      deletes.push(key);
      store.delete(key);
    },
  };
  return { kv: kv as unknown as KVNamespace, store, puts, deletes };
}

/**
 * A Drizzle double covering exactly the two shapes the client uses: the meter's
 * insert, and the spend-cap read — which is always the workspace's cap followed
 * by the month's spend, in that order. Alternating on call count is what lets
 * this avoid parsing SQL; if `assertWithinSpendCap` ever reorders those two
 * queries, these tests fail loudly rather than silently reading the wrong row.
 */
function fakeDb(options: { capUsd?: number; spentUsd?: number } = {}) {
  const usage: {
    workspaceId: string;
    endpoint: string;
    costUsd: number;
    cached: boolean;
  }[] = [];
  let selects = 0;
  const chain = (rows: unknown[]): unknown => {
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      limit: () => self,
      then: (resolve: (value: unknown[]) => unknown) => resolve(rows),
    };
    return self;
  };
  const db = {
    insert: () => ({
      values: async (row: (typeof usage)[number]) => {
        usage.push(row);
      },
    }),
    select: () => {
      selects += 1;
      return selects % 2 === 1
        ? chain([{ capUsd: options.capUsd ?? 100 }])
        : chain([{ total: options.spentUsd ?? 0 }]);
    },
  };
  return { db: db as unknown as Db, usage };
}

/** A v2 entry aged `ageMs`, whose soft TTL was `softTtlMs`. */
function storedEntry(results: unknown[], ageMs: number, softTtlMs: number): string {
  const cachedAt = Date.now() - ageMs;
  return JSON.stringify({
    v: 2,
    results,
    statusCode: DFS_OK_STATUS,
    statusMessage: "Ok.",
    cachedAt,
    softExpiresAt: cachedAt + softTtlMs,
  });
}

/** A DataForSEO envelope, as `fetch` would resolve it. */
function envelope(results: unknown[], taskStatus = DFS_OK_STATUS): Response {
  return new Response(
    JSON.stringify({
      status_code: DFS_OK_STATUS,
      status_message: "Ok.",
      cost: 0.0102,
      tasks: [
        {
          id: "t-1",
          status_code: taskStatus,
          status_message: taskStatus === DFS_OK_STATUS ? "Ok." : "Denied.",
          cost: 0.0102,
          result: results,
        },
      ],
    }),
    { headers: { "content-type": "application/json" } },
  );
}

/** What `AbortSignal.timeout` produces, and what the client keys on. */
function timeoutError(): Error {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

function keyFor(): Promise<string> {
  return computeCacheKey("ws-1", ENDPOINT, PAYLOAD);
}

function build(kv: KVNamespace, db: Db, fetchImpl: unknown): DataForSeoClient {
  vi.stubGlobal("fetch", fetchImpl);
  return createDataForSeoClient({
    // The sandbox base keeps the optional egress relay out of the path
    // entirely: the relay only engages for the real API base, so these tests
    // exercise caching and nothing else.
    baseUrl: DFS_SANDBOX_BASE_URL,
    env: { CACHE: kv } as unknown as Env,
    workspaceId: "ws-1",
    credentials: { login: "user", password: "pass" },
    db,
  });
}

/** One attempt: the stub throws immediately, so a ladder would prove nothing. */
const REQUEST = {
  endpoint: ENDPOINT,
  payload: PAYLOAD,
  ttl: "long" as const,
  timeoutsMs: [50],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stale-if-error fallback matrix", () => {
  it("fresh hit: serves the entry, spends nothing, never calls upstream", async () => {
    const { kv, store } = fakeKv();
    store.set(await keyFor(), storedEntry([{ items: ["cached"] }], DAY_MS, 30 * DAY_MS));
    const { db, usage } = fakeDb();
    const fetchSpy = vi.fn();

    const res = await build(kv, db, fetchSpy).request(REQUEST);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.cached).toBe(true);
    expect(res.stale).toBe(false);
    expect(res.costUsd).toBe(0);
    expect(res.results).toEqual([{ items: ["cached"] }]);
    expect(usage).toEqual([
      { workspaceId: "ws-1", endpoint: ENDPOINT, costUsd: 0, cached: true },
    ]);
  });

  it("soft-expired + refresh ok: pays for the new answer and rewrites the entry", async () => {
    const { kv, store, puts } = fakeKv();
    const key = await keyFor();
    // Past its 30-day soft TTL, nowhere near the 90-day ceiling.
    store.set(key, storedEntry([{ items: ["old"] }], 40 * DAY_MS, 30 * DAY_MS));
    const { db, usage } = fakeDb();
    const fetchSpy = vi.fn(async () => envelope([{ items: ["new"] }]));

    const res = await build(kv, db, fetchSpy).request(REQUEST);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.cached).toBe(false);
    expect(res.stale).toBe(false);
    expect(res.results).toEqual([{ items: ["new"] }]);
    expect(usage).toEqual([
      { workspaceId: "ws-1", endpoint: ENDPOINT, costUsd: 0.0102, cached: false },
    ]);

    // Rewritten with a new soft TTL and, critically, still no KV expiry —
    // that absence is what leaves the next soft-expired read something to
    // fall back on.
    const written = JSON.parse(store.get(key) as string) as {
      v: number;
      cachedAt: number;
      softExpiresAt: number;
    };
    expect(written.v).toBe(2);
    expect(written.softExpiresAt - written.cachedAt).toBe(
      CACHE_TTL_SECONDS.long * 1000,
    );
    expect(puts.at(-1)?.options).toBeUndefined();
  });

  it("soft-expired + upstream timeout: serves the stale copy, flagged", async () => {
    const { kv, store } = fakeKv();
    store.set(await keyFor(), storedEntry([{ items: ["old"] }], 40 * DAY_MS, 30 * DAY_MS));
    const { db, usage } = fakeDb();
    const fetchSpy = vi.fn(async () => {
      throw timeoutError();
    });

    const res = await build(kv, db, fetchSpy).request(REQUEST);

    expect(res.results).toEqual([{ items: ["old"] }]);
    expect(res.cached).toBe(true);
    expect(res.stale).toBe(true);
    expect(res.costUsd).toBe(0);
    // Metered as a cache hit: nothing was charged, and the usage row must not
    // claim a spend that never happened.
    expect(usage).toEqual([
      { workspaceId: "ws-1", endpoint: ENDPOINT, costUsd: 0, cached: true },
    ]);
  });

  it("soft-expired + spend cap: the 402 propagates and nothing stale is served", async () => {
    // A cap decision is a fact about this workspace's money. Answering it with
    // last month's rows would hide it behind data the user did not just buy.
    const { kv, store } = fakeKv();
    store.set(await keyFor(), storedEntry([{ items: ["old"] }], 40 * DAY_MS, 30 * DAY_MS));
    const { db } = fakeDb({ capUsd: 0 });
    const fetchSpy = vi.fn();

    await expect(build(kv, db, fetchSpy).request(REQUEST)).rejects.toMatchObject({
      code: "spend_cap_exceeded",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("soft-expired + a refused call: the upstream error propagates, stale is NOT served", async () => {
    /*
     * 40100 is what a denied or bad-credential task looks like: DataForSEO
     * *answered*. Only a call that produced no response at all may fall back.
     *
     * The sibling 409 in this matrix — `no_credentials` — cannot be provoked
     * here by construction: it is raised by `resolveWorkspaceCredentials`
     * before a client exists, so there is no cache to fall back to. That is a
     * stronger guarantee than a test.
     */
    const { kv, store } = fakeKv();
    store.set(await keyFor(), storedEntry([{ items: ["old"] }], 40 * DAY_MS, 30 * DAY_MS));
    const { db } = fakeDb();
    const fetchSpy = vi.fn(async () => envelope([], 40100));

    await expect(build(kv, db, fetchSpy).request(REQUEST)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("hard-expired: the entry is deleted on read and cannot be fallen back on", async () => {
    const { kv, store, deletes } = fakeKv();
    const key = await keyFor();
    store.set(key, storedEntry([{ items: ["ancient"] }], CACHE_MAX_AGE_MS + DAY_MS, 30 * DAY_MS));
    const { db } = fakeDb();
    const fetchSpy = vi.fn(async () => {
      throw timeoutError();
    });

    await expect(build(kv, db, fetchSpy).request(REQUEST)).rejects.toMatchObject({
      code: "upstream_timeout",
    });

    expect(deletes).toEqual([key]);
    expect(store.has(key)).toBe(false);
  });

  it("fresh: true never serves stale, however old or new the entry is", async () => {
    for (const ageMs of [DAY_MS, 40 * DAY_MS]) {
      const { kv, store } = fakeKv();
      store.set(await keyFor(), storedEntry([{ items: ["old"] }], ageMs, 30 * DAY_MS));
      const { db } = fakeDb();
      const fetchSpy = vi.fn(async () => {
        throw timeoutError();
      });

      await expect(
        build(kv, db, fetchSpy).request({ ...REQUEST, fresh: true }),
      ).rejects.toMatchObject({ code: "upstream_timeout" });
      // A Refresh button that quietly hands back the copy it was paid to
      // bypass is worse than one that errors.
      expect(fetchSpy).toHaveBeenCalled();
    }
  });

  it("reads a v1 entry as fresh — KV is still enforcing that one's own TTL", async () => {
    const { kv, store } = fakeKv();
    store.set(
      await keyFor(),
      JSON.stringify({
        v: 1,
        results: [{ items: ["legacy"] }],
        statusCode: DFS_OK_STATUS,
        statusMessage: "Ok.",
        cachedAt: Date.now() - DAY_MS,
      }),
    );
    const { db } = fakeDb();
    const fetchSpy = vi.fn();

    const res = await build(kv, db, fetchSpy).request(REQUEST);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.cached).toBe(true);
    expect(res.stale).toBe(false);
    expect(res.results).toEqual([{ items: ["legacy"] }]);
  });

  it("a ttl:'none' endpoint neither reads nor writes an entry", async () => {
    const { kv, store, puts } = fakeKv();
    store.set(await keyFor(), storedEntry([{ items: ["old"] }], DAY_MS, 30 * DAY_MS));
    const { db } = fakeDb();
    const fetchSpy = vi.fn(async () => envelope([{ items: ["live"] }]));

    const res = await build(kv, db, fetchSpy).request({ ...REQUEST, ttl: "none" });

    expect(res.results).toEqual([{ items: ["live"] }]);
    expect(res.cached).toBe(false);
    expect(res.stale).toBe(false);
    expect(puts).toEqual([]);
  });
});

describe("readCacheEntry", () => {
  const base = {
    results: [],
    statusCode: DFS_OK_STATUS,
    statusMessage: "Ok.",
    cachedAt: 1,
  };

  it("rejects anything that is not a version it knows", () => {
    expect(readCacheEntry({ ...base, v: 3 })).toBeNull();
    expect(readCacheEntry({ ...base })).toBeNull();
    expect(readCacheEntry(null)).toBeNull();
    expect(readCacheEntry("{}")).toBeNull();
    // A v2 missing the field that makes it a v2.
    expect(readCacheEntry({ ...base, v: 2 })).toBeNull();
    // A partial write that lost its results array.
    expect(readCacheEntry({ v: 2, cachedAt: 1, softExpiresAt: 2 })).toBeNull();
  });

  it("treats a v1 entry as never soft-expiring", () => {
    const entry = readCacheEntry({ ...base, v: 1 });
    expect(entry?.softExpiresAt).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps a v2 entry's own soft expiry", () => {
    const entry = readCacheEntry({ ...base, v: 2, softExpiresAt: 500 });
    expect(entry?.softExpiresAt).toBe(500);
    expect(entry?.cachedAt).toBe(1);
  });
});

describe("CACHE_MAX_AGE_MS", () => {
  it("is past the longest TTL bucket, so nothing is dropped while still fresh", () => {
    expect(CACHE_MAX_AGE_MS).toBeGreaterThan(CACHE_TTL_SECONDS.long * 1000);
  });
});
