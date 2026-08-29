/**
 * Keyword collections — the contract between the Worker's
 * `/api/v1/collections/*` routes and the SPA.
 *
 * Collections are pure D1: no DataForSEO call, no cost, so none of these
 * carry `ResultMeta`. Timestamps are ISO 8601 strings (the DB stores epoch
 * milliseconds; the boundary converts once, here).
 */

/** A collection in a list. `keywordCount` is computed, not stored. */
export interface CollectionSummary {
  id: string;
  name: string;
  keywordCount: number;
  /** ISO 8601. */
  createdAt: string;
}

/** One saved keyword. */
export interface CollectionKeywordRow {
  keyword: string;
  /**
   * Search volume at the moment it was saved, so a list stays comparable
   * against itself over time. Null when the keyword was added without one.
   */
  volumeSnapshot: number | null;
  /** ISO 8601. */
  addedAt: string;
}

/** GET /api/v1/collections */
export interface CollectionListResponse {
  collections: CollectionSummary[];
}

/** GET /api/v1/collections/:id — the collection plus its keywords. */
export interface CollectionDetailResponse extends CollectionSummary {
  /** Newest first. */
  keywords: CollectionKeywordRow[];
}

/** POST /api/v1/collections, PATCH /api/v1/collections/:id */
export interface CollectionMutationResponse {
  collection: CollectionSummary;
}

/**
 * POST /api/v1/collections/:id/keywords
 *
 * Idempotent: adding a keyword already in the collection is not an error and
 * does not update its snapshot — the first save wins, which is what makes the
 * snapshot meaningful. `added + skipped === submitted` always holds.
 */
export interface CollectionKeywordsAddedResponse {
  /** Rows actually inserted. */
  added: number;
  /** Rows that were already present. */
  skipped: number;
  /** Distinct keywords in the request, after trimming and de-duplication. */
  submitted: number;
  keywordCount: number;
}

/** DELETE /api/v1/collections/:id/keywords */
export interface CollectionKeywordsRemovedResponse {
  removed: number;
  keywordCount: number;
}

/** DELETE /api/v1/collections/:id */
export interface CollectionDeletedResponse {
  deleted: true;
  id: string;
}

/** Longest name a collection may have. */
export const COLLECTION_NAME_MAX_LENGTH = 120;

/** Most keywords one bulk add or remove may carry. */
export const COLLECTION_KEYWORDS_BULK_MAX = 1000;
