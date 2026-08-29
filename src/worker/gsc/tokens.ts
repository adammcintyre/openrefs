/**
 * Connection rows, access-token caching, and the "this grant is dead" flag.
 *
 * The invariant this module exists to hold: **the refresh token is decrypted
 * as rarely as possible and never leaves memory.** It is read from D1,
 * decrypted, exchanged for an access token, and dropped. The access token —
 * short-lived, single-scope, useless after an hour — is what gets cached.
 */
import { and, eq } from "drizzle-orm";

import type { Db } from "../../db";
import { gscConnections, projects } from "../../db";
import { ApiException } from "../http";
import { decryptSecret } from "../lib/crypto";
import type { GscConfig } from "./config";
import { refreshAccessToken, revokeToken } from "./api";

/**
 * Access-token cache lifetime, in seconds. Google issues tokens with
 * `expires_in: 3600`; caching for 50 minutes leaves a ten-minute margin so a
 * token fetched from cache cannot expire mid-request. Key layout from
 * docs/specs/PHASE5.md.
 */
export const GSC_TOKEN_TTL_SECONDS = 50 * 60;

/**
 * How long a "broken" mark stands before we try Google again.
 *
 * A week, not forever, because a mark is only ever a cached observation: if it
 * is wrong, or evaporates, the next refresh re-discovers the truth and
 * re-marks. That self-healing property is exactly why this lives in KV rather
 * than as a D1 column — it is derived state about a third party's opinion, not
 * a fact about the connection, and giving it a schema would imply otherwise.
 */
export const GSC_BROKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** KV's floor for `expirationTtl`. */
const KV_MIN_TTL_SECONDS = 60;

/**
 * `ws:<workspaceId>:gsc-token:<projectId>` — docs/specs/PHASE5.md.
 *
 * Workspace-prefixed like every other key in OpenRefs, so deleting a workspace
 * sweeps it away with everything else (CLAUDE.md hard rule #6).
 */
export function accessTokenKey(workspaceId: string, projectId: string): string {
  return `ws:${workspaceId}:gsc-token:${projectId}`;
}

/** Sibling of the token key; same prefix, same sweep. */
export function brokenKey(workspaceId: string, projectId: string): string {
  return `ws:${workspaceId}:gsc-broken:${projectId}`;
}

export interface GscConnectionRow {
  projectId: string;
  refreshTokenEnc: string;
  /** "" until the user picks one. */
  property: string;
  connectedBy: string | null;
}

/**
 * The connection for a project, **scoped through the project to the
 * workspace**.
 *
 * The join is the authorization, exactly as in routes/audits.ts:
 * `gsc_connections` has no workspace column, so a project id alone proves
 * nothing about who may read it. Filtering on `projects.workspace_id` is what
 * makes another tenant's connection invisible rather than merely forbidden.
 */
export async function loadConnection(
  db: Db,
  workspaceId: string,
  projectId: string,
): Promise<GscConnectionRow | null> {
  const [row] = await db
    .select({
      projectId: gscConnections.projectId,
      refreshTokenEnc: gscConnections.refreshTokenEnc,
      property: gscConnections.property,
      connectedBy: gscConnections.connectedBy,
    })
    .from(gscConnections)
    .innerJoin(projects, eq(projects.id, gscConnections.projectId))
    .where(
      and(
        eq(gscConnections.projectId, projectId),
        eq(projects.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** The connection, or the 409 that tells the UI to show a Connect button. */
export async function requireConnection(
  db: Db,
  workspaceId: string,
  projectId: string,
): Promise<GscConnectionRow> {
  const row = await loadConnection(db, workspaceId, projectId);
  if (row === null) {
    throw new ApiException(
      "gsc_not_connected",
      "This project is not connected to Google Search Console yet.",
    );
  }
  return row;
}

/** Every connection in a workspace, for the deletion sweep. */
export async function listWorkspaceConnections(
  db: Db,
  workspaceId: string,
): Promise<GscConnectionRow[]> {
  return db
    .select({
      projectId: gscConnections.projectId,
      refreshTokenEnc: gscConnections.refreshTokenEnc,
      property: gscConnections.property,
      connectedBy: gscConnections.connectedBy,
    })
    .from(gscConnections)
    .innerJoin(projects, eq(projects.id, gscConnections.projectId))
    .where(eq(projects.workspaceId, workspaceId));
}

/* -------------------------------------------------------------------------- */
/* Broken flag                                                                 */
/* -------------------------------------------------------------------------- */

export async function isConnectionBroken(
  kv: KVNamespace,
  workspaceId: string,
  projectId: string,
): Promise<boolean> {
  return (await kv.get(brokenKey(workspaceId, projectId))) !== null;
}

export async function markConnectionBroken(
  kv: KVNamespace,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  await kv.put(brokenKey(workspaceId, projectId), "1", {
    expirationTtl: GSC_BROKEN_TTL_SECONDS,
  });
}

/** Called after any successful refresh, and on reconnect. */
export async function clearConnectionBroken(
  kv: KVNamespace,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  await kv.delete(brokenKey(workspaceId, projectId));
}

/**
 * Drops both cached artefacts for a project. Used on disconnect and on
 * reconnect — a new grant must never serve the previous grant's access token.
 */
export async function clearConnectionCache(
  kv: KVNamespace,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  await Promise.all([
    kv.delete(accessTokenKey(workspaceId, projectId)),
    kv.delete(brokenKey(workspaceId, projectId)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Access tokens                                                               */
/* -------------------------------------------------------------------------- */

/**
 * How long to cache a freshly-minted access token.
 *
 * The shorter of our 50-minute ceiling and ten minutes less than whatever
 * Google said, so an unusually short-lived token is not cached past its own
 * expiry. Floored at KV's 60-second minimum.
 */
export function tokenCacheTtl(expiresIn: number): number {
  return Math.max(
    KV_MIN_TTL_SECONDS,
    Math.min(GSC_TOKEN_TTL_SECONDS, expiresIn - 600),
  );
}

export interface AccessTokenContext {
  kv: KVNamespace;
  masterKey: string;
  config: GscConfig;
  workspaceId: string;
  projectId: string;
}

/**
 * A usable access token for this project's connection.
 *
 * Cache first: a 28-day report is three Google calls, and re-minting a token
 * for each would triple the round trips and the rate-limit footprint for no
 * benefit. On a miss, the refresh token is decrypted, exchanged, and forgotten.
 *
 * An `invalid_grant` from the exchange is not retried and not swallowed: the
 * connection is marked broken so `GET /gsc/status` can report it without
 * calling Google, and the `gsc_reconnect_required` error travels up to the UI.
 */
export async function getAccessToken(
  ctx: AccessTokenContext,
  refreshTokenEnc: string,
): Promise<string> {
  const key = accessTokenKey(ctx.workspaceId, ctx.projectId);

  const cached = await ctx.kv.get(key);
  if (cached !== null && cached !== "") return cached;

  let refreshToken: string;
  try {
    refreshToken = await decryptSecret(ctx.masterKey, refreshTokenEnc);
  } catch {
    /*
     * The stored token cannot be decrypted — a rotated or wrong
     * APP_MASTER_KEY, or a corrupted row. Reconnecting rewrites it under the
     * current key, which is the only fix, so it gets the same signal as a dead
     * grant. Deliberately no detail: which of those it is would tell an
     * attacker something about the deployment's key state.
     */
    await markConnectionBroken(ctx.kv, ctx.workspaceId, ctx.projectId);
    throw new ApiException(
      "gsc_reconnect_required",
      "This Search Console connection can no longer be read. Reconnect to restore it.",
    );
  }

  let tokens;
  try {
    tokens = await refreshAccessToken({
      clientId: ctx.config.clientId,
      clientSecret: ctx.config.clientSecret,
      refreshToken,
    });
  } catch (err) {
    if (
      err instanceof ApiException &&
      err.code === "gsc_reconnect_required"
    ) {
      await markConnectionBroken(ctx.kv, ctx.workspaceId, ctx.projectId);
    }
    throw err;
  }

  await Promise.all([
    ctx.kv.put(key, tokens.accessToken, {
      expirationTtl: tokenCacheTtl(tokens.expiresIn),
    }),
    // A refresh that worked is proof the grant is alive again.
    clearConnectionBroken(ctx.kv, ctx.workspaceId, ctx.projectId),
  ]);

  return tokens.accessToken;
}

/* -------------------------------------------------------------------------- */
/* Revocation                                                                  */
/* -------------------------------------------------------------------------- */

export interface RevokeSummary {
  /** Connections found for the workspace. */
  attempted: number;
  /** How many Google accepted a revocation for. */
  revoked: number;
}

/**
 * Revokes every Google grant a workspace holds. **Never throws.**
 *
 * Called from the workspace-deletion cascade, where the ordering matters: the
 * tokens have to be revoked *before* D1 drops the rows, because once the rows
 * are gone the encrypted tokens are gone with them and the grants would sit in
 * the users' Google accounts forever with nothing left to revoke them.
 *
 * Best-effort in every direction — a token that will not decrypt, a project
 * Google has never heard of, Google being down entirely — because refusing to
 * delete a user's data on account of a third party's availability is not an
 * acceptable trade. Failures are counted and returned so the caller can log
 * them; none of them stop the deletion.
 */
export async function revokeWorkspaceGoogleTokens(
  db: Db,
  masterKey: string,
  workspaceId: string,
): Promise<RevokeSummary> {
  let connections: GscConnectionRow[];
  try {
    connections = await listWorkspaceConnections(db, workspaceId);
  } catch {
    // Even the lookup is best-effort: a workspace with no Search Console
    // connections must not fail to delete because this query did.
    return { attempted: 0, revoked: 0 };
  }

  let revoked = 0;
  for (const connection of connections) {
    try {
      const token = await decryptSecret(masterKey, connection.refreshTokenEnc);
      if (await revokeToken(token)) revoked += 1;
    } catch {
      // Undecryptable token: nothing to revoke, nothing to be done about it.
    }
  }

  return { attempted: connections.length, revoked };
}
