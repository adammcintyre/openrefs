/**
 *   GET /api/v1/keywords/overview      labs keyword_overview (one call)
 *   GET /api/v1/keywords/ideas         labs keyword_ideas
 *   GET /api/v1/keywords/suggestions   labs keyword_suggestions
 *   GET /api/v1/keywords/related       labs related_keywords
 *   GET /api/v1/keywords/serp          serp google organic live advanced
 *
 * Every route is workspace-scoped and proves membership before it spends.
 * Responses are the shared types in src/shared/keywords.ts.
 *
 * The handlers are deliberately thin. What each one *does* lives in
 * `../services/keywords`, because three of these are MCP tools as well as
 * endpoints and both callers must produce identical bodies. This file owns the
 * query schemas, the session guard and the workspace proof; the service owns
 * the upstream call and the mapping.
 */
import { Hono } from "hono";
import { z } from "zod";

import { RELATED_KEYWORDS_MAX_DEPTH } from "../dataforseo";
import { readQuery } from "../lib/validate";
import {
  authorizeWorkspace,
  booleanParam,
  marketQuerySchema,
  pagingQuerySchema,
  rangeQuerySchema,
} from "../lib/research";
import { requireSession } from "../middleware/auth";
import {
  keywordIdeas,
  keywordOverview,
  keywordRelated,
  keywordSerp,
  keywordSuggestions,
} from "../services/keywords";
import type { AppEnv } from "../types";

const keywords = new Hono<AppEnv>();

keywords.use("*", requireSession);

const keywordQuerySchema = marketQuerySchema.extend({
  keyword: z.string().trim().min(1).max(700),
});

export const keywordListQuerySchema = keywordQuerySchema
  .extend({ fresh: booleanParam })
  .extend(pagingQuerySchema.shape)
  .extend(rangeQuerySchema.shape)
  .extend({
    /** Substring the keyword must contain / must not contain. */
    include: z.string().trim().min(1).optional(),
    exclude: z.string().trim().min(1).optional(),
  });

export const keywordOverviewQuerySchema = keywordQuerySchema.extend({
  fresh: booleanParam,
});

export const keywordSerpQuerySchema = keywordQuerySchema.extend({
  fresh: booleanParam,
  device: z.enum(["desktop", "mobile"]).optional(),
});

keywords.get("/overview", async (c) => {
  const query = readQuery(c, keywordOverviewQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  return c.json(await keywordOverview(c.env, db, query));
});

keywords.get("/ideas", async (c) => {
  const query = readQuery(c, keywordListQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  return c.json(await keywordIdeas(c.env, db, query));
});

keywords.get("/suggestions", async (c) => {
  const query = readQuery(c, keywordListQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  return c.json(await keywordSuggestions(c.env, db, query));
});

keywords.get("/related", async (c) => {
  const query = readQuery(
    c,
    keywordListQuerySchema.extend({
      depth: z.coerce
        .number()
        .int()
        .min(0)
        .max(RELATED_KEYWORDS_MAX_DEPTH)
        .optional(),
    }),
  );
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  return c.json(await keywordRelated(c.env, db, query));
});

keywords.get("/serp", async (c) => {
  const query = readQuery(c, keywordSerpQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  return c.json(await keywordSerp(c.env, db, query));
});

export default keywords;
