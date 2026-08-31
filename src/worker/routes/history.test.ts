/**
 * `/api/v1/history` at the HTTP layer: what it validates, what it answers, and
 * — the part with teeth — what it refuses to let one workspace do to another's
 * rows.
 *
 * D1 is faked rather than run (see vitest.config.ts). The double records the
 * predicate each statement was built with, so the scoping assertions read the
 * actual `WHERE` a real request would send rather than trusting the handler's
 * shape. The SQL semantics themselves — the upsert, the prune — are pinned in
 * services/history.test.ts.
 *
 * Sessions are forged as API keys: `requireWorkspaceRole` short-circuits on
 * `session.workspaceId !== workspaceId` for those, which is exactly the
 * cross-tenant refusal worth testing here, and it needs no membership fixture.
 */
import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiKeys, searchHistory, type Db } from "../../db";
import { HISTORY_MAX_LIMIT } from "../../shared/history";
import { createApp } from "../app";
import { sha256Hex } from "../lib/crypto";
import { API_PREFIX } from "./index";

const dialect = new SQLiteSyncDialect();

/* --------------------------------- doubles -------------------------------- */

interface Recorded {
  kind: "select" | "count" | "delete";
  table: unknown;
  where: SQL | undefined;
  limit?: number;
}

interface FakeState {
  /** Rows the `search_history` row query resolves to. */
  rows: unknown[];
  /** What the count query reports. */
  total: number;
  /** Rows a delete claims to have removed. */
  deleted: { id: string }[];
  /** The workspace the presented API key belongs to. */
  keyWorkspaceId: string;
  recorded: Recorded[];
}

let state: FakeState;

/**
 * A Db covering exactly the chains this module builds.
 *
 * `where` is recorded rather than evaluated: filtering in memory would test the
 * double, whereas rendering the predicate tests the statement. Rows are served
 * per table, so the session's `api_keys` lookup and the handler's own query
 * cannot be confused for one another.
 */
function fakeDb(): Db {
  const db = {
    select: (columns: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const entry: Recorded = {
          // A `{ total }` projection is the count query; anything else is rows.
          kind: "total" in columns ? "count" : "select",
          table,
          where: undefined,
        };
        const rowsFor = (): unknown[] => {
          if (table === apiKeys) {
            return [{ id: "key-1", workspaceId: state.keyWorkspaceId }];
          }
          return entry.kind === "count" ? [{ total: state.total }] : state.rows;
        };
        const chain: Record<string, unknown> = {
          where: (predicate: SQL | undefined) => {
            entry.where = predicate;
            state.recorded.push(entry);
            return chain;
          },
          orderBy: () => chain,
          limit: (value: number) => {
            entry.limit = value;
            return chain;
          },
          then: (resolve: (value: unknown[]) => unknown) => resolve(rowsFor()),
        };
        return chain;
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: (table: unknown) => ({
      where: (predicate: SQL | undefined) => {
        state.recorded.push({ kind: "delete", table, where: predicate });
        return {
          returning: () => Promise.resolve(state.deleted),
        };
      },
    }),
  };
  return db as unknown as Db;
}

vi.mock("../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db")>();
  return { ...actual, getDb: () => fakeDb() };
});

/* --------------------------------- harness -------------------------------- */

const app = createApp();
const WS = "ws-a";
const OTHER = "ws-b";
const KEY = "orf_test-key";

/** A request carrying an API key minted for `workspaceId`. */
async function request(
  path: string,
  init: RequestInit = {},
  workspaceId = WS,
): Promise<Response> {
  state.keyWorkspaceId = workspaceId;
  const env = { APP_ENV: "development", DB: {} as D1Database } as Env;
  return await app.request(
    `${API_PREFIX}${path}`,
    { ...init, headers: { authorization: `Bearer ${KEY}`, ...init.headers } },
    env,
  );
}

/** The statements the handler itself built, ignoring the session lookup. */
function historyStatements(): Recorded[] {
  return state.recorded.filter((entry) => entry.table === searchHistory);
}

function params(entry: Recorded | undefined): unknown[] {
  if (entry?.where === undefined) throw new Error("statement had no predicate");
  return dialect.sqlToQuery(entry.where).params;
}

const ROW = {
  id: "h-1",
  module: "keywords",
  paramsJson: JSON.stringify({ keyword: "seo", location: 2826, language: "en" }),
  summaryJson: JSON.stringify({ volume: 90, difficulty: 4, cpc: null, intent: null }),
  hitCount: 2,
  firstSearchedAt: new Date("2026-08-01T00:00:00.000Z"),
  lastSearchedAt: new Date("2026-08-29T10:00:00.000Z"),
};

beforeEach(() => {
  state = { rows: [], total: 0, deleted: [], keyWorkspaceId: WS, recorded: [] };
});

/* ------------------------------- GET /history ----------------------------- */

describe("GET /api/v1/history", () => {
  it("needs a caller", async () => {
    const env = { APP_ENV: "development", DB: {} as D1Database } as Env;
    const res = await app.request(
      `${API_PREFIX}/history?workspace=${WS}&module=keywords`,
      undefined,
      env,
    );
    expect(res.status).toBe(401);
  });

  it("refuses a workspace the caller has no access to", async () => {
    // The cross-tenant case: a credential for ws-b asking for ws-a's trail.
    // Answered before any row is read, and 403 rather than 404 so the answer
    // is the same whether or not ws-a exists.
    const res = await request(`/history?workspace=${WS}&module=keywords`, {}, OTHER);
    expect(res.status).toBe(403);
    expect(historyStatements()).toEqual([]);
  });

  it("requires a module — a trail is always one module's", async () => {
    const res = await request(`/history?workspace=${WS}`);
    expect(res.status).toBe(422);
  });

  it("rejects a module it does not have", async () => {
    const res = await request(`/history?workspace=${WS}&module=backlinks`);
    expect(res.status).toBe(422);
  });

  it("scopes both the rows and the count to this workspace and module", async () => {
    await request(`/history?workspace=${WS}&module=gap`);

    const statements = historyStatements();
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(params(statement)).toContain(WS);
      expect(params(statement)).toContain("gap");
      expect(params(statement)).not.toContain(OTHER);
    }
  });

  it("returns the trail, with JSON parsed and timestamps as ISO", async () => {
    state.rows = [ROW];
    state.total = 7;

    const res = await request(`/history?workspace=${WS}&module=keywords`);
    expect(res.status).toBe(200);

    await expect(res.json()).resolves.toEqual({
      items: [
        {
          id: "h-1",
          module: "keywords",
          params: { keyword: "seo", location: 2826, language: "en" },
          summary: { volume: 90, difficulty: 4, cpc: null, intent: null },
          hitCount: 2,
          firstSearchedAt: "2026-08-01T00:00:00.000Z",
          lastSearchedAt: "2026-08-29T10:00:00.000Z",
        },
      ],
      // Bigger than `items` on purpose: `total` is what is stored, which is
      // what tells the panel a "show all" affordance has anything behind it.
      total: 7,
    });
  });

  it("clamps an over-large limit instead of refusing it", async () => {
    await request(`/history?workspace=${WS}&module=keywords&limit=9999`);
    const rowQuery = historyStatements().find((entry) => entry.kind === "select");
    expect(rowQuery?.limit).toBe(HISTORY_MAX_LIMIT);
  });

  it("rejects a limit that is not a positive integer", async () => {
    expect((await request(`/history?workspace=${WS}&module=keywords&limit=0`)).status).toBe(422);
    expect((await request(`/history?workspace=${WS}&module=keywords&limit=-4`)).status).toBe(422);
  });
});

/* ---------------------------- DELETE /history/:id ------------------------- */

describe("DELETE /api/v1/history/:id", () => {
  it("pairs the row id with the workspace, so an id is not a capability", async () => {
    state.deleted = [{ id: "h-1" }];
    const res = await request(`/history/h-1?workspace=${WS}`, { method: "DELETE" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: 1 });

    const bound = params(historyStatements()[0]);
    expect(bound).toContain("h-1");
    expect(bound).toContain(WS);
  });

  it("answers 404 for a row that is not in this workspace", async () => {
    // The double returns nothing, which is what the scoped delete would do for
    // a real row belonging to someone else — and the caller learns only that.
    state.deleted = [];
    const res = await request(`/history/h-9?workspace=${WS}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("refuses outright when the credential belongs to another workspace", async () => {
    state.deleted = [{ id: "h-1" }];
    const res = await request(
      `/history/h-1?workspace=${WS}`,
      { method: "DELETE" },
      OTHER,
    );
    expect(res.status).toBe(403);
    // Nothing was even attempted — the refusal precedes the statement.
    expect(historyStatements()).toEqual([]);
  });

  it("still requires a workspace", async () => {
    const res = await request("/history/h-1", { method: "DELETE" });
    expect(res.status).toBe(422);
  });
});

/* ------------------------------ DELETE /history --------------------------- */

describe("DELETE /api/v1/history", () => {
  it("clears one module's trail and reports how many rows went", async () => {
    state.deleted = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const res = await request(`/history?workspace=${WS}&module=domains`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: 3 });

    const bound = params(historyStatements()[0]);
    expect(bound).toContain(WS);
    expect(bound).toContain("domains");
  });

  it("succeeds with 0 on an empty trail — the caller asked for empty", async () => {
    state.deleted = [];
    const res = await request(`/history?workspace=${WS}&module=gap`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ deleted: 0 });
  });

  it("will not clear a module it cannot name", async () => {
    const res = await request(`/history?workspace=${WS}`, { method: "DELETE" });
    expect(res.status).toBe(422);
    expect(historyStatements()).toEqual([]);
  });

  it("refuses another workspace's trail", async () => {
    const res = await request(
      `/history?workspace=${WS}&module=keywords`,
      { method: "DELETE" },
      OTHER,
    );
    expect(res.status).toBe(403);
    expect(historyStatements()).toEqual([]);
  });
});

/* ----------------------------- the key lookup ----------------------------- */

describe("the forged session", () => {
  it("really is resolved from the api_keys table, hashed", async () => {
    // Guards the harness itself: if `loadSession` stopped hashing, or stopped
    // looking keys up at all, every test above would be asserting nothing.
    await request(`/history?workspace=${WS}&module=keywords`);
    const lookup = state.recorded.find((entry) => entry.table === apiKeys);
    expect(lookup).toBeDefined();
    expect(params(lookup)).toContain(await sha256Hex(KEY));
  });
});
