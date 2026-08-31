/**
 *   GET  /api/v1/content/discover   compose SERPs → deduped pages → enriched
 *   POST /api/v1/content/wordcount  on_page content_parsing, ≤10 URLs
 *
 * Workspace-scoped with the same guard as every other research route.
 * Responses are the shared types in src/shared/content.ts.
 *
 * The `/discover` handler is deliberately thin. The composition it runs — the
 * four wrappers, the composed cache, the free filter/sort/page over it, and
 * the notes explaining all of them — lives in `../services/content`, because
 * it is an MCP tool as well as an endpoint and both callers must produce
 * identical bodies. This file owns the query schemas, the session guard and
 * the workspace proof.
 */
import { Hono } from "hono";
import { z } from "zod";

import type {
  ContentWordCountResponse,
  ContentWordCountRow,
} from "../../shared/content";
import {
  CONTENT_DEFAULT_ROWS,
  CONTENT_EXPAND_OPTIONS,
  CONTENT_MAX_ROWS,
  CONTENT_SORTS,
  CONTENT_WORDCOUNT_MAX_URLS,
} from "../../shared/content";
import { createDataForSeoApi } from "../dataforseo";
import {
  authorizeWorkspace,
  booleanParam,
  marketQuerySchema,
  offsetParam,
} from "../lib/research";
import { readJson, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import { contentDiscover } from "../services/content";
import type { AppEnv } from "../types";

/*
 * Re-exported, not redefined: the composition arithmetic moved to
 * ../services/content with the handler that uses it, and the tests reach for
 * it here. There is exactly one definition of each.
 */
export {
  batch,
  filterContentRows,
  mergeSerpPages,
  normalizeSerpDomain,
  sortContentRows,
} from "../services/content";

const content = new Hono<AppEnv>();

content.use("*", requireSession);

const discoverQuerySchema = marketQuerySchema
  .extend({
    topic: z.string().trim().min(1).max(700),
    /**
     * Coerced from the query string and restricted to the three the UI offers,
     * because each is a different price and an arbitrary number here would be
     * an arbitrary bill.
     */
    expand: z.coerce
      .number()
      .int()
      .refine(
        (value): value is (typeof CONTENT_EXPAND_OPTIONS)[number] =>
          (CONTENT_EXPAND_OPTIONS as readonly number[]).includes(value),
        `expand must be one of ${CONTENT_EXPAND_OPTIONS.join(", ")}.`,
      )
      .optional()
      .default(0),
    fresh: booleanParam,
    /** THE knob. Empty means no cap, which is the honest default. */
    maxDomainScore: z.coerce.number().min(0).max(100).optional(),
    minTraffic: z.coerce.number().min(0).optional(),
    include: z.string().trim().min(1).optional(),
    exclude: z.string().trim().min(1).optional(),
    sort: z.enum(CONTENT_SORTS).optional().default("estTraffic"),
    /*
     * Bounded by CONTENT_MAX_ROWS rather than the shared `limitParam`, even
     * though the two numbers currently agree: this cap is a property of the
     * Content Discovery contract the UI reads, and tying it to a constant in
     * another module would let one move without the other.
     */
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONTENT_MAX_ROWS)
      .optional()
      .default(CONTENT_DEFAULT_ROWS),
    offset: offsetParam.optional().default(0),
  });

const wordCountBodySchema = z.object({
  urls: z
    .array(z.string().trim().min(1).max(2048))
    .min(1)
    .max(CONTENT_WORDCOUNT_MAX_URLS),
});

const workspaceQuerySchema = z.object({
  workspace: marketQuerySchema.shape.workspace,
});

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

content.get("/discover", async (c) => {
  const query = readQuery(c, discoverQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  return c.json(await contentDiscover(c.env, db, query));
});

/**
 * POST /api/v1/content/wordcount
 *
 * Separate from `/discover`, and per selected row rather than per result set,
 * because it is the one part of this module priced per URL: counting a
 * 200-row sweep would cost 200 calls to fill a column most people glance at
 * for five. `content_parsing` takes exactly one URL per call, so this fans out
 * — `CONTENT_WORDCOUNT_MAX_URLS` is what bounds the fan-out.
 */
content.post("/wordcount", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { urls } = await readJson(c, wordCountBodySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  const dfs = await createDataForSeoApi(c.env, db, workspace);

  // De-duplicated so a caller sending the same URL twice is billed once; the
  // response is keyed by URL, so nothing is lost by collapsing them.
  const unique = [...new Set(urls.map((url) => url.trim()))].filter(Boolean);

  const parsed = await Promise.all(
    unique.map((url) => dfs.onPage.contentParsingLive({ url })),
  );

  const items: ContentWordCountRow[] = parsed.map((page) => ({
    url: page.url,
    wordCount: page.wordCount,
    statusCode: page.statusCode,
  }));

  const body: ContentWordCountResponse = {
    items,
    counted: items.filter((item) => item.wordCount !== null).length,
    submitted: items.length,
    costUsd: parsed.reduce((sum, page) => sum + page.costUsd, 0),
    // Cached only if every URL was — one paid parse makes the response paid.
    cached: parsed.length > 0 && parsed.every((page) => page.cached),
    stale: parsed.some((page) => page.stale === true),
  };
  return c.json(body);
});

export default content;
