import { createMiddleware } from "hono/factory";

import { apiError } from "../http";
import type { AppEnv } from "../types";

/**
 * Stub. Owned by the auth agent — replace the body, keep the export names.
 *
 * Flip to `true` once `loadSession` actually verifies the session cookie
 * against the `sessions` table. While it is `false` the guard is a
 * pass-through, so the scaffold's routes stay reachable during development.
 */
export const AUTH_ENFORCED = false;

/**
 * Populates `c.var.session` when a valid session cookie is present, and leaves
 * it null otherwise. Never rejects — mount it app-wide, then use
 * `requireSession` on the routes that actually need a user.
 */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  // TODO(auth): read the session cookie, look it up in `sessions`, check
  // expires_at, and set the resolved SessionContext here.
  c.set("session", null);
  await next();
});

/** Guard for routes that require a signed-in user. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (AUTH_ENFORCED && c.get("session") === null) {
    return apiError(c, "unauthorized", "Sign in to continue.");
  }
  await next();
});
