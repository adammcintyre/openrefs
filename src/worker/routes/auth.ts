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
  users,
  workspaceMembers,
  workspaces,
  type Db,
} from "../../db";
import type { MeResponse } from "../../shared/auth";
import {
  deleteAccountSchema,
  loginSchema,
  registerSchema,
} from "../../shared/auth";
import { ApiException, apiError } from "../http";
import {
  requireUserSession,
  soleOwnedWorkspaceIds,
} from "../lib/authorization";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { deleteWorkspaceEverywhere } from "../lib/deletion";
import {
  clearLoginAttempts,
  isLoginBlocked,
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

  if (await isLoginBlocked(kv, email)) {
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
    await recordFailedLogin(kv, email);
    return apiError(c, "invalid_credentials", "Wrong email or password.");
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordFailedLogin(kv, email);
    return apiError(c, "invalid_credentials", "Wrong email or password.");
  }

  await clearLoginAttempts(kv, email);

  const { token, expiresAt } = await createSession(db, user.id);
  setSessionCookie(c, token, expiresAt);

  return c.json(await buildMeResponse(db, user.id));
});

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
      { db, kv: c.env.CACHE, r2: c.env.BLOBS },
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
