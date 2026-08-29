import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { BalanceResponse, UsageResponse } from "../../shared/api";
import type { Db } from "../../db";
import { getDb, workspaceMembers } from "../../db";
import { createDataForSeoApi } from "../dataforseo";
import { isDevelopment } from "../dataforseo/credentials";
import { getMonthlyUsage, monthStartUtc } from "../dataforseo/metering";
import { ApiException, apiError } from "../http";
import { AUTH_ENFORCED } from "../middleware/auth";
import type { AppEnv } from "../types";

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

/**
 * The 401 half of the guard, kept free of I/O so it is decidable before a
 * database handle exists.
 *
 * `loadSession` is still the stub that always yields null. Until the auth
 * branch lands, local development would be unable to reach its own routes — so
 * a bypass is allowed, but *only* while auth is unenforced AND we are in
 * development. It removes itself the moment AUTH_ENFORCED flips true, which is
 * exactly when real sessions become available, and a deployed Worker
 * (APP_ENV=production) never takes it.
 */
export function requireSessionOrDevBypass(
  env: Pick<Env, "APP_ENV">,
  session: { userId: string } | null,
): { userId: string } | null {
  if (session !== null) return session;
  if (!AUTH_ENFORCED && isDevelopment(env)) return null;
  throw new ApiException("unauthorized", "Sign in to continue.");
}

/**
 * TODO(merge): adopt requireWorkspaceRole from the auth branch and delete both
 * this and requireSessionOrDevBypass above. The auth agent is building the
 * shared helper in parallel; this is the same check written locally so the two
 * branches never touch the same file.
 *
 * Throws 403 when the session's user is not a member of the workspace.
 */
async function requireWorkspaceMembership(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<string> {
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  const membership = rows[0];
  if (!membership) {
    // Deliberately not 404: whether a workspace exists is not this caller's
    // business, and the two answers must be indistinguishable.
    throw new ApiException(
      "forbidden",
      "You do not have access to this workspace.",
    );
  }
  return membership.role;
}

/** Both halves of the guard, in the order that avoids needless I/O. */
async function authorize(
  env: Env,
  session: { userId: string } | null,
  workspaceId: string,
): Promise<Db> {
  const caller = requireSessionOrDevBypass(env, session);
  const db = getDb(env.DB);
  if (caller) await requireWorkspaceMembership(db, caller.userId, workspaceId);
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
