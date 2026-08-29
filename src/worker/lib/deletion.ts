/**
 * Workspace deletion — the cascade CLAUDE.md calls "a feature".
 *
 * Three stores hold tenant data and each is emptied a different way:
 *   D1  one DELETE on `workspaces`; every other table reaches it by an
 *       `onDelete: "cascade"` foreign key (see src/db/schema.ts).
 *   KV  every key under `ws:<id>:`, listed and deleted page by page.
 *   R2  every object under `ws:<id>/`, likewise.
 *
 * Blobs go first and D1 last. If a purge fails halfway the workspace still
 * exists, so the operation can simply be retried; deleting the row first would
 * strand KV and R2 data belonging to a tenant that no longer appears anywhere.
 *
 * A fourth store is not ours at all: Google holds an OAuth grant for every
 * connected Search Console project, and no cascade of ours can reach it. It is
 * revoked explicitly, before the rows carrying the tokens disappear.
 *
 * `deleteProjectEverywhere`, at the foot of this file, is the same shape one
 * level down — a single project's D1 cascade, its Google grant, and the KV keys
 * that outlive it.
 */
import { and, eq } from "drizzle-orm";

import type { Db } from "../../db";
import { projects, workspaces } from "../../db";
import type { RevokeSummary } from "../gsc/tokens";
import {
  purgeProjectGscKv,
  revokeProjectGoogleToken,
  revokeWorkspaceGoogleTokens,
} from "../gsc/tokens";

/** KV keys for a workspace. Matches docs/ARCHITECTURE.md. */
export function workspaceKvPrefix(workspaceId: string): string {
  return `ws:${workspaceId}:`;
}

/** R2 keys for a workspace — a slash, not a colon, so paths read naturally. */
export function workspaceR2Prefix(workspaceId: string): string {
  return `ws:${workspaceId}/`;
}

export interface PurgeResult {
  kvKeys: number;
  r2Objects: number;
  /**
   * Google grants we asked to have revoked, and how many Google accepted.
   * Reported rather than swallowed so an operator can see that the third-party
   * half of the deletion actually happened — `attempted > revoked` is normal
   * when several projects share one Google account (see `revokeToken`).
   */
  googleGrants: RevokeSummary;
}

/** Deletes every KV key under the workspace prefix. Returns how many went. */
export async function purgeWorkspaceKv(
  kv: KVNamespace,
  workspaceId: string,
): Promise<number> {
  const prefix = workspaceKvPrefix(workspaceId);
  let cursor: string | undefined;
  let deleted = 0;

  for (;;) {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    // KV has no bulk delete; the keys in a page are independent, so fan out.
    await Promise.all(page.keys.map((key) => kv.delete(key.name)));
    deleted += page.keys.length;

    if (page.list_complete) break;
    cursor = page.cursor;
  }

  return deleted;
}

/** Deletes every R2 object under the workspace prefix. */
export async function purgeWorkspaceR2(
  bucket: R2Bucket,
  workspaceId: string,
): Promise<number> {
  const prefix = workspaceR2Prefix(workspaceId);
  let cursor: string | undefined;
  let deleted = 0;

  for (;;) {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    if (page.objects.length > 0) {
      // R2 takes up to 1000 keys per call, which is exactly one page.
      await bucket.delete(page.objects.map((object) => object.key));
      deleted += page.objects.length;
    }

    if (!page.truncated) break;
    cursor = page.cursor;
  }

  return deleted;
}

export interface DeletionStores {
  db: Db;
  kv: KVNamespace;
  r2: R2Bucket;
  /**
   * `APP_MASTER_KEY`. Needed to decrypt the stored Google refresh tokens for
   * long enough to revoke them — the one step of this cascade that has to read
   * a secret rather than just delete it.
   */
  masterKey: string;
}

/**
 * Removes a workspace from every store. Callers must have already checked that
 * the actor is an owner — this function does no authorization of its own, so
 * that account deletion can reuse it for workspaces the user solely owns.
 *
 * The three purges run together because they are independent, and all three
 * finish before the D1 row goes: the Google revocation in particular reads
 * `gsc_connections` through the `projects` join, so the cascade that drops
 * those rows must not have run yet.
 *
 * **Revocation can never block deletion.** `revokeWorkspaceGoogleTokens` is
 * documented not to throw, and the `catch` here is the second line of that
 * defence: if Google is unreachable, or a token will not decrypt, or the
 * lookup itself fails, the user's data is still deleted. Refusing to honour a
 * deletion request because a third party is having a bad day would be the
 * worse failure by a wide margin — and the grant remains revocable by the user
 * from their own Google account settings.
 */
export async function deleteWorkspaceEverywhere(
  { db, kv, r2, masterKey }: DeletionStores,
  workspaceId: string,
): Promise<PurgeResult> {
  const [kvKeys, r2Objects, googleGrants] = await Promise.all([
    purgeWorkspaceKv(kv, workspaceId),
    purgeWorkspaceR2(r2, workspaceId),
    revokeWorkspaceGoogleTokens(db, masterKey, workspaceId).catch(
      (err: unknown) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "google token revocation failed during workspace deletion",
            workspaceId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        return { attempted: 0, revoked: 0 };
      },
    ),
  ]);

  // TODO(phase 8, hosted): delete the Stripe customer / cancel the
  // subscription for this workspace before the row goes.

  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));

  return { kvKeys, r2Objects, googleGrants };
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

export interface ProjectDeletionStores {
  db: Db;
  kv: KVNamespace;
  /** `APP_MASTER_KEY` — to decrypt the refresh token long enough to revoke it. */
  masterKey: string;
}

export interface ProjectPurgeResult {
  /**
   * Cached Search Console reports deleted. The access token and broken mark go
   * unconditionally and are not countable — see `purgeProjectGscKv`.
   */
  reportCacheKeys: number;
  googleGrants: RevokeSummary;
}

/**
 * Removes a project from D1 and takes its Search Console state with it.
 *
 * A project is not a workspace in miniature: almost everything it owns —
 * tracked keywords, rank snapshots, audits, AI prompts, and the
 * `gsc_connections` row itself — reaches the project row by an
 * `onDelete: "cascade"` foreign key, so one D1 statement is the whole database
 * half. What the cascade *cannot* reach is the two stores outside D1, and both
 * of them are the reason this function exists rather than a bare `DELETE`:
 *
 *   Google  holds the OAuth grant. The cascade destroys the encrypted refresh
 *           token, which is the only thing that could ever revoke it — so the
 *           revocation has to happen while the row is still there. This is the
 *           same ordering constraint the workspace path has, for the same
 *           reason.
 *   KV      holds a cached access token (good for up to 50 minutes), a
 *           "broken" mark, and up to 24 hours of cached reports. All three are
 *           keyed by project id under the workspace prefix, so nothing in D1
 *           reaches them and only workspace deletion would otherwise sweep
 *           them — eventually, if the workspace is ever deleted at all.
 *
 * Caller must have already authorised the actor as an admin of the workspace;
 * this does no authorization of its own beyond scoping every statement to
 * `workspaceId`, which it does unconditionally so a project id from another
 * tenant deletes nothing.
 *
 * **Neither cleanup can block the deletion.** Both are best-effort and neither
 * throws; a failure is logged and the row still goes. The alternative — telling
 * a user they may not delete their project because Google is having a bad day —
 * is the worse failure by a wide margin, and the grant stays revocable from the
 * user's own Google account settings either way.
 */
export async function deleteProjectEverywhere(
  { db, kv, masterKey }: ProjectDeletionStores,
  workspaceId: string,
  projectId: string,
): Promise<ProjectPurgeResult> {
  const [googleGrants, reportCacheKeys] = await Promise.all([
    revokeProjectGoogleToken(db, masterKey, workspaceId, projectId).catch(
      (err: unknown) => {
        logProjectCleanupFailure("google token revocation", workspaceId, projectId, err);
        return { attempted: 0, revoked: 0 };
      },
    ),
    purgeProjectGscKv(kv, workspaceId, projectId).catch((err: unknown) => {
      logProjectCleanupFailure("gsc cache purge", workspaceId, projectId, err);
      return 0;
    }),
  ]);

  await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)));

  return { reportCacheKeys, googleGrants };
}

function logProjectCleanupFailure(
  step: string,
  workspaceId: string,
  projectId: string,
  err: unknown,
): void {
  console.error(
    JSON.stringify({
      level: "error",
      message: `${step} failed during project deletion`,
      workspaceId,
      projectId,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
