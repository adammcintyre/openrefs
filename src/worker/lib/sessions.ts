/**
 * Cookie-backed sessions.
 *
 * The cookie carries a raw `randomToken()`; D1 stores only `sha256Hex(token)`
 * as `sessions.id`. A dump of the sessions table therefore grants nothing —
 * the same reasoning as password hashing, applied to bearer tokens.
 */
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

import type { Db } from "../../db";
import { sessions } from "../../db";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "orf_session";

/** 30 days, per the brief. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Sliding renewal threshold: with under 15 days left, a request extends the
 * session back to a full 30 days. Active users are never signed out; an
 * abandoned session still dies on a fixed schedule.
 */
export const SESSION_RENEW_BELOW_MS = 15 * 24 * 60 * 60 * 1000;

/** Pure, so the renewal window is testable without a database. */
export function needsRenewal(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < SESSION_RENEW_BELOW_MS;
}

export function sessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/**
 * `Secure` is unconditional. Browsers treat http://localhost as a secure
 * context, so dev still works, and no deployment can accidentally serve
 * session cookies over plaintext.
 */
function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires,
  } as const;
}

export function setSessionCookie(
  c: Context,
  rawToken: string,
  expiresAt: Date,
): void {
  setCookie(c, SESSION_COOKIE, rawToken, cookieOptions(expiresAt));
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
}

/**
 * Mints a session row and returns the raw token for the cookie. The caller is
 * responsible for calling `setSessionCookie` — keeping the two apart lets
 * register and login share this without either owning the response.
 */
export async function createSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomToken();
  const sessionId = await sha256Hex(token);
  const expiresAt = sessionExpiry(now);

  await db.insert(sessions).values({ id: sessionId, userId, expiresAt });

  return { token, sessionId, expiresAt };
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** True when this response already manages the session cookie itself. */
export function responseSetsSessionCookie(c: Context): boolean {
  return c.res.headers
    .getSetCookie()
    .some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}
