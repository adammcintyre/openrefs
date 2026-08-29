import { Hono } from "hono";

import { notImplemented } from "../http";
import type { AppEnv } from "../types";

/**
 * Owned by the auth agent. Planned surface (docs/PLAN.md, Phase 0):
 *   POST   /api/v1/auth/register
 *   POST   /api/v1/auth/login
 *   POST   /api/v1/auth/logout
 *   GET    /api/v1/auth/session
 *
 * Password hashing is PBKDF2-SHA256 at 600k iterations via WebCrypto; sessions
 * are httpOnly + secure cookies backed by the `sessions` table. Replace the
 * catch-all below with real handlers — no other file needs to change.
 */
const auth = new Hono<AppEnv>();

auth.all("/*", (c) => notImplemented(c, "Authentication"));

export default auth;
