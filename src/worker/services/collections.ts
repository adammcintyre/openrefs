/**
 * Keyword collections, as functions rather than routes.
 *
 * Pure D1 — no DataForSEO call, no cost — so nothing here can trip the spend
 * cap. Two of these are MCP tools (`list_collections`,
 * `add_keywords_to_collection`) as well as endpoints, which is why the bodies
 * live here rather than inline in `routes/collections.ts`.
 *
 * The scoping rule is the load-bearing part and it is enforced in one place:
 * `requireCollection` filters by workspace id, so a collection id from another
 * tenant reads as "not found" rather than leaking its existence. Every function
 * here goes through it before touching anything.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";

import type { Db } from "../../db";
import { collectionKeywords, collections } from "../../db";
import type {
  CollectionKeywordsAddedResponse,
  CollectionListResponse,
  CollectionSummary,
} from "../../shared/collections";
import { ApiException } from "../http";

/**
 * Loads a collection, scoped to the workspace.
 *
 * The workspace predicate is what makes a valid id from another tenant a 404
 * rather than a read. Every route that touches a collection goes through here
 * before it does anything else.
 */
export async function requireCollection(
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

export async function countKeywords(
  db: Db,
  collectionId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(collectionKeywords)
    .where(eq(collectionKeywords.collectionId, collectionId));
  return Number(row?.total ?? 0);
}

export function toSummary(row: {
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

/** GET /api/v1/collections — newest first, with keyword counts. */
export async function listCollections(
  db: Db,
  workspaceId: string,
): Promise<CollectionListResponse> {
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
    .where(eq(collections.workspaceId, workspaceId))
    .groupBy(collections.id)
    .orderBy(desc(collections.createdAt));

  return { collections: rows.map(toSummary) };
}

export interface AddKeywordsInput {
  keywords: { keyword: string; volumeSnapshot?: number | null }[];
  /** Both halves or neither — half a market cannot be used. */
  location?: number;
  language?: string;
}

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
export async function addKeywordsToCollection(
  db: Db,
  workspaceId: string,
  collectionId: string,
  input: AddKeywordsInput,
): Promise<CollectionKeywordsAddedResponse> {
  await requireCollection(db, workspaceId, collectionId);

  const entries = dedupeKeywordEntries(input.keywords);
  const before = await countKeywords(db, collectionId);

  await db
    .insert(collectionKeywords)
    .values(
      entries.map((entry) => ({
        collectionId,
        keyword: entry.keyword,
        volumeSnapshot: entry.volumeSnapshot ?? null,
        // Stamped from the request, null when the caller had no market to
        // give. Note this rides on `onConflictDoNothing` below: re-adding an
        // existing keyword from a different market does NOT restamp it, for
        // the same reason it does not overwrite the volume snapshot — the
        // first save is the one the snapshot belongs to.
        locationCode: input.location ?? null,
        languageCode: input.language ?? null,
      })),
    )
    .onConflictDoNothing();

  // Counting rather than trusting a driver-reported row count: D1's changes()
  // is not exposed uniformly through Drizzle, and the difference is the only
  // number we can state honestly.
  const after = await countKeywords(db, collectionId);
  const added = after - before;

  return {
    added,
    skipped: entries.length - added,
    submitted: entries.length,
    keywordCount: after,
  };
}
