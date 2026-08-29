import { Hono } from "hono";

import { getDb, workspaces } from "../../db";
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

/** What is available here. Free, and reachable only in development. */
dev.get("/", (c) =>
  c.json({
    routes: [
      {
        path: "/api/v1/dev/dfs-smoke",
        description:
          "Runs one live DataForSEO search-volume query twice against the dev workspace and reports cost, cache behaviour and account balance. Spends real money.",
      },
    ],
  }),
);

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

export default dev;
