import { Hono } from "hono";

import { notImplemented } from "../http";
import type { AppEnv } from "../types";

/**
 * Owned by the auth/workspaces agent. Planned surface:
 *   GET/POST         /api/v1/workspaces
 *   GET/PATCH/DELETE /api/v1/workspaces/:id
 *   GET/POST/DELETE  /api/v1/workspaces/:id/members
 *   POST             /api/v1/workspaces/:id/invites
 *   GET/POST/DELETE  /api/v1/workspaces/:id/api-keys
 *
 * DELETE must run the full cascade from docs/ARCHITECTURE.md: the D1 row (FKs
 * do the rest), every KV key under `ws:<id>:`, every R2 object under
 * `ws:<id>/`, and any queued rows in `jobs`.
 */
const workspaces = new Hono<AppEnv>();

workspaces.all("/*", (c) => notImplemented(c, "Workspaces"));

export default workspaces;
