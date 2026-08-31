/**
 *   GET    /api/v1/history        the trail for one module, newest first
 *   DELETE /api/v1/history/:id    forget one search
 *   DELETE /api/v1/history        clear one module's trail
 *
 * Pure D1 — no DataForSEO call, no cost. Rows are written by the research
 * routes through `../services/history`; this module only reads and forgets.
 *
 * Workspace-scoped at the `member` role, and — exactly as in
 * routes/collections.ts — every query carries the workspace predicate, so an id
 * from another tenant reads as "not found" rather than confirming it exists.
 */
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { searchHistory } from "../../db";
import type { HistoryDeletedResponse } from "../../shared/history";
import {
  HISTORY_DEFAULT_LIMIT,
  HISTORY_MAX_LIMIT,
  HISTORY_MODULES,
} from "../../shared/history";
import { ApiException } from "../http";
import { authorizeWorkspace, workspaceParam } from "../lib/research";
import { readParams, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import { listHistory, moduleScope } from "../services/history";
import type { AppEnv } from "../types";

const history = new Hono<AppEnv>();

history.use("*", requireSession);

/** `?module=keywords` — required: a trail is always one module's. */
const moduleParam = z.enum(HISTORY_MODULES);

/**
 * Clamped rather than rejected above the ceiling: a panel asking for more rows
 * than we keep should get the most we have, not an error. `HISTORY_MAX_LIMIT`
 * is the ceiling because this list is a sidebar, not an export.
 */
const limitParam = z.coerce
  .number()
  .int()
  .min(1)
  .optional()
  .default(HISTORY_DEFAULT_LIMIT)
  .transform((value) => Math.min(value, HISTORY_MAX_LIMIT));

const listQuerySchema = z.object({
  workspace: workspaceParam,
  module: moduleParam,
  limit: limitParam,
});

const clearQuerySchema = z.object({
  workspace: workspaceParam,
  module: moduleParam,
});

const deleteOneQuerySchema = z.object({ workspace: workspaceParam });
const idParamSchema = z.object({ id: z.string().trim().min(1) });

history.get("/", async (c) => {
  const { workspace, module, limit } = readQuery(c, listQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  return c.json(await listHistory(db, workspace, module, limit));
});

/**
 * DELETE /api/v1/history/:id
 *
 * The module is not in the query on purpose — the caller has a row id from a
 * list it was already given, and requiring it to restate which module the row
 * belongs to would be a second chance to get it wrong. The workspace predicate
 * is what makes this safe: without it, a row id would be a capability.
 */
history.delete("/:id", async (c) => {
  const { workspace } = readQuery(c, deleteOneQuerySchema);
  const { id } = readParams(c, idParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const deleted = await db
    .delete(searchHistory)
    .where(
      and(eq(searchHistory.id, id), eq(searchHistory.workspaceId, workspace)),
    )
    .returning({ id: searchHistory.id });

  if (deleted.length === 0) {
    // Also the answer for a real row in someone else's workspace, which is the
    // point: a 404 here tells a caller nothing it did not already know.
    throw new ApiException("not_found", "No such search in this workspace.");
  }

  const body: HistoryDeletedResponse = { deleted: deleted.length };
  return c.json(body);
});

/**
 * DELETE /api/v1/history?workspace=…&module=…
 *
 * Clearing an empty trail is a success answering `{ deleted: 0 }`, not a 404:
 * the caller asked for the trail to be empty, and it is.
 */
history.delete("/", async (c) => {
  const { workspace, module } = readQuery(c, clearQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const deleted = await db
    .delete(searchHistory)
    .where(moduleScope(workspace, module))
    .returning({ id: searchHistory.id });

  const body: HistoryDeletedResponse = { deleted: deleted.length };
  return c.json(body);
});

export default history;
