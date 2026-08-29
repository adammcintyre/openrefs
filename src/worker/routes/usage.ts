import { Hono } from "hono";

import { notImplemented } from "../http";
import type { AppEnv } from "../types";

/**
 * Owned by the DataForSEO agent. Planned surface:
 *   GET /api/v1/usage           spend rolled up from `api_usage`
 *   GET /api/v1/usage/balance   passthrough of DataForSEO appendix/user_data
 *
 * Reads `api_usage` over the (workspace_id, created_at) index; the balance
 * route is the one DataForSEO call that is never cached.
 */
const usage = new Hono<AppEnv>();

usage.all("/*", (c) => notImplemented(c, "Usage reporting"));

export default usage;
