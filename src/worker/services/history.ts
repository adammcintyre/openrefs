/**
 * The research trail: recording a search, and reading the trail back.
 *
 * Every successful Keyword Research, Domain Overview and Gap Analysis search is
 * recorded here, so the trail belongs to the workspace rather than to one
 * browser. Two properties shape everything in this file:
 *
 * 1. **Recording must never fail or slow a search.** A search that returned
 *    data has already cost the user money; losing that response because a
 *    bookkeeping write failed would be an appalling trade. So `recordSearch`
 *    swallows every error, and the routes hand it to `waitUntil` rather than
 *    awaiting it — the response goes out first and the row lands after.
 *
 * 2. **A repeat is an update, not a new row.** The identity of a search is its
 *    canonical params, hashed into `query_key`; running the same one again
 *    bumps `hit_count` and `last_searched_at`. That is what makes the list "the
 *    searches this workspace does" rather than a scroll of duplicates, and it
 *    is why reopening from history records too: reopening is a use, and a trail
 *    should surface what you actually come back to.
 */
import type { SQL } from "drizzle-orm";
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../../db";
import { searchHistory } from "../../db";
import type {
  HistoryEntry,
  HistoryListResponse,
  HistoryModule,
} from "../../shared/history";
import { HISTORY_KEEP } from "../../shared/history";
import { canonicalJson } from "../dataforseo/client";
import { ApiException } from "../http";
import { sha256Hex } from "../lib/crypto";

/**
 * The identity of a search: sha256 of the canonical JSON of its params.
 *
 * `canonicalJson` is the DataForSEO client's own key builder, reused
 * deliberately — it sorts object keys at every depth (so `{a,b}` and `{b,a}`
 * are one search) while preserving array order (so a reordered competitor list
 * is genuinely a different comparison, which it is: the columns move).
 */
export async function historyQueryKey(params: unknown): Promise<string> {
  return sha256Hex(canonicalJson(params));
}

/** What a route hands `recordSearch`: the db, and a way to defer the work. */
export interface HistoryRecordContext {
  db: Db;
  /**
   * `c.executionCtx.waitUntil`, when the runtime offers one.
   *
   * Optional because it genuinely is: the Workers runtime always has an
   * execution context, but `app.request()` in tests does not, and a missing
   * `waitUntil` must degrade to "record inline, still swallowing errors"
   * rather than throwing inside a handler that has already done its real work.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * A recording context from a Hono handler.
 *
 * Typed structurally rather than as `Context<AppEnv>` so this module keeps the
 * property every other service here has — it never imports Hono — while the
 * routes still get a one-liner. `c.executionCtx` *throws* when the runtime has
 * no execution context (which is exactly what `app.request()` in a test does),
 * so reading it needs the try, not a `?.`.
 */
export function historyContext(
  c: { executionCtx: { waitUntil: (promise: Promise<unknown>) => void } },
  db: Db,
): HistoryRecordContext {
  try {
    const ctx = c.executionCtx;
    return { db, waitUntil: (promise) => ctx.waitUntil(promise) };
  } catch {
    return { db };
  }
}

/**
 * Record one successful search, in the background.
 *
 * Deliberately returns `void` and never rejects. Callers must not await the
 * write for its own sake — see the note at the top of this file.
 */
export function recordSearch(
  ctx: HistoryRecordContext,
  workspaceId: string,
  module: HistoryModule,
  params: unknown,
  summary: unknown,
): void {
  const work = writeSearch(ctx.db, workspaceId, module, params, summary).catch(
    (err: unknown) => {
      // Logged, not raised: the search itself succeeded, and the user is
      // already holding the answer they paid for.
      console.error(
        JSON.stringify({
          level: "error",
          message: "search history write failed",
          workspaceId,
          module,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    },
  );

  if (ctx.waitUntil) {
    ctx.waitUntil(work);
    return;
  }
  // No execution context (tests, and any runtime that omits one): the promise
  // is already error-proofed, so letting it run unawaited is safe.
  void work;
}

/**
 * The upsert, then the prune. Exported for the tests; routes call
 * `recordSearch`, which is the one with the safety net.
 */
export async function writeSearch(
  db: Db,
  workspaceId: string,
  module: HistoryModule,
  params: unknown,
  summary: unknown,
): Promise<void> {
  const queryKey = await historyQueryKey(params);
  const now = new Date();
  const summaryJson = summary === undefined || summary === null ? null : JSON.stringify(summary);

  await db
    .insert(searchHistory)
    .values({
      workspaceId,
      module,
      queryKey,
      paramsJson: JSON.stringify(params),
      summaryJson,
      hitCount: 1,
      firstSearchedAt: now,
      lastSearchedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        searchHistory.workspaceId,
        searchHistory.module,
        searchHistory.queryKey,
      ],
      set: {
        // Unqualified column names inside an upsert's SET refer to the row
        // already stored; `excluded.` is SQLite's name for the one that lost
        // the conflict. Both halves of that distinction are load-bearing here.
        hitCount: sql`hit_count + 1`,
        lastSearchedAt: now,
        /*
         * COALESCE, not a plain overwrite: a search can legitimately return
         * nothing worth snapshotting (a keyword the provider has never heard
         * of), and letting that null erase a summary captured earlier would
         * make the list *less* informative every time someone revisits a row.
         */
        summaryJson: sql`COALESCE(excluded.summary, summary)`,
      },
    });

  await pruneHistory(db, workspaceId, module);
}

/**
 * Drop everything past the newest `HISTORY_KEEP` rows for this workspace and
 * module.
 *
 * Expressed as "delete the ids that are not in the newest N" rather than a
 * `LIMIT`-ed delete, because SQLite only supports `DELETE ... LIMIT` when
 * compiled with an option D1 does not set. The subquery is served by
 * `search_history_recent_idx`, and at 100 rows per module the cost is
 * irrelevant either way.
 */
export async function pruneHistory(
  db: Db,
  workspaceId: string,
  module: HistoryModule,
): Promise<void> {
  await db.run(prunePredicate(workspaceId, module));
}

/** The prune statement, separated so a test can read the SQL it will run. */
export function prunePredicate(workspaceId: string, module: HistoryModule) {
  return sql`
    DELETE FROM search_history
     WHERE workspace_id = ${workspaceId}
       AND module = ${module}
       AND id NOT IN (
             SELECT id FROM search_history
              WHERE workspace_id = ${workspaceId}
                AND module = ${module}
              ORDER BY last_searched_at DESC, id DESC
              LIMIT ${HISTORY_KEEP}
           )
  `;
}

/* -------------------------------------------------------------------------- */
/* Reading the trail                                                           */
/* -------------------------------------------------------------------------- */

/** The columns the list needs. Nothing here is secret, but nothing is spare. */
export const historyColumns = {
  id: searchHistory.id,
  module: searchHistory.module,
  paramsJson: searchHistory.paramsJson,
  summaryJson: searchHistory.summaryJson,
  hitCount: searchHistory.hitCount,
  firstSearchedAt: searchHistory.firstSearchedAt,
  lastSearchedAt: searchHistory.lastSearchedAt,
};

export interface HistoryRow {
  id: string;
  module: HistoryModule;
  paramsJson: string;
  summaryJson: string | null;
  hitCount: number;
  firstSearchedAt: Date;
  lastSearchedAt: Date;
}

/**
 * One stored row as the API shape.
 *
 * `params` and `summary` are parsed defensively: a row whose JSON somehow does
 * not parse costs itself its detail, not the whole panel.
 *
 * The cast is the one place this module trusts that what was written under a
 * module tag matches that module's shape. That trust is narrow and checkable:
 * the writers are three call sites in this codebase, each typed against the
 * matching `*HistoryParams`, and the client re-narrows by `module` anyway. The
 * alternative — re-validating every stored row against three zod schemas on
 * every list — would buy nothing except a way for an older row to vanish from
 * the panel after a shape change.
 */
export function toHistoryEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    module: row.module,
    params: parseJson(row.paramsJson) ?? {},
    summary: row.summaryJson === null ? null : (parseJson(row.summaryJson) ?? null),
    hitCount: row.hitCount,
    firstSearchedAt: row.firstSearchedAt.toISOString(),
    lastSearchedAt: row.lastSearchedAt.toISOString(),
  } as unknown as HistoryEntry;
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The workspace + module predicate every read and write in this module shares.
 *
 * One definition on purpose: scoping a list by workspace and a delete by id
 * alone is exactly how one tenant ends up able to erase another's row.
 *
 * Returns a non-optional `SQL` rather than Drizzle's `SQL | undefined`, because
 * `.where(undefined)` is a *silently unscoped statement* — on a DELETE that is
 * the whole table. Narrowing here means no call site can pass one on by
 * accident.
 */
export function moduleScope(workspaceId: string, module: HistoryModule): SQL {
  const scope = and(
    eq(searchHistory.workspaceId, workspaceId),
    eq(searchHistory.module, module),
  );
  if (scope === undefined) {
    // Unreachable: `and` answers undefined only when every operand is, and
    // both of these are always built. Loud rather than clever, because the
    // failure mode this guards is an unscoped DELETE.
    throw new ApiException(
      "internal_error",
      "Refusing to run an unscoped search-history statement.",
    );
  }
  return scope;
}

/** GET /api/v1/history — newest first, with the module's full row count. */
export async function listHistory(
  db: Db,
  workspaceId: string,
  module: HistoryModule,
  limit: number,
): Promise<HistoryListResponse> {
  const scope = moduleScope(workspaceId, module);

  const [rows, counted] = await Promise.all([
    db
      .select(historyColumns)
      .from(searchHistory)
      .where(scope)
      // `id` breaks ties so two searches recorded in the same millisecond have
      // a stable order across requests rather than swapping places.
      .orderBy(sql`${searchHistory.lastSearchedAt} DESC, ${searchHistory.id} DESC`)
      .limit(limit),
    db
      .select({ total: sql<number>`count(*)` })
      .from(searchHistory)
      .where(scope),
  ]);

  return {
    items: rows.map(toHistoryEntry),
    // What is stored, which can exceed what was returned — that difference is
    // what tells the UI a "show all" affordance has anything behind it.
    total: Number(counted[0]?.total ?? 0),
  };
}
