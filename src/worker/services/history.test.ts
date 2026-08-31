/**
 * The research trail's mechanics.
 *
 * Three things are worth pinning here, and they are the three that would each
 * be a distinct kind of bug:
 *
 *  - **Identity.** Two spellings of the same search must be one row, and two
 *    genuinely different searches must not be.
 *  - **Scoping.** Every statement this module builds must carry the workspace
 *    predicate. A read or a delete that trusts an id alone turns a row id into
 *    a capability across tenants, which is the one failure here with teeth.
 *  - **Harmlessness.** Recording must never fail or delay the search it
 *    describes, however badly D1 is behaving.
 *
 * Statements are asserted by rendering the SQL rather than by running it: these
 * tests run in plain Node with no D1 (see vitest.config.ts), and the predicate
 * is exactly the part worth reading anyway.
 */
import { drizzle } from "drizzle-orm/d1";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it, vi } from "vitest";

import type { Db } from "../../db";
import { schema, searchHistory } from "../../db";
import { HISTORY_KEEP } from "../../shared/history";
import {
  historyContext,
  historyQueryKey,
  moduleScope,
  prunePredicate,
  recordSearch,
  toHistoryEntry,
  writeSearch,
} from "./history";

const dialect = new SQLiteSyncDialect();

/**
 * A Drizzle instance with no working driver.
 *
 * Statements are built lazily, so `.toSQL()` never touches D1 — which is what
 * lets these tests read the SQL a real request would send without a database
 * to send it to.
 */
const builder = drizzle({} as D1Database, { schema });

const WS = "ws-1";
const OTHER = "ws-2";

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

describe("historyQueryKey", () => {
  it("is a sha256 hex digest", async () => {
    expect(await historyQueryKey({ keyword: "seo tools" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores key order — one search, however the object was built", async () => {
    const a = await historyQueryKey({ keyword: "seo", location: 2826, language: "en" });
    const b = await historyQueryKey({ language: "en", keyword: "seo", location: 2826 });
    expect(a).toBe(b);
  });

  it("separates searches that differ only in market", async () => {
    const uk = await historyQueryKey({ keyword: "seo", location: 2826, language: "en" });
    const us = await historyQueryKey({ keyword: "seo", location: 2840, language: "en" });
    expect(uk).not.toBe(us);
  });

  it("keeps competitor order significant — the columns move with it", async () => {
    // A gap comparison against [a, b] renders a different table from [b, a],
    // and a trail row has to reproduce the one that was actually run.
    const ab = await historyQueryKey({ target: "me.com", competitors: ["a.com", "b.com"] });
    const ba = await historyQueryKey({ target: "me.com", competitors: ["b.com", "a.com"] });
    expect(ab).not.toBe(ba);
  });

  it("does not confuse a number with its string form", async () => {
    const numeric = await historyQueryKey({ location: 2826 });
    const text = await historyQueryKey({ location: "2826" });
    expect(numeric).not.toBe(text);
  });
});

/* -------------------------------------------------------------------------- */
/* The upsert                                                                  */
/* -------------------------------------------------------------------------- */

describe("writeSearch", () => {
  /** Captures the statements a write would issue, without running any. */
  function recordingDb(): { db: Db; sql: string[] } {
    const sqlLog: string[] = [];
    const db = {
      insert(table: unknown) {
        return {
          values(values: unknown) {
            return {
              onConflictDoUpdate(config: unknown) {
                const built = builder
                  .insert(table as typeof searchHistory)
                  .values(values as never)
                  .onConflictDoUpdate(config as never);
                sqlLog.push(built.toSQL().sql);
                return Promise.resolve();
              },
            };
          },
        };
      },
      run(statement: Parameters<typeof dialect.sqlToQuery>[0]) {
        sqlLog.push(dialect.sqlToQuery(statement).sql);
        return Promise.resolve();
      },
    };
    return { db: db as unknown as Db, sql: sqlLog };
  }

  it("upserts on (workspace, module, query_key) — a repeat is not a new row", async () => {
    const { db, sql } = recordingDb();
    await writeSearch(db, WS, "keywords", { keyword: "seo" }, null);

    const [upsert] = sql;
    expect(upsert).toContain("insert into");
    expect(upsert).toContain('"search_history"');
    // Without this conflict target the unique index rejects the second run
    // instead of bumping the first.
    expect(upsert).toMatch(/on conflict.*workspace_id.*module.*query_key/is);
  });

  it("increments the stored hit count rather than resetting it", async () => {
    const { db, sql } = recordingDb();
    await writeSearch(db, WS, "keywords", { keyword: "seo" }, null);
    expect(sql[0]).toContain("hit_count + 1");
  });

  it("keeps an existing summary when the new run produced none", async () => {
    // The asymmetry that makes the list useful: a keyword the provider has
    // never heard of returns null metrics, and that null must not erase a
    // snapshot an earlier run captured.
    const { db, sql } = recordingDb();
    await writeSearch(db, WS, "keywords", { keyword: "seo" }, null);
    expect(sql[0]).toContain("COALESCE(excluded.summary, summary)");
  });

  it("prunes straight after the write, scoped to this workspace and module", async () => {
    const { db, sql } = recordingDb();
    await writeSearch(db, WS, "domains", { target: "example.com" }, null);

    expect(sql).toHaveLength(2);
    const prune = sql[1] as string;
    expect(prune).toContain("DELETE FROM search_history");
    expect(prune).toContain("workspace_id");
    expect(prune).toContain("module");
  });
});

describe("prunePredicate", () => {
  const rendered = dialect.sqlToQuery(prunePredicate(WS, "keywords"));

  it("keeps exactly HISTORY_KEEP rows, newest first", () => {
    expect(rendered.params).toContain(HISTORY_KEEP);
    expect(rendered.sql).toMatch(/order by\s+last_searched_at desc/i);
  });

  it("binds the workspace and module on both halves of the statement", () => {
    // The subquery is what decides which rows survive; scoping only the outer
    // DELETE would delete this workspace's rows to protect everyone's newest.
    expect(rendered.params.filter((value) => value === WS)).toHaveLength(2);
    expect(rendered.params.filter((value) => value === "keywords")).toHaveLength(2);
  });

  it("never widens past one module — another module's trail is not its business", () => {
    expect(rendered.params).not.toContain("domains");
    expect(rendered.params).not.toContain(OTHER);
  });
});

/* -------------------------------------------------------------------------- */
/* Harmlessness                                                                */
/* -------------------------------------------------------------------------- */

describe("recordSearch", () => {
  /** A db that fails at the first statement, as a broken D1 would. */
  function brokenDb(): Db {
    return {
      insert() {
        throw new Error("D1_ERROR: no such table");
      },
    } as unknown as Db;
  }

  it("swallows a failing write — the search itself already succeeded", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const deferred: Promise<unknown>[] = [];

    expect(() => {
      recordSearch(
        { db: brokenDb(), waitUntil: (p) => deferred.push(p) },
        WS,
        "keywords",
        { keyword: "seo" },
        null,
      );
    }).not.toThrow();

    // And the deferred work resolves rather than rejecting, so it cannot
    // surface later as an unhandled rejection either.
    await expect(Promise.all(deferred)).resolves.toBeDefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("hands the work to waitUntil, so the response does not wait on D1", () => {
    const deferred: Promise<unknown>[] = [];
    recordSearch(
      { db: brokenDb(), waitUntil: (p) => deferred.push(p) },
      WS,
      "keywords",
      { keyword: "seo" },
      null,
    );
    expect(deferred).toHaveLength(1);
  });

  it("still records, harmlessly, where the runtime offers no waitUntil", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => {
      recordSearch({ db: brokenDb() }, WS, "keywords", { keyword: "seo" }, null);
    }).not.toThrow();
    // Let the unawaited promise settle before restoring the spy.
    await Promise.resolve();
    logged.mockRestore();
  });
});

describe("historyContext", () => {
  it("takes waitUntil from the execution context when there is one", () => {
    const seen: Promise<unknown>[] = [];
    const ctx = historyContext(
      { executionCtx: { waitUntil: (p) => seen.push(p) } },
      {} as Db,
    );
    ctx.waitUntil?.(Promise.resolve());
    expect(seen).toHaveLength(1);
  });

  it("degrades rather than throwing when reading it throws", () => {
    // `c.executionCtx` throws in Hono when the runtime has none — which is
    // exactly what `app.request()` in a test is. A handler must not 500 over
    // its bookkeeping.
    const hostile = {
      get executionCtx(): { waitUntil: (p: Promise<unknown>) => void } {
        throw new Error("This context has no ExecutionContext");
      },
    };
    expect(() => historyContext(hostile, {} as Db)).not.toThrow();
    expect(historyContext(hostile, {} as Db).waitUntil).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Scoping and mapping                                                         */
/* -------------------------------------------------------------------------- */

describe("moduleScope", () => {
  it("binds the workspace id, so a list can never span tenants", () => {
    const rendered = dialect.sqlToQuery(moduleScope(WS, "gap"));
    expect(rendered.sql).toContain("workspace_id");
    expect(rendered.params).toContain(WS);
    expect(rendered.params).toContain("gap");
    expect(rendered.params).not.toContain(OTHER);
  });
});

describe("the single-row delete predicate", () => {
  // Built the way routes/history.ts builds it. The point of the test is the
  // conjunction: an id alone would let one workspace delete another's row.
  const rendered = dialect.sqlToQuery(
    builder.delete(searchHistory).where(moduleScope(WS, "keywords")).getSQL(),
  );

  it("always pairs the row predicate with the workspace", () => {
    expect(rendered.sql).toContain("workspace_id");
    expect(rendered.params).toContain(WS);
  });
});

describe("toHistoryEntry", () => {
  const row = {
    id: "h-1",
    module: "keywords" as const,
    paramsJson: JSON.stringify({ keyword: "seo", location: 2826, language: "en" }),
    summaryJson: JSON.stringify({ volume: 100, difficulty: 12, cpc: 1.5, intent: "informational" }),
    hitCount: 3,
    firstSearchedAt: new Date("2026-08-01T00:00:00.000Z"),
    lastSearchedAt: new Date("2026-08-29T09:30:00.000Z"),
  };

  it("parses the stored JSON and renders timestamps as ISO", () => {
    const entry = toHistoryEntry(row);
    expect(entry).toMatchObject({
      id: "h-1",
      module: "keywords",
      hitCount: 3,
      firstSearchedAt: "2026-08-01T00:00:00.000Z",
      lastSearchedAt: "2026-08-29T09:30:00.000Z",
    });
    expect(entry.params).toEqual({ keyword: "seo", location: 2826, language: "en" });
  });

  it("keeps a null summary null — it means 'nothing captured yet'", () => {
    expect(toHistoryEntry({ ...row, summaryJson: null }).summary).toBeNull();
  });

  it("costs one row its detail, not the panel, when the JSON is unreadable", () => {
    const broken = toHistoryEntry({ ...row, paramsJson: "{not json", summaryJson: "[]" });
    expect(broken.params).toEqual({});
    expect(broken.summary).toBeNull();
    expect(broken.id).toBe("h-1");
  });
});
