/**
 *   GET    /api/v1/collections               list, with keyword counts
 *   POST   /api/v1/collections               create
 *   GET    /api/v1/collections/:id           one collection, with keywords
 *   PATCH  /api/v1/collections/:id           rename
 *   DELETE /api/v1/collections/:id           delete (keywords cascade)
 *   POST   /api/v1/collections/:id/keywords  bulk add, idempotent, market-stamped
 *   DELETE /api/v1/collections/:id/keywords  bulk remove
 *   GET    /api/v1/collections/:id/export.csv
 *
 * Pure D1 — no DataForSEO call, no cost. Every route is workspace-scoped at
 * the `member` role and every query is filtered by workspace id, so a
 * collection id from another tenant reads as "not found" rather than leaking
 * its existence.
 */
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type {
  CollectionDeletedResponse,
  CollectionDetailResponse,
  CollectionKeywordsAddedResponse,
  CollectionKeywordsRemovedResponse,
  CollectionListResponse,
  CollectionMutationResponse,
  CollectionSummary,
} from "../../shared/collections";
import {
  COLLECTION_KEYWORDS_BULK_MAX,
  COLLECTION_NAME_MAX_LENGTH,
} from "../../shared/collections";
import type { Db } from "../../db";
import { collectionKeywords, collections } from "../../db";
import { ApiException } from "../http";
import { attachmentHeader, slugify, toCsv } from "../lib/csv";
import { authorizeWorkspace, workspaceParam } from "../lib/research";
import { readJson, readParams, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const collectionsRouter = new Hono<AppEnv>();

collectionsRouter.use("*", requireSession);

const workspaceQuerySchema = z.object({ workspace: workspaceParam });
const idParamSchema = z.object({ id: z.string().trim().min(1) });

const nameSchema = z
  .string()
  .trim()
  .min(1, "A collection needs a name.")
  .max(COLLECTION_NAME_MAX_LENGTH);

/**
 * A keyword entry in a bulk add. `volumeSnapshot` is optional because a
 * keyword can be saved from a context that has no volume to hand.
 */
const keywordEntrySchema = z.object({
  keyword: z.string().trim().min(1).max(700),
  volumeSnapshot: z.number().int().min(0).nullish(),
});

/**
 * The market to stamp on this batch, if the caller knows one.
 *
 * Optional, and one market per request rather than per keyword: a bulk add
 * comes from one screen showing one market's numbers, so the volume snapshots
 * in a single call are all from the same place. Omitting it stores null —
 * "unknown market" — which is exactly what an older client (or a save from a
 * context with no market, like a pasted list) should record rather than
 * inventing a default.
 */
const marketSchema = z.object({
  location: z.number().int().positive().optional(),
  language: z.string().trim().min(2).max(8).optional(),
});

export const bulkAddSchema = z
  .object({
    keywords: z.array(keywordEntrySchema).min(1).max(COLLECTION_KEYWORDS_BULK_MAX),
  })
  .extend(marketSchema.shape)
  /*
   * Both halves or neither. A location code with no language (or the reverse)
   * is not a market — every DataForSEO query needs both — and storing half of
   * one would produce rows that look stamped but cannot be used to re-run a
   * SERP.
   */
  .refine(
    (body) => (body.location === undefined) === (body.language === undefined),
    {
      message:
        "Give both `location` and `language`, or neither — half a market cannot be used.",
      path: ["location"],
    },
  );

const bulkRemoveSchema = z.object({
  keywords: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(COLLECTION_KEYWORDS_BULK_MAX),
});

/* -------------------------------------------------------------------------- */
/* Collections                                                                 */
/* -------------------------------------------------------------------------- */

collectionsRouter.get("/", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  // One grouped query rather than N+1: the count comes back with the row.
  const rows = await db
    .select({
      id: collections.id,
      name: collections.name,
      createdAt: collections.createdAt,
      keywordCount: count(collectionKeywords.keyword),
    })
    .from(collections)
    .leftJoin(
      collectionKeywords,
      eq(collectionKeywords.collectionId, collections.id),
    )
    .where(eq(collections.workspaceId, workspace))
    .groupBy(collections.id)
    .orderBy(desc(collections.createdAt));

  const body: CollectionListResponse = {
    collections: rows.map(toSummary),
  };
  return c.json(body);
});

collectionsRouter.post("/", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  const { name } = await readJson(c, z.object({ name: nameSchema }));

  const [created] = await db
    .insert(collections)
    .values({ workspaceId: workspace, name })
    .returning({
      id: collections.id,
      name: collections.name,
      createdAt: collections.createdAt,
    });

  if (created === undefined) {
    throw new ApiException("internal_error", "Could not create the collection.");
  }

  const body: CollectionMutationResponse = {
    collection: { ...created, createdAt: created.createdAt.toISOString(), keywordCount: 0 },
  };
  return c.json(body, 201);
});

collectionsRouter.get("/:id", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const collection = await requireCollection(db, workspace, id);
  const keywords = await db
    .select({
      keyword: collectionKeywords.keyword,
      volumeSnapshot: collectionKeywords.volumeSnapshot,
      locationCode: collectionKeywords.locationCode,
      languageCode: collectionKeywords.languageCode,
      addedAt: collectionKeywords.addedAt,
    })
    .from(collectionKeywords)
    .where(eq(collectionKeywords.collectionId, id))
    .orderBy(desc(collectionKeywords.addedAt));

  const body: CollectionDetailResponse = {
    id: collection.id,
    name: collection.name,
    createdAt: collection.createdAt.toISOString(),
    keywordCount: keywords.length,
    keywords: keywords.map((row) => ({
      keyword: row.keyword,
      volumeSnapshot: row.volumeSnapshot,
      // Null for anything saved before markets were stamped. See the field
      // note in src/shared/collections.ts: that null is "unknown", and the UI
      // must not paper over it with the workspace default.
      locationCode: row.locationCode,
      languageCode: row.languageCode,
      addedAt: row.addedAt.toISOString(),
    })),
  };
  return c.json(body);
});

collectionsRouter.patch("/:id", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  const { name } = await readJson(c, z.object({ name: nameSchema }));

  await requireCollection(db, workspace, id);

  // The workspace predicate is repeated on the write, not just the read:
  // authorising and mutating on separate rows is how a scoping bug gets in.
  const [updated] = await db
    .update(collections)
    .set({ name })
    .where(and(eq(collections.id, id), eq(collections.workspaceId, workspace)))
    .returning({
      id: collections.id,
      name: collections.name,
      createdAt: collections.createdAt,
    });

  if (updated === undefined) {
    throw new ApiException("not_found", "No such collection.");
  }

  const body: CollectionMutationResponse = {
    collection: {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      keywordCount: await countKeywords(db, id),
    },
  };
  return c.json(body);
});

collectionsRouter.delete("/:id", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  await requireCollection(db, workspace, id);

  // collection_keywords cascades on this FK (see db/schema.ts), so the child
  // rows go with it — no explicit cleanup, and none that can be forgotten.
  await db
    .delete(collections)
    .where(and(eq(collections.id, id), eq(collections.workspaceId, workspace)));

  const body: CollectionDeletedResponse = { deleted: true, id };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Keywords                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Bulk add, idempotent.
 *
 * `onConflictDoNothing` against the (collection_id, keyword) primary key: a
 * keyword already in the collection is skipped silently rather than erroring
 * or overwriting. That last part is deliberate — the volume snapshot records
 * what the keyword looked like when it was first saved, so a re-add must not
 * quietly move it. Adding the same list twice is a no-op, which is what makes
 * a "select all → add" button safe to double-click.
 */
collectionsRouter.post("/:id/keywords", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  const { keywords, location, language } = await readJson(c, bulkAddSchema);

  await requireCollection(db, workspace, id);

  const entries = dedupeKeywordEntries(keywords);
  const before = await countKeywords(db, id);

  await db
    .insert(collectionKeywords)
    .values(
      entries.map((entry) => ({
        collectionId: id,
        keyword: entry.keyword,
        volumeSnapshot: entry.volumeSnapshot ?? null,
        // Stamped from the request, null when the caller had no market to
        // give. Note this rides on `onConflictDoNothing` below: re-adding an
        // existing keyword from a different market does NOT restamp it, for
        // the same reason it does not overwrite the volume snapshot — the
        // first save is the one the snapshot belongs to.
        locationCode: location ?? null,
        languageCode: language ?? null,
      })),
    )
    .onConflictDoNothing();

  // Counting rather than trusting a driver-reported row count: D1's changes()
  // is not exposed uniformly through Drizzle, and the difference is the only
  // number we can state honestly.
  const after = await countKeywords(db, id);
  const added = after - before;

  const body: CollectionKeywordsAddedResponse = {
    added,
    skipped: entries.length - added,
    submitted: entries.length,
    keywordCount: after,
  };
  return c.json(body);
});

collectionsRouter.delete("/:id/keywords", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  const { keywords } = await readJson(c, bulkRemoveSchema);

  await requireCollection(db, workspace, id);

  const targets = [...new Set(keywords.map(normalizeKeyword))].filter(Boolean);
  const before = await countKeywords(db, id);

  if (targets.length > 0) {
    await db
      .delete(collectionKeywords)
      .where(
        and(
          eq(collectionKeywords.collectionId, id),
          inArray(collectionKeywords.keyword, targets),
        ),
      );
  }

  const after = await countKeywords(db, id);
  const body: CollectionKeywordsRemovedResponse = {
    removed: before - after,
    keywordCount: after,
  };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/collections/:id/export.csv
 *
 * `text/csv` with a `content-disposition: attachment`, so a browser saves it
 * instead of rendering it. The filename is the collection's name slugified —
 * see lib/csv.ts for the escaping, which is the part with teeth.
 */
collectionsRouter.get("/:id/export.csv", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const collection = await requireCollection(db, workspace, id);
  const rows = await db
    .select({
      keyword: collectionKeywords.keyword,
      volumeSnapshot: collectionKeywords.volumeSnapshot,
      locationCode: collectionKeywords.locationCode,
      languageCode: collectionKeywords.languageCode,
      addedAt: collectionKeywords.addedAt,
    })
    .from(collectionKeywords)
    .where(eq(collectionKeywords.collectionId, id))
    .orderBy(desc(collectionKeywords.addedAt));

  const csv = toCsv(
    ["keyword", "volume_snapshot", "location_code", "language_code", "added_at"],
    rows.map((row) => [
      row.keyword,
      row.volumeSnapshot,
      // Empty cells for a row with no market, matching how the table shows it:
      // a spreadsheet must not turn "unknown" into a location code nobody
      // chose.
      row.locationCode,
      row.languageCode,
      row.addedAt.toISOString(),
    ]),
  );

  const filename = `${slugify(collection.name)}.csv`;
  return c.body(csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": attachmentHeader(filename),
    // An export is a point-in-time snapshot; a cached one is a wrong one.
    "cache-control": "no-store",
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Loads a collection, scoped to the workspace.
 *
 * The workspace predicate is what makes a valid id from another tenant a 404
 * rather than a read. Every route that touches a collection goes through here
 * before it does anything else.
 */
async function requireCollection(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<{ id: string; name: string; createdAt: Date }> {
  const [row] = await db
    .select({
      id: collections.id,
      name: collections.name,
      createdAt: collections.createdAt,
    })
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.workspaceId, workspaceId)))
    .limit(1);

  if (row === undefined) {
    throw new ApiException("not_found", "No such collection.");
  }
  return row;
}

async function countKeywords(db: Db, collectionId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(collectionKeywords)
    .where(eq(collectionKeywords.collectionId, collectionId));
  return Number(row?.total ?? 0);
}

function toSummary(row: {
  id: string;
  name: string;
  createdAt: Date;
  keywordCount: number;
}): CollectionSummary {
  return {
    id: row.id,
    name: row.name,
    keywordCount: Number(row.keywordCount ?? 0),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Lowercased and trimmed — the form the primary key dedupes on. */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

/**
 * De-duplicates a bulk add before it reaches SQLite.
 *
 * Necessary, not merely tidy: SQLite rejects an INSERT whose own VALUES list
 * repeats a primary key, and `ON CONFLICT DO NOTHING` does not save it — the
 * conflict is within the statement, not with the table. A UI sending
 * "seo tools" and "SEO Tools" together would otherwise fail the whole batch.
 * First occurrence wins, so the earliest snapshot is the one kept.
 */
export function dedupeKeywordEntries(
  entries: readonly { keyword: string; volumeSnapshot?: number | null }[],
): { keyword: string; volumeSnapshot: number | null }[] {
  const seen = new Map<string, { keyword: string; volumeSnapshot: number | null }>();
  for (const entry of entries) {
    const keyword = normalizeKeyword(entry.keyword);
    if (keyword === "" || seen.has(keyword)) continue;
    seen.set(keyword, { keyword, volumeSnapshot: entry.volumeSnapshot ?? null });
  }
  return [...seen.values()];
}

export default collectionsRouter;
