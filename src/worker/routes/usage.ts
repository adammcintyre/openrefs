import { Hono } from "hono";
import { z } from "zod";

import type { BalanceResponse, UsageResponse } from "../../shared/api";
import type { Db } from "../../db";
import { getDb } from "../../db";
import { createDataForSeoApi } from "../dataforseo";
import { getMonthlyUsage, monthStartUtc } from "../dataforseo/metering";
import { apiError } from "../http";
import { requireWorkspaceRole } from "../lib/authorization";
import { requireSession } from "../middleware/auth";
import type { AppEnv, SessionContext } from "../types";

/**
 *   GET /api/v1/usage?workspace=<id>          spend rolled up from `api_usage`
 *   GET /api/v1/usage/balance?workspace=<id>  DataForSEO appendix/user_data
 *
 * Reads `api_usage` over the (workspace_id, created_at) index. Both routes are
 * workspace-scoped and verify membership explicitly — never "the user's first
 * workspace", per the orchestrator contract in docs/ARCHITECTURE.md.
 */
const usage = new Hono<AppEnv>();

const workspaceQuerySchema = z.object({
  workspace: z.string().trim().min(1, "A workspace id is required."),
});

/**
 * The balance micro-cache. docs/ARCHITECTURE.md says balance/user_data is
 * "never cached", and the DataForSEO client honours that literally: `balance()`
 * is in the `none` TTL bucket and always hits the wire.
 *
 * This is the one documented exception, and it lives here rather than in the
 * client on purpose. It exists to protect DataForSEO (and our rate limit) from
 * a dashboard that mounts a balance widget on every page: 60 seconds is short
 * enough that a user who just spent money sees it move on their next look, and
 * long enough that a page with five components asking at once costs one call.
 * The key sits under the same `ws:<id>:` prefix as everything else so workspace
 * deletion sweeps it away with the rest.
 */
const BALANCE_CACHE_TTL_SECONDS = 60;
const balanceCacheKey = (workspaceId: string) => `ws:${workspaceId}:dfs-balance`;

// Every usage route needs a caller: a signed-in user or a workspace API key.
usage.use("*", requireSession);

/**
 * Membership proof plus a request-scoped db handle, in one call. API keys pass
 * at `member`, which is exactly the read access these reporting routes need.
 * Non-membership and a nonexistent workspace are indistinguishable (403).
 */
async function authorize(
  env: Env,
  session: SessionContext | null,
  workspaceId: string,
): Promise<Db> {
  const db = getDb(env.DB);
  await requireWorkspaceRole(db, session, workspaceId, "member");
  return db;
}

usage.get("/", async (c) => {
  const parsed = workspaceQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return apiError(
      c,
      "validation_failed",
      "Invalid query parameters.",
      z.flattenError(parsed.error),
    );
  }
  const workspaceId = parsed.data.workspace;

  const db = await authorize(c.env, c.get("session"), workspaceId);

  const now = new Date();
  const monthly = await getMonthlyUsage(db, workspaceId, now);

  const body: UsageResponse = {
    periodStart: monthStartUtc(now).toISOString(),
    ...monthly,
  };
  return c.json(body);
});

usage.get("/balance", async (c) => {
  const parsed = workspaceQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return apiError(
      c,
      "validation_failed",
      "Invalid query parameters.",
      z.flattenError(parsed.error),
    );
  }
  const workspaceId = parsed.data.workspace;

  const db = await authorize(c.env, c.get("session"), workspaceId);

  const key = balanceCacheKey(workspaceId);
  const cached = await c.env.CACHE.get<{ balanceUsd: number }>(key, "json");
  if (cached && typeof cached.balanceUsd === "number") {
    const body: BalanceResponse = { balanceUsd: cached.balanceUsd, cached: true };
    return c.json(body);
  }

  const dfs = await createDataForSeoApi(c.env, db, workspaceId);
  const { balanceUsd } = await dfs.client.balance();

  await c.env.CACHE.put(key, JSON.stringify({ balanceUsd }), {
    expirationTtl: BALANCE_CACHE_TTL_SECONDS,
  });

  const body: BalanceResponse = { balanceUsd, cached: false };
  return c.json(body);
});

export default usage;
