import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../../db";
import { ApiException } from "../http";
import { encryptSecret } from "../lib/crypto";
import { projectPullCachePrefix } from "./reports";
import type { GscConnectionRow } from "./tokens";
import {
  GSC_TOKEN_TTL_SECONDS,
  accessTokenKey,
  brokenKey,
  clearConnectionCache,
  getAccessToken,
  isConnectionBroken,
  purgeProjectGscKv,
  revokeProjectGoogleToken,
  revokeWorkspaceGoogleTokens,
  tokenCacheTtl,
} from "./tokens";

const MASTER_KEY = "a".repeat(64);
const WS = "ws-1";
const PROJECT = "proj-1";
const CONFIG = { clientId: "client-id", clientSecret: "client-secret" };

/* -------------------------------------------------------------------------- */
/* Doubles                                                                     */
/* -------------------------------------------------------------------------- */

class FakeKv {
  readonly store = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();
  listCalls = 0;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, value);
    this.ttls.set(key, options?.expirationTtl);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.ttls.delete(key);
  }

  /**
   * KV's cursor is "continue **after** this key", not an offset — which is
   * exactly what makes deleting keys as you walk them safe, because removing a
   * key already returned cannot shift the pages still to come. Modelled
   * faithfully so a purge that assumed offsets would visibly skip keys here
   * rather than quietly "succeeding".
   */
  async list(options: { prefix?: string; cursor?: string; limit?: number }) {
    this.listCalls += 1;
    const { prefix = "", cursor, limit = 1000 } = options;

    const matching = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const remaining =
      cursor === undefined ? matching : matching.filter((key) => key > cursor);
    const items = remaining.slice(0, limit);
    const keys = items.map((name) => ({ name }));

    return remaining.length <= limit
      ? { keys, list_complete: true as const }
      : { keys, list_complete: false as const, cursor: items.at(-1) as string };
  }
}

function kvOf(): { kv: FakeKv; binding: KVNamespace } {
  const kv = new FakeKv();
  return { kv, binding: kv as unknown as KVNamespace };
}

/**
 * Enough of Drizzle's builder for `listWorkspaceConnections`:
 * `select().from().innerJoin().where()`, awaited.
 */
function fakeDb(rows: GscConnectionRow[] | Error): Db {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => {
            if (rows instanceof Error) throw rows;
            return rows;
          },
        }),
      }),
    }),
  } as unknown as Db;
}

/**
 * Enough of Drizzle's builder for `loadConnection`, which differs from the
 * sweep's query by a trailing `.limit(1)`:
 * `select().from().innerJoin().where().limit()`, awaited.
 */
function fakeProjectDb(rows: GscConnectionRow[] | Error): Db {
  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => {
              if (rows instanceof Error) throw rows;
              return rows;
            },
          }),
        }),
      }),
    }),
  } as unknown as Db;
}

/**
 * Google's documented responses, transcribed.
 *
 * The refresh-token exchange response is the code-exchange shape **minus
 * `refresh_token`** — Google's docs are explicit that a refresh never returns
 * a new one — so omitting it here is the realistic shape, not a shortcut.
 * `expires_in` is "the remaining lifetime of the access token in seconds";
 * their own example uses 3920, ours uses the more typical 3599.
 */
function refreshOk(accessToken = "ya29.access-token", expiresIn = 3599) {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      expires_in: expiresIn,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      token_type: "Bearer",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * The OAuth 2.0 error body Google returns on HTTP 400, per RFC 6749 §5.2 and
 * the shape shown verbatim in Google's limited-input-device guide. The
 * description is a terse reason phrase, exactly as documented.
 */
function invalidGrant() {
  return new Response(
    JSON.stringify({
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

describe("cache keys", () => {
  it("sit under the workspace prefix so deletion sweeps them", () => {
    // CLAUDE.md hard rule #6: workspace data in KV must be reachable by the
    // `ws:<id>:` prefix, or workspace deletion silently leaves it behind.
    expect(accessTokenKey(WS, PROJECT)).toBe(`ws:${WS}:gsc-token:${PROJECT}`);
    expect(brokenKey(WS, PROJECT)).toBe(`ws:${WS}:gsc-broken:${PROJECT}`);
    expect(accessTokenKey(WS, PROJECT).startsWith(`ws:${WS}:`)).toBe(true);
    expect(brokenKey(WS, PROJECT).startsWith(`ws:${WS}:`)).toBe(true);
  });

  it("keeps projects apart", () => {
    expect(accessTokenKey(WS, "a")).not.toBe(accessTokenKey(WS, "b"));
  });
});

describe("tokenCacheTtl", () => {
  it("caps at the documented ~50 minutes", () => {
    expect(tokenCacheTtl(3600)).toBe(GSC_TOKEN_TTL_SECONDS);
  });

  it("stays ten minutes inside an unusually short token's life", () => {
    expect(tokenCacheTtl(1200)).toBe(600);
  });

  it("never goes below KV's 60-second floor", () => {
    expect(tokenCacheTtl(0)).toBe(60);
    expect(tokenCacheTtl(605)).toBe(60);
  });
});

/* -------------------------------------------------------------------------- */

describe("getAccessToken", () => {
  async function ctx() {
    const { kv, binding } = kvOf();
    return {
      kv,
      ctx: {
        kv: binding,
        masterKey: MASTER_KEY,
        config: CONFIG,
        workspaceId: WS,
        projectId: PROJECT,
      },
      enc: await encryptSecret(MASTER_KEY, "1//refresh-token"),
    };
  }

  it("serves a cached token without calling Google", async () => {
    const { kv, ctx: context, enc } = await ctx();
    await kv.put(accessTokenKey(WS, PROJECT), "cached-token");

    await expect(getAccessToken(context, enc)).resolves.toBe("cached-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes on a miss and caches the result", async () => {
    const { kv, ctx: context, enc } = await ctx();
    fetchMock.mockResolvedValue(refreshOk("ya29.fresh"));

    await expect(getAccessToken(context, enc)).resolves.toBe("ya29.fresh");
    expect(kv.store.get(accessTokenKey(WS, PROJECT))).toBe("ya29.fresh");
    // 3599 - 600. The ten-minute safety margin binds before the 50-minute cap
    // does for a token of Google's usual length, so the cached entry always
    // dies comfortably before the token it holds.
    const ttl = kv.ttls.get(accessTokenKey(WS, PROJECT)) as number;
    expect(ttl).toBe(2999);
    expect(ttl).toBeLessThanOrEqual(GSC_TOKEN_TTL_SECONDS);
    expect(ttl).toBeLessThan(3599);
  });

  it("posts a form-encoded refresh_token grant, secret included", async () => {
    const { ctx: context, enc } = await ctx();
    fetchMock.mockResolvedValue(refreshOk());

    await getAccessToken(context, enc);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );

    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("1//refresh-token");
    expect(body.get("client_id")).toBe(CONFIG.clientId);
    // Google's table marks client_secret "Optional" — that is the public-client
    // wording. A confidential web client that omits it gets invalid_client.
    expect(body.get("client_secret")).toBe(CONFIG.clientSecret);
    // `redirect_uri` is not a parameter of this grant type.
    expect(body.get("redirect_uri")).toBeNull();
  });

  it("never sends the encrypted token to Google — only the plaintext", async () => {
    const { ctx: context, enc } = await ctx();
    fetchMock.mockResolvedValue(refreshOk());

    await getAccessToken(context, enc);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).not.toContain(enc);
  });

  it("marks the connection broken on invalid_grant and asks for a reconnect", async () => {
    const { kv, ctx: context, enc } = await ctx();
    fetchMock.mockResolvedValue(invalidGrant());

    await expect(getAccessToken(context, enc)).rejects.toMatchObject({
      code: "gsc_reconnect_required",
    });
    await expect(isConnectionBroken(kv as unknown as KVNamespace, WS, PROJECT))
      .resolves.toBe(true);
    // Nothing usable was cached.
    expect(kv.store.get(accessTokenKey(WS, PROJECT))).toBeUndefined();
  });

  it("clears a stale broken mark once a refresh succeeds", async () => {
    const { kv, ctx: context, enc } = await ctx();
    await kv.put(brokenKey(WS, PROJECT), "1");
    fetchMock.mockResolvedValue(refreshOk());

    await getAccessToken(context, enc);

    await expect(isConnectionBroken(kv as unknown as KVNamespace, WS, PROJECT))
      .resolves.toBe(false);
  });

  it("treats an undecryptable token as a reconnect, not a 500", async () => {
    // A rotated APP_MASTER_KEY, or a corrupted row. Reconnecting is the only
    // fix, so it gets the reconnect signal — and Google is never called.
    const { kv, ctx: context } = await ctx();
    const foreign = await encryptSecret("b".repeat(64), "1//other-key");

    await expect(getAccessToken(context, foreign)).rejects.toMatchObject({
      code: "gsc_reconnect_required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(isConnectionBroken(kv as unknown as KVNamespace, WS, PROJECT))
      .resolves.toBe(true);
  });

  it("does not mark broken for a transient Google failure", async () => {
    // A 500 is not evidence the grant is dead; marking it broken would show a
    // reconnect CTA for a connection that is perfectly fine.
    const { kv, ctx: context, enc } = await ctx();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "internal_failure" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(getAccessToken(context, enc)).rejects.toMatchObject({
      code: "gsc_error",
    });
    await expect(isConnectionBroken(kv as unknown as KVNamespace, WS, PROJECT))
      .resolves.toBe(false);
  });

  it("maps a timeout to upstream_timeout, not a dead grant", async () => {
    const { ctx: context, enc } = await ctx();
    fetchMock.mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    );

    await expect(getAccessToken(context, enc)).rejects.toMatchObject({
      code: "upstream_timeout",
    });
  });

  it("reports a bad client secret as a configuration fault", async () => {
    const { ctx: context, enc } = await ctx();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "The OAuth client was not found.",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );

    const err = await getAccessToken(context, enc).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiException);
    expect((err as ApiException).code).toBe("gsc_error");
    expect((err as ApiException).message).toContain("GOOGLE_CLIENT_ID");
  });
});

describe("clearConnectionCache", () => {
  it("drops both the access token and the broken mark", async () => {
    const { kv, binding } = kvOf();
    await kv.put(accessTokenKey(WS, PROJECT), "token");
    await kv.put(brokenKey(WS, PROJECT), "1");

    await clearConnectionCache(binding, WS, PROJECT);

    expect(kv.store.size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("purgeProjectGscKv", () => {
  /** A cached report pull, under the key shape `pullCacheKey` produces. */
  function reportKey(projectId: string, suffix: string): string {
    return `${projectPullCachePrefix(WS, projectId)}${suffix}`;
  }

  it("takes all three key shapes a connection leaves behind", async () => {
    // None of these is reachable from D1: the project row cascades away and
    // leaves a usable access token behind for up to 50 minutes, plus a day of
    // a deleted project's Search Console data.
    const { kv, binding } = kvOf();
    await kv.put(accessTokenKey(WS, PROJECT), "ya29.still-valid");
    await kv.put(brokenKey(WS, PROJECT), "1");
    await kv.put(reportKey(PROJECT, "hash:query:2026-01-01:2026-01-28"), "[]");
    await kv.put(reportKey(PROJECT, "hash:page:2026-01-01:2026-01-28"), "[]");

    const deleted = await purgeProjectGscKv(binding, WS, PROJECT);

    // Only the report cache is countable — see the function's own note.
    expect(deleted).toBe(2);
    expect(kv.store.size).toBe(0);
  });

  it("leaves every other project in the workspace alone", async () => {
    const { kv, binding } = kvOf();
    await kv.put(accessTokenKey(WS, PROJECT), "mine");
    await kv.put(accessTokenKey(WS, "proj-2"), "theirs");
    await kv.put(brokenKey(WS, "proj-2"), "1");
    await kv.put(reportKey("proj-2", "hash:query:2026-01-01:2026-01-28"), "[]");

    await purgeProjectGscKv(binding, WS, PROJECT);

    expect([...kv.store.keys()].sort()).toEqual(
      [
        accessTokenKey(WS, "proj-2"),
        brokenKey(WS, "proj-2"),
        reportKey("proj-2", "hash:query:2026-01-01:2026-01-28"),
      ].sort(),
    );
  });

  it("does not let one project id prefix-match another", async () => {
    // `proj-1` is a prefix of `proj-10`; the trailing colon in the key shape is
    // the only thing keeping deleting one from emptying the other.
    const { kv, binding } = kvOf();
    await kv.put(reportKey("proj-1", "hash:query:a:b"), "[]");
    await kv.put(reportKey("proj-10", "hash:query:a:b"), "[]");

    const deleted = await purgeProjectGscKv(binding, WS, "proj-1");

    expect(deleted).toBe(1);
    expect([...kv.store.keys()]).toEqual([reportKey("proj-10", "hash:query:a:b")]);
  });

  it("follows the cursor rather than stopping at the first page", async () => {
    const { kv, binding } = kvOf();
    for (let i = 0; i < 2500; i++) {
      // Zero-padded so lexicographic order matches numeric order, as KV lists.
      await kv.put(reportKey(PROJECT, `hash:query:${String(i).padStart(5, "0")}`), "[]");
    }

    const deleted = await purgeProjectGscKv(binding, WS, PROJECT);

    expect(deleted).toBe(2500);
    expect(kv.store.size).toBe(0);
    // 2500 keys at 1000 a page: three pages, so the cursor was honoured.
    expect(kv.listCalls).toBe(3);
  });

  it("is harmless for a project that never connected", async () => {
    const { kv, binding } = kvOf();
    await expect(purgeProjectGscKv(binding, WS, PROJECT)).resolves.toBe(0);
    expect(kv.store.size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("revokeProjectGoogleToken", () => {
  async function connection(token: string): Promise<GscConnectionRow> {
    return {
      projectId: PROJECT,
      refreshTokenEnc: await encryptSecret(MASTER_KEY, token),
      property: "sc-domain:example.com",
      connectedBy: "user-1",
    };
  }

  it("posts the project's token to Google's revoke endpoint", async () => {
    const db = fakeProjectDb([await connection("1//project-token")]);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      revokeProjectGoogleToken(db, MASTER_KEY, WS, PROJECT),
    ).resolves.toEqual({ attempted: 1, revoked: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(init.body as string).get("token")).toBe(
      "1//project-token",
    );
  });

  it("makes no network call for a project with no connection", async () => {
    await expect(
      revokeProjectGoogleToken(fakeProjectDb([]), MASTER_KEY, WS, PROJECT),
    ).resolves.toEqual({ attempted: 0, revoked: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts an already-revoked token as attempted but not revoked", async () => {
    const db = fakeProjectDb([await connection("1//dead")]);
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));

    await expect(
      revokeProjectGoogleToken(db, MASTER_KEY, WS, PROJECT),
    ).resolves.toEqual({ attempted: 1, revoked: 0 });
  });

  it("never throws when Google is unreachable", async () => {
    const db = fakeProjectDb([await connection("1//token")]);
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      revokeProjectGoogleToken(db, MASTER_KEY, WS, PROJECT),
    ).resolves.toEqual({ attempted: 1, revoked: 0 });
  });

  it("reports an undecryptable token as attempted, and sends nothing", async () => {
    const db = fakeProjectDb([
      {
        projectId: PROJECT,
        refreshTokenEnc: await encryptSecret("c".repeat(64), "1//other-key"),
        property: "",
        connectedBy: null,
      },
    ]);

    await expect(
      revokeProjectGoogleToken(db, MASTER_KEY, WS, PROJECT),
    ).resolves.toEqual({ attempted: 1, revoked: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("survives the lookup itself failing", async () => {
    // Deleting a project must not fail because this query blew up.
    await expect(
      revokeProjectGoogleToken(
        fakeProjectDb(new Error("no such table")),
        MASTER_KEY,
        WS,
        PROJECT,
      ),
    ).resolves.toEqual({ attempted: 0, revoked: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */

describe("revokeWorkspaceGoogleTokens", () => {
  async function connection(token: string): Promise<GscConnectionRow> {
    return {
      projectId: PROJECT,
      refreshTokenEnc: await encryptSecret(MASTER_KEY, token),
      property: "sc-domain:example.com",
      connectedBy: "user-1",
    };
  }

  it("posts each token to Google's revoke endpoint", async () => {
    const db = fakeDb([await connection("1//token-a")]);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      revokeWorkspaceGoogleTokens(db, MASTER_KEY, WS),
    ).resolves.toEqual({ attempted: 1, revoked: 1 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    // The token goes in the body, not the query string, so it never lands in
    // a URL that could be logged by an intermediary.
    expect(new URLSearchParams(init.body as string).get("token")).toBe(
      "1//token-a",
    );
  });

  it("counts an already-revoked token as attempted but not revoked", async () => {
    // Google documents HTTP 400 for "error conditions", which includes a token
    // that is already invalid — indistinguishable from one that never was.
    const db = fakeDb([await connection("1//dead")]);
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));

    await expect(
      revokeWorkspaceGoogleTokens(db, MASTER_KEY, WS),
    ).resolves.toEqual({ attempted: 1, revoked: 0 });
  });

  it("keeps going when one revocation fails", async () => {
    const db = fakeDb([
      await connection("1//first"),
      { ...(await connection("1//second")), projectId: "proj-2" },
      { ...(await connection("1//third")), projectId: "proj-3" },
    ]);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(
      revokeWorkspaceGoogleTokens(db, MASTER_KEY, WS),
    ).resolves.toEqual({ attempted: 3, revoked: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never throws when Google is completely unreachable", async () => {
    const db = fakeDb([await connection("1//token")]);
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      revokeWorkspaceGoogleTokens(db, MASTER_KEY, WS),
    ).resolves.toEqual({ attempted: 1, revoked: 0 });
  });

  it("skips a token it cannot decrypt rather than failing the sweep", async () => {
    const db = fakeDb([
      {
        projectId: PROJECT,
        refreshTokenEnc: await encryptSecret("c".repeat(64), "1//other-key"),
        property: "",
        connectedBy: null,
      },
      { ...(await connection("1//good")), projectId: "proj-2" },
    ]);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await expect(
      revokeWorkspaceGoogleTokens(db, MASTER_KEY, WS),
    ).resolves.toEqual({ attempted: 2, revoked: 1 });
    // Only the readable one was ever sent.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("survives the lookup itself failing", async () => {
    // A workspace with no Search Console connections must not fail to delete
    // because this query blew up.
    const db = fakeDb(new Error("no such table"));

    await expect(
      revokeWorkspaceGoogleTokens(db, MASTER_KEY, WS),
    ).resolves.toEqual({ attempted: 0, revoked: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no network call for a workspace with no connections", async () => {
    await expect(
      revokeWorkspaceGoogleTokens(fakeDb([]), MASTER_KEY, WS),
    ).resolves.toEqual({ attempted: 0, revoked: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
