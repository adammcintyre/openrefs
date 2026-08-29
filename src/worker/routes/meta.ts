/**
 *   GET /api/v1/meta/locations?workspace&engine=google
 *   GET /api/v1/meta/languages?workspace
 *
 * The reference lists that populate the market pickers.
 *
 * These read no tenant data and DataForSEO bills them at $0, so the *response*
 * is cached once for the whole deployment under `meta:` rather than per
 * workspace — see GLOBAL_CACHE_ENDPOINTS in the client, which is the only
 * place per-workspace cache isolation is relaxed and is allowlisted for it.
 *
 * They still take a workspace, for a reason that is not scoping: a DataForSEO
 * call needs credentials, and credentials belong to a workspace. Attributing
 * the (zero-cost) call to the tenant whose key made it keeps `api_usage` a
 * complete record of what we did with their account. Membership is checked at
 * `member`, the same as every other read.
 */
import { Hono } from "hono";
import { z } from "zod";

import type {
  MetaLanguagesResponse,
  MetaLocationsResponse,
} from "../../shared/keywords";
import { createDataForSeoApi } from "../dataforseo";
import { authorizeWorkspace, booleanParam, workspaceParam } from "../lib/research";
import { readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const meta = new Hono<AppEnv>();

meta.use("*", requireSession);

const metaQuerySchema = z.object({
  workspace: workspaceParam,
  fresh: booleanParam,
});

/**
 * Only Google is wired up. The parameter exists because the route is
 * documented with it and other engines are a later phase; accepting an engine
 * we cannot serve and silently returning Google's list would be worse than
 * rejecting it.
 */
const engineSchema = z.enum(["google"]).optional().default("google");

/**
 * The locations list comes from DataForSEO Labs, not the SERP appendix, and
 * the difference is a correctness one rather than a preference: the SERP list
 * runs to ~100k entries down to individual airports, but Labs accepts only
 * country-level codes. Since every keyword and domain endpoint in Phase 1 is a
 * Labs endpoint, offering the SERP list would let someone pick a location that
 * then fails every query they make. Each location carries the languages valid
 * *for it*, so the language select can be driven by the chosen market.
 */
meta.get("/locations", async (c) => {
  const query = readQuery(c, metaQuerySchema.extend({ engine: engineSchema }));
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.meta.locations({ fresh: query.fresh });

  const body: MetaLocationsResponse = {
    locations: result.locations.map((location) => ({
      code: location.code,
      name: location.name,
      countryIsoCode: location.countryIsoCode,
      languages: location.languages.map((language) => ({
        code: language.code,
        name: language.name,
      })),
    })),
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

meta.get("/languages", async (c) => {
  const query = readQuery(c, metaQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.meta.languages({ fresh: query.fresh });

  const body: MetaLanguagesResponse = {
    languages: result.languages,
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

export default meta;
