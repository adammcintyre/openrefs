import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../../db";
import { projects } from "../../db";
import {
  purgeProjectGscKv,
  revokeProjectGoogleToken,
  revokeWorkspaceGoogleTokens,
} from "../gsc/tokens";
import {
  deleteProjectEverywhere,
  deleteWorkspaceEverywhere,
  purgeWorkspaceKv,
  purgeWorkspaceR2,
  workspaceKvPrefix,
  workspaceR2Prefix,
} from "./deletion";

/**
 * The Search Console cleanups are stubbed here so this file can test the
 * *cascade's* contract — that they happen, before the rows go, and that they
 * cannot stop the deletion. Their own behaviour against a failing Google and a
 * real KV layout is tested in src/worker/gsc/tokens.test.ts.
 */
vi.mock("../gsc/tokens", () => ({
  revokeWorkspaceGoogleTokens: vi.fn(async () => ({
    attempted: 0,
    revoked: 0,
  })),
  revokeProjectGoogleToken: vi.fn(async () => ({ attempted: 0, revoked: 0 })),
  purgeProjectGscKv: vi.fn(async () => 0),
}));

const mockRevoke = vi.mocked(revokeWorkspaceGoogleTokens);
const mockRevokeProject = vi.mocked(revokeProjectGoogleToken);
const mockPurgeProjectKv = vi.mocked(purgeProjectGscKv);

beforeEach(() => {
  mockRevoke.mockReset();
  mockRevoke.mockResolvedValue({ attempted: 0, revoked: 0 });
  mockRevokeProject.mockReset();
  mockRevokeProject.mockResolvedValue({ attempted: 0, revoked: 0 });
  mockPurgeProjectKv.mockReset();
  mockPurgeProjectKv.mockResolvedValue(0);
});

const MASTER_KEY = "a".repeat(64);

const WS = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";

/**
 * Returns one page of sorted keys and the cursor to resume after.
 *
 * Both KV and R2 encode a cursor as "continue after this key", not as an
 * offset. That distinction is the whole reason `purge*` may delete as it
 * walks: removing keys it has already returned cannot shift the pages still to
 * come. A fake with offset cursors would skip half the store and quietly
 * "succeed", so the doubles below model the real semantics.
 */
function page(
  keys: Iterable<string>,
  prefix: string,
  cursor: string | undefined,
  limit: number,
): { items: string[]; nextCursor?: string } {
  const matching = [...keys].filter((k) => k.startsWith(prefix)).sort();
  const remaining =
    cursor === undefined ? matching : matching.filter((k) => k > cursor);
  const items = remaining.slice(0, limit);

  return remaining.length <= limit
    ? { items }
    : { items, nextCursor: items.at(-1) };
}

class FakeKv {
  readonly store = new Map<string, string>();
  listCalls = 0;

  async list(options: { prefix?: string; cursor?: string; limit?: number }) {
    this.listCalls += 1;
    const { items, nextCursor } = page(
      this.store.keys(),
      options.prefix ?? "",
      options.cursor,
      options.limit ?? 1000,
    );
    const keys = items.map((name) => ({ name }));

    return nextCursor === undefined
      ? { keys, list_complete: true as const }
      : { keys, list_complete: false as const, cursor: nextCursor };
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

class FakeR2 {
  readonly store = new Map<string, string>();
  deleteCalls: number[] = [];

  async list(options: { prefix?: string; cursor?: string; limit?: number }) {
    const { items, nextCursor } = page(
      this.store.keys(),
      options.prefix ?? "",
      options.cursor,
      options.limit ?? 1000,
    );
    const objects = items.map((key) => ({ key }));

    return nextCursor === undefined
      ? { objects, truncated: false as const }
      : { objects, truncated: true as const, cursor: nextCursor };
  }

  async delete(keys: string | string[]) {
    const list = Array.isArray(keys) ? keys : [keys];
    this.deleteCalls.push(list.length);
    for (const key of list) this.store.delete(key);
  }
}

/** Zero-padded so lexicographic order matches numeric order. */
function seed(store: Map<string, string>, prefix: string, count: number): void {
  for (let i = 0; i < count; i++) {
    store.set(`${prefix}entry-${String(i).padStart(5, "0")}`, "x");
  }
}

describe("prefixes", () => {
  it("match the documented KV and R2 layouts", () => {
    expect(workspaceKvPrefix(WS)).toBe(`ws:${WS}:`);
    expect(workspaceR2Prefix(WS)).toBe(`ws:${WS}/`);
  });

  it("cannot collide across workspaces", () => {
    expect(workspaceKvPrefix(WS).startsWith(workspaceKvPrefix(OTHER))).toBe(false);
  });
});

describe("purgeWorkspaceKv", () => {
  it("deletes every page, not just the first", async () => {
    const kv = new FakeKv();
    seed(kv.store, workspaceKvPrefix(WS), 2500);

    const deleted = await purgeWorkspaceKv(kv as unknown as KVNamespace, WS);

    expect(deleted).toBe(2500);
    expect(kv.store.size).toBe(0);
    // 2500 keys at 1000 per page: three pages, so the cursor was followed.
    expect(kv.listCalls).toBe(3);
  });

  it("leaves other workspaces alone", async () => {
    const kv = new FakeKv();
    seed(kv.store, workspaceKvPrefix(WS), 10);
    seed(kv.store, workspaceKvPrefix(OTHER), 7);
    kv.store.set("unrelated:key", "x");

    const deleted = await purgeWorkspaceKv(kv as unknown as KVNamespace, WS);

    expect(deleted).toBe(10);
    expect(kv.store.size).toBe(8);
    expect([...kv.store.keys()].every((k) => !k.startsWith(workspaceKvPrefix(WS)))).toBe(true);
  });

  it("is a no-op on an empty namespace", async () => {
    const kv = new FakeKv();
    await expect(purgeWorkspaceKv(kv as unknown as KVNamespace, WS)).resolves.toBe(0);
  });
});

describe("purgeWorkspaceR2", () => {
  it("deletes every page in batches of at most 1000", async () => {
    const r2 = new FakeR2();
    seed(r2.store, workspaceR2Prefix(WS), 2300);

    const deleted = await purgeWorkspaceR2(r2 as unknown as R2Bucket, WS);

    expect(deleted).toBe(2300);
    expect(r2.store.size).toBe(0);
    expect(r2.deleteCalls).toEqual([1000, 1000, 300]);
  });

  it("leaves other workspaces alone", async () => {
    const r2 = new FakeR2();
    seed(r2.store, workspaceR2Prefix(WS), 5);
    seed(r2.store, workspaceR2Prefix(OTHER), 4);

    await purgeWorkspaceR2(r2 as unknown as R2Bucket, WS);

    expect(r2.store.size).toBe(4);
  });

  it("never calls delete with an empty batch", async () => {
    const r2 = new FakeR2();
    await purgeWorkspaceR2(r2 as unknown as R2Bucket, WS);
    expect(r2.deleteCalls).toEqual([]);
  });
});

describe("deleteWorkspaceEverywhere", () => {
  /** A db whose only job is to record when the workspace row was dropped. */
  function trackingDb(order: string[]): Db {
    return {
      delete: () => ({
        where: async () => {
          order.push("d1");
        },
      }),
    } as unknown as Db;
  }

  function stores(order: string[]) {
    const kv = new FakeKv();
    const r2 = new FakeR2();
    const originalKvDelete = kv.delete.bind(kv);
    kv.delete = async (key: string) => {
      order.push("kv");
      await originalKvDelete(key);
    };
    return { kv, r2 };
  }

  it("empties blob stores before dropping the D1 row", async () => {
    const order: string[] = [];
    const { kv, r2 } = stores(order);
    seed(kv.store, workspaceKvPrefix(WS), 3);
    seed(r2.store, workspaceR2Prefix(WS), 2);

    const result = await deleteWorkspaceEverywhere(
      {
        db: trackingDb(order),
        kv: kv as unknown as KVNamespace,
        r2: r2 as unknown as R2Bucket,
        masterKey: MASTER_KEY,
      },
      WS,
    );

    expect(result).toEqual({
      kvKeys: 3,
      r2Objects: 2,
      googleGrants: { attempted: 0, revoked: 0 },
    });
    // The D1 delete is last: a mid-purge failure must leave a retryable
    // workspace rather than blobs nobody can find.
    expect(order.at(-1)).toBe("d1");
    expect(order.filter((step) => step === "d1")).toHaveLength(1);
    expect(kv.store.size).toBe(0);
    expect(r2.store.size).toBe(0);
  });

  it("revokes Google tokens BEFORE the cascade drops the rows holding them", async () => {
    // Ordering is the whole point: once the row is gone so is the encrypted
    // refresh token, and the grant would live on in the user's Google account
    // with nothing left able to revoke it.
    const order: string[] = [];
    const { kv, r2 } = stores(order);

    mockRevoke.mockImplementation(async () => {
      order.push("revoke");
      return { attempted: 2, revoked: 2 };
    });

    await deleteWorkspaceEverywhere(
      {
        db: trackingDb(order),
        kv: kv as unknown as KVNamespace,
        r2: r2 as unknown as R2Bucket,
        masterKey: MASTER_KEY,
      },
      WS,
    );

    expect(order.indexOf("revoke")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("revoke")).toBeLessThan(order.indexOf("d1"));
  });

  it("passes the master key through — the tokens are encrypted at rest", async () => {
    const { kv, r2 } = stores([]);
    await deleteWorkspaceEverywhere(
      {
        db: trackingDb([]),
        kv: kv as unknown as KVNamespace,
        r2: r2 as unknown as R2Bucket,
        masterKey: MASTER_KEY,
      },
      WS,
    );
    expect(mockRevoke).toHaveBeenCalledWith(
      expect.anything(),
      MASTER_KEY,
      WS,
    );
  });

  it("reports what Google accepted", async () => {
    const { kv, r2 } = stores([]);
    mockRevoke.mockResolvedValue({ attempted: 3, revoked: 1 });

    const result = await deleteWorkspaceEverywhere(
      {
        db: trackingDb([]),
        kv: kv as unknown as KVNamespace,
        r2: r2 as unknown as R2Bucket,
        masterKey: MASTER_KEY,
      },
      WS,
    );

    // attempted > revoked is normal: revocation is per Google account, so
    // several projects sharing one account are revoked by the first call.
    expect(result.googleGrants).toEqual({ attempted: 3, revoked: 1 });
  });

  it("still deletes everything when revocation throws outright", async () => {
    // The user asked for their data to be deleted. Google being unreachable —
    // or any other third-party failure — must not be able to veto that.
    const order: string[] = [];
    const { kv, r2 } = stores(order);
    seed(kv.store, workspaceKvPrefix(WS), 4);
    seed(r2.store, workspaceR2Prefix(WS), 3);

    mockRevoke.mockRejectedValue(new Error("google is down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await deleteWorkspaceEverywhere(
      {
        db: trackingDb(order),
        kv: kv as unknown as KVNamespace,
        r2: r2 as unknown as R2Bucket,
        masterKey: MASTER_KEY,
      },
      WS,
    );

    expect(result).toEqual({
      kvKeys: 4,
      r2Objects: 3,
      googleGrants: { attempted: 0, revoked: 0 },
    });
    // The row went, the blobs went, and the failure was logged rather than
    // thrown.
    expect(order).toContain("d1");
    expect(kv.store.size).toBe(0);
    expect(r2.store.size).toBe(0);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */

describe("deleteProjectEverywhere", () => {
  const PROJECT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  /** Records when the project row was dropped, and from which table. */
  function trackingDb(order: string[], tables: unknown[]): Db {
    return {
      delete: (table: unknown) => {
        tables.push(table);
        return {
          where: async () => {
            order.push("d1");
          },
        };
      },
    } as unknown as Db;
  }

  function stores(order: string[]) {
    mockRevokeProject.mockImplementation(async () => {
      order.push("revoke");
      return { attempted: 1, revoked: 1 };
    });
    mockPurgeProjectKv.mockImplementation(async () => {
      order.push("kv");
      return 3;
    });
    return {
      db: trackingDb(order, []),
      kv: {} as KVNamespace,
      masterKey: MASTER_KEY,
    };
  }

  it("revokes the grant BEFORE the cascade drops the row holding it", async () => {
    // `gsc_connections.project_id` cascades from `projects`, so the encrypted
    // refresh token dies with this DELETE. Revoking afterwards is not "late",
    // it is impossible — the grant would sit in the user's Google account with
    // nothing left able to revoke it.
    const order: string[] = [];

    const result = await deleteProjectEverywhere(stores(order), WS, PROJECT);

    expect(order.indexOf("revoke")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("revoke")).toBeLessThan(order.indexOf("d1"));
    expect(order.at(-1)).toBe("d1");
    expect(result).toEqual({
      reportCacheKeys: 3,
      googleGrants: { attempted: 1, revoked: 1 },
    });
  });

  it("purges KV before the row goes too", async () => {
    // Same argument, weaker consequence: a cached access token outliving its
    // project by up to 50 minutes, and a day of a deleted project's Search
    // Console data. Nothing in D1 can reach either afterwards.
    const order: string[] = [];

    await deleteProjectEverywhere(stores(order), WS, PROJECT);

    expect(order.indexOf("kv")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("kv")).toBeLessThan(order.indexOf("d1"));
  });

  it("deletes exactly one row, from projects", async () => {
    const order: string[] = [];
    const tables: unknown[] = [];

    await deleteProjectEverywhere(
      { db: trackingDb(order, tables), kv: {} as KVNamespace, masterKey: MASTER_KEY },
      WS,
      PROJECT,
    );

    expect(order.filter((step) => step === "d1")).toHaveLength(1);
    expect(tables).toEqual([projects]);
  });

  it("scopes both cleanups to the workspace, not the project id alone", async () => {
    // `gsc_connections` has no workspace column. Passing the project id on its
    // own would let another tenant's connection be found by id.
    await deleteProjectEverywhere(
      { db: trackingDb([], []), kv: {} as KVNamespace, masterKey: MASTER_KEY },
      WS,
      PROJECT,
    );

    expect(mockRevokeProject).toHaveBeenCalledWith(
      expect.anything(),
      MASTER_KEY,
      WS,
      PROJECT,
    );
    expect(mockPurgeProjectKv).toHaveBeenCalledWith(
      expect.anything(),
      WS,
      PROJECT,
    );
  });

  it("still deletes the project when revocation throws outright", async () => {
    // The user asked for their project to be deleted. Google being unreachable
    // must not be able to veto that.
    const order: string[] = [];
    mockRevokeProject.mockRejectedValue(new Error("google is down"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await deleteProjectEverywhere(
      { db: trackingDb(order, []), kv: {} as KVNamespace, masterKey: MASTER_KEY },
      WS,
      PROJECT,
    );

    expect(order).toContain("d1");
    expect(result.googleGrants).toEqual({ attempted: 0, revoked: 0 });
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("still deletes the project when the KV purge throws outright", async () => {
    const order: string[] = [];
    mockPurgeProjectKv.mockRejectedValue(new Error("kv unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await deleteProjectEverywhere(
      { db: trackingDb(order, []), kv: {} as KVNamespace, masterKey: MASTER_KEY },
      WS,
      PROJECT,
    );

    expect(order).toContain("d1");
    expect(result.reportCacheKeys).toBe(0);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("deletes the project even when both cleanups fail at once", async () => {
    const order: string[] = [];
    mockRevokeProject.mockRejectedValue(new Error("google is down"));
    mockPurgeProjectKv.mockRejectedValue(new Error("kv unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      deleteProjectEverywhere(
        { db: trackingDb(order, []), kv: {} as KVNamespace, masterKey: MASTER_KEY },
        WS,
        PROJECT,
      ),
    ).resolves.toEqual({
      reportCacheKeys: 0,
      googleGrants: { attempted: 0, revoked: 0 },
    });
    expect(order).toContain("d1");

    consoleError.mockRestore();
  });

  it("reports what Google accepted", async () => {
    mockRevokeProject.mockResolvedValue({ attempted: 1, revoked: 0 });

    const result = await deleteProjectEverywhere(
      { db: trackingDb([], []), kv: {} as KVNamespace, masterKey: MASTER_KEY },
      WS,
      PROJECT,
    );

    // attempted without revoked is the ordinary "Google said no" outcome — an
    // already-dead grant is indistinguishable from one that never existed.
    expect(result.googleGrants).toEqual({ attempted: 1, revoked: 0 });
  });
});
