import { and, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";

import { apiUsage, getDb, workspaces } from "../../db";
import { sweepJobs } from "../cron";
import { ApiException } from "../http";
import { createDataForSeoApi } from "../dataforseo";
import { isDevelopment, maskLogin, resolveWorkspaceCredentials } from "../dataforseo/credentials";
import { sumMonthCostUsd } from "../dataforseo/metering";
import { apiError } from "../http";
import type { AppEnv } from "../types";

/**
 * Developer-only smoke routes. Not part of the product surface.
 *
 * Every route in this file is invisible unless APP_ENV === "development": the
 * guard below runs before any handler and answers with the same 404 the app's
 * `notFound` produces, so a deployed Worker is indistinguishable from one that
 * never had these routes compiled in. This file spends real money against a
 * real DataForSEO account, which is exactly why it is gated at the router.
 */
const dev = new Hono<AppEnv>();

/**
 * The workspace this file operates on. Fixed id, created on demand, and
 * deliberately left without stored credentials so `/dfs-smoke` exercises the
 * development env-credential fallback rather than the encrypted path.
 */
export const DEV_WORKSPACE_ID = "dev-workspace";

/** UK / English — the default market in docs/ARCHITECTURE.md. */
const DEV_LOCATION_CODE = 2826;
const DEV_LANGUAGE_CODE = "en";
const DEV_KEYWORD = "seo tools";

dev.use("*", async (c, next) => {
  if (!isDevelopment(c.env)) {
    return apiError(c, "not_found", "No such endpoint.");
  }
  await next();
});

/**
 * The scratch workspace for the spend-cap proof. Separate from
 * DEV_WORKSPACE_ID so the proof can set a cap of 0 and reset it afterwards
 * without disturbing the smoke workspace's own settings or usage history.
 */
export const SPEND_CAP_WORKSPACE_ID = "dev-spend-cap-workspace";

/** What the scratch workspace's cap is restored to when the proof finishes. */
const SPEND_CAP_RESET_USD = 25;

/** What is available here. Free, and reachable only in development. */
dev.get("/", (c) =>
  c.json({
    routes: [
      {
        path: "/api/v1/dev/dfs-smoke",
        description:
          "Runs one live DataForSEO search-volume query twice against the dev workspace and reports cost, cache behaviour and account balance. Spends real money.",
      },
      {
        path: "/api/v1/dev/spend-cap-proof",
        description:
          "Sets a scratch workspace's spend cap to 0, calls a cheap wrapper, and asserts the call is refused with `spend_cap_exceeded` having written no paid api_usage row. Costs nothing — the point is that it never reaches the wire.",
      },
      {
        path: "POST /api/v1/dev/run-jobs",
        description:
          "Runs one jobs sweep synchronously and returns what each claimed job did. The same code path the */5 cron trigger takes, without waiting five minutes for it. May spend money: a claimed rank_post buys SERPs.",
      },
    ],
  }),
);

/**
 * One sweep, now, synchronously.
 *
 * `wrangler dev` does not fire cron triggers, so without this the jobs
 * machinery could only be exercised by waiting for a deployment — which is a
 * poor place to first discover a bug in it. It runs the identical
 * `sweepJobs(env)` the scheduled handler runs, and returns the per-job
 * outcomes the cron handler only logs, so a local run can assert on them.
 *
 * POST, not GET: a sweep mutates the queue and can spend money, and something
 * that does that should not be reachable by a browser following a link.
 */
dev.post("/run-jobs", async (c) => {
  const started = Date.now();
  const result = await sweepJobs(c.env);
  return c.json({
    ...result,
    tookMs: Date.now() - started,
    at: new Date().toISOString(),
  });
});

/**
 * End-to-end proof that the DataForSEO layer works against the real API:
 * the same query twice, so the first call bills and the second must come back
 * `cached: true` at `costUsd: 0`, plus the metered month total and the live
 * account balance to sanity-check our meter against DataForSEO's own number.
 */
dev.get("/dfs-smoke", async (c) => {
  const db = getDb(c.env.DB);

  // Create on demand, never overwrite: a re-run must not reset a spend cap
  // that someone lowered to test the 402 path.
  await db
    .insert(workspaces)
    .values({ id: DEV_WORKSPACE_ID, name: "Dev workspace" })
    .onConflictDoNothing();

  const credentials = await resolveWorkspaceCredentials(
    c.env,
    db,
    DEV_WORKSPACE_ID,
  );
  const dfs = await createDataForSeoApi(c.env, db, DEV_WORKSPACE_ID);

  const query = {
    keywords: [DEV_KEYWORD],
    locationCode: DEV_LOCATION_CODE,
    languageCode: DEV_LANGUAGE_CODE,
  };

  const first = await dfs.keywordsData.googleAdsSearchVolumeLive(query);
  const second = await dfs.keywordsData.googleAdsSearchVolumeLive(query);
  const { balanceUsd } = await dfs.client.balance();

  // Read the meter last so it includes everything above.
  const monthUsd = await sumMonthCostUsd(db, DEV_WORKSPACE_ID, new Date());

  return c.json({
    first: { cached: first.cached, costUsd: first.costUsd },
    second: { cached: second.cached, costUsd: second.costUsd },
    monthUsd,
    balanceUsd,
    // Diagnostics: proof that real data came back and that the env fallback
    // was the path taken. The login is masked — the only form in which a
    // DataForSEO login may leave this Worker.
    login: maskLogin(credentials.login),
    sample: first.keywords.map((k) => ({
      keyword: k.keyword,
      searchVolume: k.searchVolume,
      cpc: k.cpc,
      competition: k.competition,
    })),
  });
});

/**
 * Proof that the spend cap refuses **before** spending, not after.
 *
 * This closes the one path Phase 0 left untested: the 402. Asserting the error
 * code alone would not prove much — a client that called DataForSEO, was
 * billed, and *then* noticed the cap would produce the same 402. So the proof
 * is two claims together:
 *
 *   1. the wrapper call raises ApiException with code `spend_cap_exceeded`, and
 *   2. no `api_usage` row with `cost_usd > 0` appeared while it ran.
 *
 * The second is what makes the first mean anything.
 *
 * Runs against its own scratch workspace, with a `fresh: true` query so a
 * cached entry cannot make the call succeed for the wrong reason (cached reads
 * are always allowed, by design, even at a $0 cap). The cap is restored in a
 * `finally`, so a failing assertion cannot leave a workspace pinned at zero.
 */
dev.get("/spend-cap-proof", async (c) => {
  const db = getDb(c.env.DB);

  await db
    .insert(workspaces)
    .values({
      id: SPEND_CAP_WORKSPACE_ID,
      name: "Spend cap proof workspace",
      spendCapUsd: 0,
    })
    .onConflictDoNothing();

  // Explicit update as well as the insert default: the row may already exist
  // from a previous run with the cap restored to 25.
  await db
    .update(workspaces)
    .set({ spendCapUsd: 0 })
    .where(eq(workspaces.id, SPEND_CAP_WORKSPACE_ID));

  const paidRowsBefore = await countPaidUsageRows(db);
  const totalRowsBefore = await countUsageRows(db);

  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let httpStatus: number | null = null;
  let unexpectedlySucceeded = false;

  try {
    const dfs = await createDataForSeoApi(c.env, db, SPEND_CAP_WORKSPACE_ID);
    await dfs.keywordsData.googleAdsSearchVolumeLive({
      keywords: [DEV_KEYWORD],
      locationCode: DEV_LOCATION_CODE,
      languageCode: DEV_LANGUAGE_CODE,
      // Bypass the cache: a hit would be allowed at a $0 cap and would prove
      // nothing about the cap itself.
      fresh: true,
    });
    unexpectedlySucceeded = true;
  } catch (err) {
    if (err instanceof ApiException) {
      errorCode = err.code;
      errorMessage = err.message;
      httpStatus = err.status;
    } else {
      errorCode = "unknown";
      errorMessage = err instanceof Error ? err.name : "non-error thrown";
    }
  } finally {
    await db
      .update(workspaces)
      .set({ spendCapUsd: SPEND_CAP_RESET_USD })
      .where(eq(workspaces.id, SPEND_CAP_WORKSPACE_ID));
  }

  const paidRowsAfter = await countPaidUsageRows(db);
  const totalRowsAfter = await countUsageRows(db);

  const refusedCorrectly = errorCode === "spend_cap_exceeded";
  const spentNothing = paidRowsAfter === paidRowsBefore;
  const passed = refusedCorrectly && spentNothing && !unexpectedlySucceeded;

  const [restored] = await db
    .select({ spendCapUsd: workspaces.spendCapUsd })
    .from(workspaces)
    .where(eq(workspaces.id, SPEND_CAP_WORKSPACE_ID))
    .limit(1);

  return c.json(
    {
      passed,
      assertions: {
        refusedWithSpendCapExceeded: refusedCorrectly,
        wroteNoPaidUsageRow: spentNothing,
        didNotReachDataForSeo: !unexpectedlySucceeded,
        capRestored: restored?.spendCapUsd === SPEND_CAP_RESET_USD,
      },
      observed: {
        errorCode,
        errorMessage,
        httpStatus,
        paidUsageRows: { before: paidRowsBefore, after: paidRowsAfter },
        // Any row at all is expected to stay flat too: the refusal happens
        // before the call, so not even a $0 row should be written.
        allUsageRows: { before: totalRowsBefore, after: totalRowsAfter },
        spendCapUsdAfterReset: restored?.spendCapUsd ?? null,
      },
      workspaceId: SPEND_CAP_WORKSPACE_ID,
    },
    passed ? 200 : 500,
  );
});

/** Paid rows for the scratch workspace, all time. */
async function countPaidUsageRows(
  db: ReturnType<typeof getDb>,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(apiUsage)
    .where(
      and(
        eq(apiUsage.workspaceId, SPEND_CAP_WORKSPACE_ID),
        gt(apiUsage.costUsd, 0),
      ),
    );
  return Number(row?.total ?? 0);
}

async function countUsageRows(db: ReturnType<typeof getDb>): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(apiUsage)
    .where(eq(apiUsage.workspaceId, SPEND_CAP_WORKSPACE_ID));
  return Number(row?.total ?? 0);
}

export default dev;
