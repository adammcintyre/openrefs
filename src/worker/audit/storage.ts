/**
 * Where an audit's bulk data lives: R2, under
 * `ws:<workspaceId>/audits/<auditId>/<section>-<n>.json`.
 *
 * D1 holds the rollup (one row, read on every page view); R2 holds the raw
 * section pulls (megabytes, read only when someone opens a drill-down). The
 * split is what keeps `GET /audits/:id` a single small row read no matter how
 * many pages were crawled.
 *
 * The `ws:<workspaceId>/` prefix is not cosmetic — it is CLAUDE.md hard rule
 * #6. Workspace deletion is a prefix sweep (`purgeWorkspaceR2`), so an audit
 * blob stored anywhere else would outlive the tenant that owns it.
 */
import { workspaceR2Prefix } from "../lib/deletion";

/**
 * The OnPage sections we pull and keep.
 *
 * `pages` is the backbone — every per-page check lives there and every
 * category's drill-down is built from it. The rest are pulled because they
 * carry detail `pages` does not: which URLs a redirect chain passes through,
 * what a duplicate group contains, why a page is non-indexable, and where a
 * broken link was found.
 */
export const AUDIT_SECTIONS = [
  "pages",
  "non_indexable",
  "duplicate_tags",
  "redirect_chains",
  "links",
] as const;
export type AuditSection = (typeof AUDIT_SECTIONS)[number];

/** R2 prefix holding everything for one audit. */
export function auditR2Prefix(workspaceId: string, auditId: string): string {
  return `${workspaceR2Prefix(workspaceId)}audits/${auditId}/`;
}

/**
 * Key for one page of one section.
 *
 * `n` is the zero-based pull index, not a byte offset: sections are fetched in
 * fixed-size pages and each response is stored verbatim, so the numbering
 * matches the order they were retrieved and a partial ingest leaves a
 * contiguous `0..k` run rather than holes.
 */
export function auditSectionKey(
  workspaceId: string,
  auditId: string,
  section: AuditSection,
  n: number,
): string {
  return `${auditR2Prefix(workspaceId, auditId)}${section}-${n}.json`;
}

/**
 * Key for the computed issues index — the drill-down's actual source.
 *
 * Derived from `pages` at ingest time rather than recomputed per request:
 * classifying every page against every check on each drill-down open would
 * re-read every `pages-*.json` blob to answer one question about one category.
 * This is written once and read by URL.
 */
export function auditIssuesKey(
  workspaceId: string,
  auditId: string,
  category: string,
): string {
  return `${auditR2Prefix(workspaceId, auditId)}issues/${category}.json`;
}

/** Writes a JSON blob, returning the key it went to. */
export async function putAuditJson(
  bucket: R2Bucket,
  key: string,
  value: unknown,
): Promise<string> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });
  return key;
}

/**
 * Reads a JSON blob, or null when it is not there.
 *
 * Null rather than throwing: a drill-down for a category with no findings has
 * no blob, and an audit ingested before a category existed has none either.
 * Both are "nothing to show", not errors.
 */
export async function getAuditJson<T>(
  bucket: R2Bucket,
  key: string,
): Promise<T | null> {
  const object = await bucket.get(key);
  if (object === null) return null;
  try {
    return (await object.json()) as T;
  } catch {
    // A truncated or half-written blob costs one drill-down, not the audit.
    return null;
  }
}

/**
 * Deletes every object belonging to one audit.
 *
 * Paged and bounded the same way `purgeWorkspaceR2` is: R2 takes up to 1000
 * keys per delete, which is exactly one list page. Returns the count so
 * `DELETE /audits/:id` can prove the blobs went with the row.
 */
export async function deleteAuditBlobs(
  bucket: R2Bucket,
  workspaceId: string,
  auditId: string,
): Promise<number> {
  const prefix = auditR2Prefix(workspaceId, auditId);
  let cursor: string | undefined;
  let deleted = 0;

  for (;;) {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((object) => object.key));
      deleted += page.objects.length;
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }

  return deleted;
}
