/**
 * `/api/v1/auth` — registration, sessions, and account deletion.
 *
 * These routes are deliberately public (no `requireSession` on the router);
 * `/me` guards itself. Two rules run through the whole file:
 *
 *  - No email enumeration. Login answers `invalid_credentials` whether the
 *    address is unknown or the password is wrong, and spends the same PBKDF2
 *    work either way so response time does not answer the question instead.
 *  - Nothing replayable is stored. Passwords are PBKDF2 hashes; the session
 *    cookie's token exists only in the cookie, D1 holds `sha256Hex(token)`.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import {
  getDb,
  passwordResets,
  sessions,
  users,
  workspaceMembers,
  workspaces,
  type Db,
} from "../../db";
import type { MeResponse, ResetPasswordResponse } from "../../shared/auth";
import {
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "../../shared/auth";
import { ApiException, apiError } from "../http";
import {
  requireUserSession,
  soleOwnedWorkspaceIds,
} from "../lib/authorization";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "../lib/crypto";
import { deleteWorkspaceEverywhere } from "../lib/deletion";
import { sendEmailInBackground } from "../lib/email";
import {
  buildResetUrl,
  isResetUsable,
  passwordResetExpiresAt,
  resetEmailBody,
} from "../lib/password-reset";
import {
  clearLoginAttempts,
  clientIp,
  FORGOT_EMAIL_RULE,
  FORGOT_IP_RULE,
  isLoginBlocked,
  isRateLimited,
  recordAttempt,
  recordFailedLogin,
} from "../lib/rate-limit";
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  setSessionCookie,
} from "../lib/sessions";
import { readJson } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

/** Name of the workspace every new account starts with. */
const DEFAULT_WORKSPACE_NAME = "My workspace";

const auth = new Hono<AppEnv>();

/** D1 surfaces constraint failures as plain errors; this is the only one we expect. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
  );
}

async function buildMeResponse(db: Db, userId: string): Promise<MeResponse> {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user === undefined) {
    // The row went away mid-request (account deleted elsewhere).
    throw new ApiException("unauthorized", "Sign in to continue.");
  }

  const memberships = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);

  return { user, workspaces: memberships };
}

/* -------------------------------------------------------------------------- */

auth.post("/register", async (c) => {
  const { email, password } = await readJson(c, registerSchema);
  const db = getDb(c.env.DB);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing !== undefined) {
    return apiError(c, "email_taken", "That email is already registered.");
  }

  const passwordHash = await hashPassword(password);
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();

  try {
    // D1 has no interactive transactions; `batch` is the atomic unit. A user
    // must never exist without the workspace that makes the app usable.
    await db.batch([
      db.insert(users).values({ id: userId, email, passwordHash }),
      db
        .insert(workspaces)
        .values({ id: workspaceId, name: DEFAULT_WORKSPACE_NAME }),
      db
        .insert(workspaceMembers)
        .values({ workspaceId, userId, role: "owner" }),
    ]);
  } catch (error) {
    // Lost a race against a concurrent registration of the same address.
    if (isUniqueViolation(error)) {
      return apiError(c, "email_taken", "That email is already registered.");
    }
    throw error;
  }

  const { token, expiresAt } = await createSession(db, userId);
  setSessionCookie(c, token, expiresAt);

  const body: MeResponse = {
    user: { id: userId, email },
    workspaces: [
      { id: workspaceId, name: DEFAULT_WORKSPACE_NAME, role: "owner" },
    ],
  };
  return c.json(body, 201);
});

auth.post("/login", async (c) => {
  const { email, password } = await readJson(c, loginSchema);
  const kv = c.env.CACHE;
  const ip = clientIp(c);

  if (await isLoginBlocked(kv, email, ip)) {
    return apiError(
      c,
      "too_many_attempts",
      "Too many sign-in attempts. Try again in 15 minutes.",
    );
  }

  const db = getDb(c.env.DB);
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user === undefined) {
    // Burn one PBKDF2 the same way a real verification would, so an unknown
    // address is not detectable by how fast it comes back. Result discarded.
    await hashPassword(password);
    await recordFailedLogin(kv, email, ip);
    return apiError(c, "invalid_credentials", "Wrong email or password.");
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordFailedLogin(kv, email, ip);
    return apiError(c, "invalid_credentials", "Wrong email or password.");
  }

  await clearLoginAttempts(kv, email);

  const { token, expiresAt } = await createSession(db, user.id);
  setSessionCookie(c, token, expiresAt);

  return c.json(await buildMeResponse(db, user.id));
});

/* ---------------------------- password reset ------------------------------ */

/**
 * Ask for a reset link. **Always 202**, for every input.
 *
 * A 404 for an unknown address, or a 429 when the limiter trips, would turn
 * this endpoint into a membership oracle — feed it a breach list and it tells
 * you who has an OpenRefs account. So every path below returns the same empty
 * 202, and the SPA shows the same "if that address exists, we sent a link"
 * either way. The mail itself goes out after the response (see
 * `sendEmailInBackground`), so the reply's *timing* cannot answer the question
 * the status code refuses to.
 */
auth.post("/forgot", async (c) => {
  const { email } = await readJson(c, forgotPasswordSchema);
  const kv = c.env.CACHE;
  const ip = clientIp(c);

  /** The only response this handler has. */
  const accepted = () => c.body(null, 202);

  const throttled =
    (await isRateLimited(kv, FORGOT_EMAIL_RULE, "email", email)) ||
    (ip !== null && (await isRateLimited(kv, FORGOT_IP_RULE, "ip", ip)));

  if (throttled) {
    // Logged so an operator can see the limiter working. No address and no IP
    // in the line: this is the one place both are known to be interesting, and
    // a throttle log naming them would be a list of exactly who was targeted.
    console.log(JSON.stringify({ event: "auth.forgot.throttled" }));
    return accepted();
  }

  await recordAttempt(kv, FORGOT_EMAIL_RULE, "email", email);
  if (ip !== null) await recordAttempt(kv, FORGOT_IP_RULE, "ip", ip);

  const db = getDb(c.env.DB);
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Nobody by that name. The attempt is still counted above, so an address
  // list cannot be walked cheaply.
  if (user === undefined) return accepted();

  const token = randomToken();
  const tokenHash = await sha256Hex(token);

  await db.batch([
    /*
     * Issuing a link invalidates every older one for this user, so a reset
     * mail cannot be resurrected by an attacker who saw an earlier one — and
     * a user who clicks "resend" three times has exactly one live link, the
     * newest. Batched with the insert because D1 has no interactive
     * transactions and a delete that landed alone would leave the account
     * with no way in at all.
     */
    db.delete(passwordResets).where(eq(passwordResets.userId, user.id)),
    db.insert(passwordResets).values({
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt: passwordResetExpiresAt(),
    }),
  ]);

  sendEmailInBackground(c, {
    to: email,
    subject: "Reset your OpenRefs password",
    // The only time this token is ever readable.
    text: resetEmailBody(buildResetUrl(new URL(c.req.url).origin, token)),
  });

  return accepted();
});

/**
 * Redeem a reset link and choose a new password.
 *
 * Succeeding here **signs the account out everywhere**. Whoever asked for this
 * link may be recovering an account someone else has a session on, and leaving
 * those sessions alive would make a password reset useless as a response to a
 * compromise — the intruder would keep their cookie. The person resetting is
 * not signed in either: they land on /login and prove the new password.
 */
auth.post("/reset", async (c) => {
  const { token, password } = await readJson(c, resetPasswordSchema);
  const db = getDb(c.env.DB);

  const [row] = await db
    .select({
      id: passwordResets.id,
      userId: passwordResets.userId,
      email: users.email,
      expiresAt: passwordResets.expiresAt,
      usedAt: passwordResets.usedAt,
    })
    .from(passwordResets)
    .innerJoin(users, eq(users.id, passwordResets.userId))
    .where(eq(passwordResets.tokenHash, await sha256Hex(token)))
    .limit(1);

  // Unknown, already redeemed and expired are one answer on purpose.
  if (!isResetUsable(row)) {
    return apiError(
      c,
      "reset_invalid",
      "That reset link has expired or has already been used.",
    );
  }

  // `isResetUsable` narrowed this, but TypeScript cannot see through it.
  const reset = row as NonNullable<typeof row>;
  const passwordHash = await hashPassword(password);

  await db.batch([
    db.update(users).set({ passwordHash }).where(eq(users.id, reset.userId)),
    // Stamped rather than deleted, so a second click on the same link gets
    // `reset_invalid` from a row that remembers being used.
    db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, reset.id)),
    db.delete(sessions).where(eq(sessions.userId, reset.userId)),
  ]);

  /*
   * Someone who locked themselves out by guessing has almost certainly just
   * reset for that reason; making them wait out the login window after proving
   * control of the mailbox would be punishing the recovery. The IP counter is
   * left alone — see `clearLoginAttempts`.
   */
  await clearLoginAttempts(c.env.CACHE, reset.email);

  // This browser may be holding one of the sessions just deleted.
  clearSessionCookie(c);

  const body: ResetPasswordResponse = { ok: true };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */

auth.post("/logout", async (c) => {
  const session = c.get("session");
  if (session?.kind === "session") {
    await deleteSession(getDb(c.env.DB), session.sessionId);
  }
  // Cleared unconditionally: a stale or unknown cookie should still go away.
  clearSessionCookie(c);
  return c.body(null, 204);
});

auth.get("/me", requireSession, async (c) => {
  const { userId } = requireUserSession(c.get("session"));
  return c.json(await buildMeResponse(getDb(c.env.DB), userId));
});

/**
 * Account deletion. Workspaces this user owns alone are destroyed in full
 * (D1 + KV + R2); shared ones just lose a member. Sessions go with the user
 * row by cascade.
 */
auth.delete("/me", requireSession, async (c) => {
  const { userId } = requireUserSession(c.get("session"));
  const { password } = await readJson(c, deleteAccountSchema);
  const db = getDb(c.env.DB);

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (
    user === undefined ||
    !(await verifyPassword(password, user.passwordHash))
  ) {
    return apiError(c, "invalid_credentials", "Wrong password.");
  }

  const doomed = await soleOwnedWorkspaceIds(db, userId);
  for (const workspaceId of doomed) {
    await deleteWorkspaceEverywhere(
      {
        db,
        kv: c.env.CACHE,
        r2: c.env.BLOBS,
        masterKey: c.env.APP_MASTER_KEY,
      },
      workspaceId,
    );
  }

  // Memberships of workspaces that survive (someone else owns them too).
  await db
    .delete(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  await db.delete(users).where(eq(users.id, userId));

  clearSessionCookie(c);
  return c.body(null, 204);
});

export default auth;
