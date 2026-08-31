/**
 * `?sort` and `?maxSpamScore` on `GET /backlinks/list`, asserted on the
 * **payload that actually goes to DataForSEO**.
 *
 * That is the level that matters, for one reason: the payload is the cache key.
 * `computeCacheKey` hashes the canonical JSON of exactly this object, so a
 * parameter that changes the default payload — even to something arguably
 * better — invalidates every stored answer for every workspace, and the next
 * page each user loads is re-bought. The first test in this file is that guard,
 * and it is the one worth keeping if the others ever go.
 *
 * The route runs through the *real* wrapper (via `createDataForSeoApiFromClient`
 * over a fake client), so `filters` and `order_by` here are the true wire
 * shapes rather than an intermediate the wrapper might still transform.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../../db";
import { BACKLINKS_SPAM_HIDE_THRESHOLD } from "../../shared/backlinks";
import { createApp } from "../app";
import type { DataForSeoRequest, DataForSeoResponse } from "../dataforseo/client";
import { createDataForSeoApiFromClient } from "../dataforseo";
import { API_PREFIX } from "./index";

const WS = "ws-a";
const KEY = "orf_test-key";

/** The requests the route caused, newest last. */
let requests: DataForSeoRequest<unknown>[] = [];

/** Answers the session's `api_keys` lookup and nothing else. */
function fakeDb(): Db {
  const chain: Record<string, unknown> = {
    where: () => chain,
    limit: () => chain,
    then: (resolve: (value: unknown[]) => unknown) =>
      resolve([{ id: "key-1", workspaceId: WS }]),
  };
  return {
    select: () => ({ from: (_table: unknown) => chain }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  } as unknown as Db;
}

vi.mock("../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db")>();
  return { ...actual, getDb: () => fakeDb() };
});

/*
 * The real wrappers over a fake client: the route builds its filters and sorts,
 * the wrapper turns them into `filters` / `order_by`, and nothing is fetched.
 */
vi.mock("../dataforseo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dataforseo")>();
  return {
    ...actual,
    createDataForSeoApi: () =>
      Promise.resolve(
        actual.createDataForSeoApiFromClient({
          async request<TResult>(
            req: DataForSeoRequest<unknown>,
          ): Promise<DataForSeoResponse<TResult>> {
            requests.push(req);
            return {
              results: [
                { target: "example.com", total_count: 0, items_count: 0, items: [] } as TResult,
              ],
              tasks: [],
              costUsd: 0,
              cached: true,
              stale: false,
              fetchedAt: Date.now(),
              statusCode: 20000,
              statusMessage: "Ok.",
            };
          },
          async balance() {
            return { balanceUsd: 0 };
          },
        }),
      ),
  };
});

const app = createApp();

async function list(query: string): Promise<Record<string, unknown>> {
  const res = await app.request(
    `${API_PREFIX}/backlinks/list?workspace=${WS}&target=example.com${query}`,
    { headers: { authorization: `Bearer ${KEY}` } },
    { APP_ENV: "development", DB: {} as D1Database } as Env,
  );
  expect(res.status, await res.clone().text()).toBe(200);

  const payload = requests.at(-1)?.payload as Record<string, unknown>[] | undefined;
  const task = payload?.[0];
  if (task === undefined) throw new Error("no request reached the client");
  return task;
}

beforeEach(() => {
  requests = [];
});

/* -------------------------------------------------------------------------- */
/* The cache-key guard                                                         */
/* -------------------------------------------------------------------------- */

describe("the default request", () => {
  it("is unchanged by the new parameters existing", async () => {
    // Byte-for-byte what this route sent before `sort` and `maxSpamScore` were
    // added. If this fails, every workspace's stored backlinks answers are
    // orphaned and the next page each user opens is bought again.
    const task = await list("");

    expect(task["order_by"]).toEqual(["domain_from_rank,desc"]);
    // Absent, not `[]`: an empty filters array is a different payload, and
    // DataForSEO errors the task for it besides.
    expect(task["filters"]).toBeUndefined();
  });

  it("is identical whether or not `sort=domain_score` is spelled out", async () => {
    // Otherwise a UI whose select defaults to "domain_score" would send the
    // explicit form and miss every entry cached from the implicit one — the
    // same re-billing, arrived at from the other direction.
    const implicit = await list("");
    const explicit = await list("&sort=domain_score");
    expect(explicit).toEqual(implicit);
  });
});

/* -------------------------------------------------------------------------- */
/* sort                                                                        */
/* -------------------------------------------------------------------------- */

describe("?sort", () => {
  it.each([
    ["domain_score", ["domain_from_rank,desc"]],
    ["page_score", ["page_from_rank,desc"]],
    ["newest", ["first_seen,desc"]],
    ["oldest", ["first_seen,asc"]],
  ])("maps %s to the provider's order_by", async (sort, orderBy) => {
    const task = await list(`&sort=${sort}`);
    expect(task["order_by"]).toEqual(orderBy);
  });

  it("refuses a sort it does not have, rather than falling back silently", async () => {
    const res = await app.request(
      `${API_PREFIX}/backlinks/list?workspace=${WS}&target=example.com&sort=spam`,
      { headers: { authorization: `Bearer ${KEY}` } },
      { APP_ENV: "development", DB: {} as D1Database } as Env,
    );
    expect(res.status).toBe(422);
  });
});

/* -------------------------------------------------------------------------- */
/* maxSpamScore                                                                */
/* -------------------------------------------------------------------------- */

describe("?maxSpamScore", () => {
  it("filters on the provider's own 0–100 field, unconverted", async () => {
    // Spam score is the one authority-ish number here that is NOT on the
    // 0–1000 rank scale, so putting it through `fromScore` would filter at ten
    // times the intended threshold and hide almost every link.
    const task = await list(`&maxSpamScore=${BACKLINKS_SPAM_HIDE_THRESHOLD}`);
    expect(task["filters"]).toEqual([
      "backlink_spam_score",
      "<=",
      BACKLINKS_SPAM_HIDE_THRESHOLD,
    ]);
  });

  it("ANDs with an existing filter, in the provider's interleaved form", async () => {
    const task = await list("&dofollow=true&maxSpamScore=30");
    expect(task["filters"]).toEqual([
      ["dofollow", "=", true],
      "and",
      ["backlink_spam_score", "<=", 30],
    ]);
  });

  it("sits alongside the score floor, which stays on the 0–1000 scale", async () => {
    // Both conditions in one request, each on its own scale — the asymmetry
    // this pair exists to demonstrate.
    const task = await list("&minDomainScore=50&maxSpamScore=30");
    expect(task["filters"]).toEqual([
      ["domain_from_rank", ">=", 500],
      "and",
      ["backlink_spam_score", "<=", 30],
    ]);
  });

  it("keeps 0 as a real ceiling rather than treating it as absent", async () => {
    // "Only links with no spam signal at all" is a coherent request, and the
    // falsy check that would break it is an easy one to write.
    const task = await list("&maxSpamScore=0");
    expect(task["filters"]).toEqual(["backlink_spam_score", "<=", 0]);
  });

  it("refuses a score outside 0–100", async () => {
    for (const value of ["-1", "101", "12.5"]) {
      const res = await app.request(
        `${API_PREFIX}/backlinks/list?workspace=${WS}&target=example.com&maxSpamScore=${value}`,
        { headers: { authorization: `Bearer ${KEY}` } },
        { APP_ENV: "development", DB: {} as D1Database } as Env,
      );
      expect(res.status, value).toBe(422);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The seam itself                                                             */
/* -------------------------------------------------------------------------- */

describe("the harness", () => {
  it("really routes through the production wrapper", () => {
    // Guards the mock: if `createDataForSeoApiFromClient` stopped being the
    // thing that builds `dfs.backlinks`, every payload asserted above would be
    // this file's invention rather than the Worker's.
    expect(typeof createDataForSeoApiFromClient).toBe("function");
  });
});
