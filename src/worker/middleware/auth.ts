import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

import { apiKeys, getDb, sessions } from "../../db";
import { apiError } from "../http";
import { sha256Hex } from "../lib/crypto";
import {
  SESSION_COOKIE,
  deleteSession,
  needsRenewal,
  responseSetsSessionCookie,
  sessionExpiry,
  setSessionCookie,
} from "../lib/sessions";
import type { AppEnv } from "../types";

/** Every API key is minted with this prefix so keys are recognisable on sight. */
export const API_KEY_PREFIX = "orf_";

/** Returns the bearer credential only if it looks like one of our API keys. */
function readApiKey(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (token === undefined || !token.startsWith(API_KEY_PREFIX)) return null;
  return token;
}

/**
 * Runs work that must not delay the response — `lastUsedAt` bookkeeping and
 * session renewal. Falls back to a detached promise when there is no
 * ExecutionContext, which is the case under `app.request()` in unit tests.
 */
function afterResponse(c: Context<AppEnv>, work: () => Promise<unknown>): void {
  const promise = work().catch(() => {
    // Bookkeeping only: a failure here must never break the request.
  });
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}

/**
 * Populates `c.var.session` from either an `orf_session` cookie or an
 * `Authorization: Bearer orf_...` API key, and leaves it null otherwise. Never
 * rejects — it is mounted app-wide, and `requireSession` is what turns an
 * anonymous request into a 401.
 *
 * Both credentials are looked up by `sha256Hex` of the presented value, so the
 * database never holds anything that can be replayed.
 */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  c.set("session", null);

  const apiKey = readApiKey(c.req.header("authorization"));
  const cookieToken = getCookie(c, SESSION_COOKIE);

  // Anonymous fast path — public routes must not pay for a D1 round trip.
  if (apiKey === null && (cookieToken === undefined || cookieToken === "")) {
    await next();
    return;
  }

  const db = getDb(c.env.DB);

  if (apiKey !== null) {
    const keyHash = await sha256Hex(apiKey);
    const [key] = await db
      .select({ id: apiKeys.id, workspaceId: apiKeys.workspaceId })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash))
      .limit(1);

    if (key !== undefined) {
      c.set("session", {
        kind: "api_key",
        apiKeyId: key.id,
        workspaceId: key.workspaceId,
        userId: null,
      });
      afterResponse(c, async () => {
        await db
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, key.id));
      });
    }

    await next();
    return;
  }

  const sessionId = await sha256Hex(cookieToken as string);
  const [row] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (row === undefined) {
    await next();
    return;
  }

  const now = new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Expired: stay anonymous and reap the row on the way out.
    afterResponse(c, () => deleteSession(db, row.id));
    await next();
    return;
  }

  c.set("session", {
    kind: "session",
    sessionId: row.id,
    userId: row.userId,
    workspaceId: null,
  });

  await next();

  /*
   * Sliding renewal, after the handler on purpose: login, logout and account
   * deletion all set their own `orf_session` header, and re-issuing the old
   * cookie behind them would undo the thing they just did.
   */
  if (needsRenewal(row.expiresAt, now) && !responseSetsSessionCookie(c)) {
    const expiresAt = sessionExpiry(now);
    setSessionCookie(c, cookieToken as string, expiresAt);
    afterResponse(c, async () => {
      await db
        .update(sessions)
        .set({ expiresAt })
        .where(eq(sessions.id, row.id));
    });
  }
});

/**
 * Guard for routes that require a caller. Accepts both a signed-in user and an
 * API key; handlers that must have a *person* call `requireUserSession`.
 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("session") === null) {
    return apiError(c, "unauthorized", "Sign in to continue.");
  }
  await next();
});
