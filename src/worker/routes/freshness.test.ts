/**
 * Every research GET refuses `fresh` and `stale` together.
 *
 * The rule itself is tested in lib/research.test.ts; what this file tests is
 * **coverage**. `withFreshness` is applied per handler, so a route that gains a
 * `stale` parameter and forgets to apply it would pass every unit test and
 * still bill on a history click — a bug that shows up on an invoice rather than
 * in a stack trace. The list below is the reminder to wire both.
 *
 * A session is forged (as in history.test.ts) because these routes answer 401
 * before validation, on purpose: an anonymous caller must not learn whether
 * their query was well-formed. So proving the 422 needs a caller.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiKeys, type Db } from "../../db";
import { createApp } from "../app";
import { API_PREFIX } from "./index";

const WS = "ws-a";
const KEY = "orf_test-key";

/** Answers the session's `api_keys` lookup and nothing else. */
function fakeDb(): Db {
  const chain: Record<string, unknown> = {
    where: () => chain,
    limit: () => chain,
    orderBy: () => chain,
    then: (resolve: (value: unknown[]) => unknown) =>
      resolve([{ id: "key-1", workspaceId: WS }]),
  };
  return {
    select: () => ({ from: (table: unknown) => (table === apiKeys ? chain : chain) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  } as unknown as Db;
}

vi.mock("../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db")>();
  return { ...actual, getDb: () => fakeDb() };
});

const app = createApp();

async function get(path: string): Promise<Response> {
  return await app.request(
    `${API_PREFIX}${path}`,
    { headers: { authorization: `Bearer ${KEY}` } },
    { APP_ENV: "development", DB: {} as D1Database } as Env,
  );
}

/**
 * Every research GET that takes the pair, with enough of a query to reach the
 * freshness check. Adding a `stale` parameter to a route means adding it here.
 */
const RESEARCH_GETS = [
  "/keywords/overview?keyword=seo&location=2826&language=en",
  "/keywords/ideas?keyword=seo&location=2826&language=en",
  "/keywords/suggestions?keyword=seo&location=2826&language=en",
  "/keywords/related?keyword=seo&location=2826&language=en",
  "/keywords/serp?keyword=seo&location=2826&language=en",
  "/domains/overview?domain=example.com&location=2826&language=en",
  "/domains/history?domain=example.com&location=2826&language=en",
  "/domains/keywords?domain=example.com&location=2826&language=en",
  "/domains/pages?domain=example.com&location=2826&language=en",
  "/domains/competitors?domain=example.com&location=2826&language=en",
  "/domains/countries?domain=example.com&language=en",
  "/gap/keywords?target=me.com&competitors=rival.com&location=2826&language=en",
  "/gap/keywords/export.csv?target=me.com&competitors=rival.com&location=2826&language=en",
  "/gap/pages?pages=https://a.com/x&location=2826&language=en",
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fresh + stale together", () => {
  it.each(RESEARCH_GETS)("is a 422 on %s", async (path) => {
    const res = await get(`${path}&workspace=${WS}&fresh=true&stale=true`);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("validation_failed");
  });

  it("is refused before anything is bought", async () => {
    // The order matters more than the status: a 422 that arrives *after* a
    // provider call would have already spent the money the rule exists to
    // protect. Nothing can be fetched if `fetch` is never reached.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await get(
      `/keywords/overview?keyword=seo&location=2826&language=en&workspace=${WS}&fresh=true&stale=true`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("either flag on its own", () => {
  it.each(["fresh", "stale"])("is not a validation failure (%s)", async (flag) => {
    // These get further and fail for other reasons — no stored DataForSEO
    // credentials on this fake deployment — which is exactly the point: the
    // freshness rule must not have grown teeth beyond the contradictory pair.
    const res = await get(
      `/keywords/overview?keyword=seo&location=2826&language=en&workspace=${WS}&${flag}=true`,
    );
    expect(res.status).not.toBe(422);
  });
});
