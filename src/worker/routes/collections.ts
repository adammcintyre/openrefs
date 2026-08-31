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
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type {
  CollectionDeletedResponse,
  CollectionDetailResponse,
  CollectionKeywordsRemovedResponse,
  CollectionMutationResponse,
} from "../../shared/collections";
import {
  COLLECTION_KEYWORDS_BULK_MAX,
  COLLECTION_NAME_MAX_LENGTH,
} from "../../shared/collections";
import { collectionKeywords, collections } from "../../db";
import { ApiException } from "../http";
import { attachmentHeader, slugify, toCsv } from "../lib/csv";
import { authorizeWorkspace, workspaceParam } from "../lib/research";
import { readJson, readParams, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import {
  addKeywordsToCollection,
  countKeywords,
  listCollections,
  normalizeKeyword,
  requireCollection,
} from "../services/collections";
import type { AppEnv } from "../types";

/*
 * Re-exported because `collections.test.ts` imports them from this module and
 * because they are part of this module's public shape, even though they now
 * live beside the handler bodies in ../services/collections.
 */
export { dedupeKeywordEntries, normalizeKeyword } from "../services/collections";

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
  return c.json(await listCollections(db, workspace));
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
 * Bulk add, idempotent. The body lives in `../services/collections` because
 * `add_keywords_to_collection` is also an MCP tool.
 */
collectionsRouter.post("/:id/keywords", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  const input = await readJson(c, bulkAddSchema);

  return c.json(await addKeywordsToCollection(db, workspace, id, input));
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

export default collectionsRouter;
