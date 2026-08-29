/**
 * Spend accounting for DataForSEO calls.
 *
 * Everything here reads or writes `api_usage`, the single source of truth for
 * "what has this workspace spent". It is deliberately separate from client.ts
 * so the spend-cap decision is a pure function that can be tested without a
 * database, and so the `/api/v1/usage` route and the client agree on what a
 * "month" is by construction rather than by comment.
 *
 * The period is a **calendar month in UTC**, per the orchestrator contract in
 * docs/ARCHITECTURE.md. Not a rolling 30 days, and not the host's local month.
 */
import { and, eq, gte, sql } from "drizzle-orm";

import type { Db } from "../../db";
import { apiUsage } from "../../db";

/**
 * Start of the UTC calendar month containing `now`. The cap resets at this
 * instant; usage reports cover `[monthStartUtc(now), now]`.
 */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * The spend-cap decision, per docs/ARCHITECTURE.md:
 *
 *  - `capUsd === 0` blocks every paid call. This is the "read-only workspace"
 *    setting, not an accident, so it is checked before the spend comparison.
 *  - `capUsd > 0` is a ceiling on the month's summed `cost_usd`. Reaching the
 *    ceiling exactly counts as over: the next call would spend past it, and a
 *    cap that can be exceeded by one call is not a cap.
 * A call is allowed only when the cap is a real, finite ceiling the workspace
 * is demonstrably under. Negative, NaN and infinite caps are all corrupt rows
 * or encodings this function was never taught, so all of them block: failing
 * closed on a money guard costs a confused user one support message, failing
 * open costs them money.
 *
 * Cache hits never reach this function — cached reads cost nothing and are
 * always allowed, even at $0.
 */
export function isOverCap(spentUsd: number, capUsd: number): boolean {
  if (!Number.isFinite(capUsd) || capUsd <= 0) return true;
  if (!Number.isFinite(spentUsd)) return true;
  return spentUsd >= capUsd;
}

/** Summed `cost_usd` for the workspace so far this UTC calendar month. */
export async function sumMonthCostUsd(
  db: Db,
  workspaceId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${apiUsage.costUsd}), 0)` })
    .from(apiUsage)
    .where(
      and(
        eq(apiUsage.workspaceId, workspaceId),
        gte(apiUsage.createdAt, monthStartUtc(now)),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

export interface EndpointUsage {
  endpoint: string;
  requests: number;
  costUsd: number;
}

export interface MonthlyUsage {
  totalUsd: number;
  requestCount: number;
  /** Share of this month's requests served from KV, 0–1. 0 when there are none. */
  cacheHitRate: number;
  byEndpoint: EndpointUsage[];
}

/**
 * The `/api/v1/usage` payload: one grouped scan of `api_usage` over the
 * (workspace_id, created_at) index, rolled up in SQL rather than in the
 * Worker so a busy month does not stream every row into memory.
 */
export async function getMonthlyUsage(
  db: Db,
  workspaceId: string,
  now: Date,
): Promise<MonthlyUsage> {
  const rows = await db
    .select({
      endpoint: apiUsage.endpoint,
      requests: sql<number>`count(*)`,
      costUsd: sql<number>`coalesce(sum(${apiUsage.costUsd}), 0)`,
      cachedRequests: sql<number>`coalesce(sum(case when ${apiUsage.cached} then 1 else 0 end), 0)`,
    })
    .from(apiUsage)
    .where(
      and(
        eq(apiUsage.workspaceId, workspaceId),
        gte(apiUsage.createdAt, monthStartUtc(now)),
      ),
    )
    .groupBy(apiUsage.endpoint)
    .orderBy(sql`sum(${apiUsage.costUsd}) desc`);

  let totalUsd = 0;
  let requestCount = 0;
  let cachedCount = 0;
  const byEndpoint: EndpointUsage[] = [];

  for (const row of rows) {
    const requests = Number(row.requests ?? 0);
    const costUsd = Number(row.costUsd ?? 0);
    totalUsd += costUsd;
    requestCount += requests;
    cachedCount += Number(row.cachedRequests ?? 0);
    byEndpoint.push({ endpoint: row.endpoint, requests, costUsd });
  }

  return {
    // Float sums of many small costs drift; DataForSEO bills in fractions of a
    // cent, so six places is well past anything we could be wrong about.
    totalUsd: round(totalUsd, 6),
    requestCount,
    cacheHitRate: requestCount === 0 ? 0 : round(cachedCount / requestCount, 4),
    byEndpoint: byEndpoint.map((e) => ({ ...e, costUsd: round(e.costUsd, 6) })),
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
