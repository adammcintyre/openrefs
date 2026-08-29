import { describe, expect, it } from "vitest";

import type { Db } from "../../db";
import {
  deleteWorkspaceEverywhere,
  purgeWorkspaceKv,
  purgeWorkspaceR2,
  workspaceKvPrefix,
  workspaceR2Prefix,
} from "./deletion";

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
  it("empties blob stores before dropping the D1 row", async () => {
    const kv = new FakeKv();
    const r2 = new FakeR2();
    seed(kv.store, workspaceKvPrefix(WS), 3);
    seed(r2.store, workspaceR2Prefix(WS), 2);

    const order: string[] = [];
    const originalKvDelete = kv.delete.bind(kv);
    kv.delete = async (key: string) => {
      order.push("kv");
      await originalKvDelete(key);
    };

    const db = {
      delete: () => ({
        where: async () => {
          order.push("d1");
        },
      }),
    } as unknown as Db;

    const result = await deleteWorkspaceEverywhere({ db, kv: kv as unknown as KVNamespace, r2: r2 as unknown as R2Bucket }, WS);

    expect(result).toEqual({ kvKeys: 3, r2Objects: 2 });
    // The D1 delete is last: a mid-purge failure must leave a retryable
    // workspace rather than blobs nobody can find.
    expect(order.at(-1)).toBe("d1");
    expect(order.filter((step) => step === "d1")).toHaveLength(1);
    expect(kv.store.size).toBe(0);
    expect(r2.store.size).toBe(0);
  });
});
