/**
 * The MCP tool catalogue.
 *
 * Every tool is a thin adapter: validate the arguments, then call the same
 * function in `src/worker/services/` that the matching REST route calls. No
 * tool reimplements a mapping, and no tool reaches DataForSEO directly — which
 * means caching, cost metering and the spend cap apply to an agent exactly as
 * they apply to the SPA, because they live in the client underneath.
 *
 * ## The workspace is implicit
 *
 * The REST API takes `?workspace=<id>` on every scoped route. Tools take no
 * such argument, and must not: an API key is minted for exactly one workspace
 * and can never act outside it (`ApiKeySessionContext.workspaceId`), so a
 * workspace parameter would be either redundant or a lie. The transport
 * resolves the key, and the resolved id arrives here in `ToolContext`.
 *
 * ## Schemas
 *
 * Argument schemas are zod, and the JSON Schema each tool advertises is
 * derived from that zod schema with `z.toJSONSchema(..., { io: "input" })`.
 * One definition, so the schema a client validates against and the schema the
 * server enforces cannot disagree. Input mode is the right projection: a field
 * with a default is *optional to send* and its default is advertised, whereas
 * output mode would mark it required because it is always present afterwards.
 */
import { z } from "zod";

import type { Db } from "../../db";
import { MAX_LIMIT } from "../lib/research";
import { COLLECTION_KEYWORDS_BULK_MAX } from "../../shared/collections";
import { CONTENT_EXPAND_OPTIONS, CONTENT_MAX_ROWS, CONTENT_SORTS } from "../../shared/content";
import { GAP_MAX_COMPETITORS, GAP_MODES } from "../../shared/gap";
import { backlinksSummary } from "../services/backlinks";
import { addKeywordsToCollection, listCollections } from "../services/collections";
import { contentDiscover } from "../services/content";
import { domainKeywords, domainOverview } from "../services/domains";
import { gapKeywords } from "../services/gap";
import {
  keywordIdeas,
  keywordOverview,
  keywordSerp,
} from "../services/keywords";
import { listProjects, trackedKeywordsForProject } from "../services/projects";

/** Everything a tool needs, once the transport has authenticated the caller. */
export interface ToolContext {
  env: Env;
  db: Db;
  /** The API key's workspace. Tools never take one as an argument. */
  workspaceId: string;
}

/** A JSON Schema object, as `tools/list` publishes it. */
export type JsonSchema = Record<string, unknown>;

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Parses raw arguments and runs the tool. Throws `ApiException` on refusal. */
  run: (ctx: ToolContext, args: unknown) => Promise<unknown>;
}

/* -------------------------------------------------------------------------- */
/* Shared argument fragments                                                   */
/* -------------------------------------------------------------------------- */

/*
 * UK / English, the same defaults as `marketSchema` in src/shared/schemas.ts.
 * Defaulted rather than required on purpose: an agent asked "how hard is
 * 'seo tools'?" has no way to know that 2826 means the United Kingdom, and
 * failing the call over it would be a worse answer than picking the documented
 * default and saying so in the response (every response echoes back the
 * `locationCode` and `languageCode` it used).
 */
const location = z
  .number()
  .int()
  .positive()
  .default(2826)
  .describe(
    "DataForSEO numeric location code. 2826 = United Kingdom, 2840 = United States. Call the REST endpoint /api/v1/meta/locations for the full list.",
  );

const language = z
  .string()
  .trim()
  .min(2)
  .max(8)
  .default("en")
  .describe("ISO 639-1 language code, e.g. 'en'. Must be a language the chosen location supports.");

const fresh = z
  .boolean()
  .optional()
  .describe(
    "Bypass the cache and buy a fresh answer. Costs money every time; leave unset unless the caller explicitly asked for current data.",
  );

const limit = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(50)
  .describe(`Rows to return, 1-${MAX_LIMIT}.`);

const offset = z.number().int().min(0).default(0).describe("Rows to skip, for paging.");

const keywordArg = z.string().trim().min(1).max(700);
const domainArg = z
  .string()
  .trim()
  .min(1)
  .describe("Bare hostname, e.g. 'example.com'. A scheme, 'www.' and any path are stripped.");

/* -------------------------------------------------------------------------- */
/* Argument schemas                                                            */
/* -------------------------------------------------------------------------- */

const keywordOverviewArgs = z.object({
  keyword: keywordArg.describe("The keyword to look up."),
  location,
  language,
  fresh,
});

const keywordIdeasArgs = z.object({
  keyword: keywordArg.describe("Seed keyword to expand."),
  location,
  language,
  limit,
  offset,
  minVolume: z.number().min(0).optional().describe("Drop keywords under this monthly search volume."),
  maxVolume: z.number().min(0).optional(),
  minDifficulty: z.number().min(0).max(100).optional().describe("Keyword difficulty floor, 0-100."),
  maxDifficulty: z.number().min(0).max(100).optional(),
  include: z.string().trim().min(1).optional().describe("Only keywords containing this substring."),
  exclude: z.string().trim().min(1).optional().describe("Drop keywords containing this substring."),
  fresh,
});

const keywordSerpArgs = z.object({
  keyword: keywordArg.describe("The query to read the SERP for."),
  location,
  language,
  device: z.enum(["desktop", "mobile"]).optional(),
  fresh,
});

const domainOverviewArgs = z.object({
  domain: domainArg,
  location,
  language,
  fresh,
});

const domainKeywordsArgs = z.object({
  domain: domainArg,
  location,
  language,
  limit,
  offset,
  paid: z
    .boolean()
    .optional()
    .describe(
      "Fetch the paid (Google Ads) side instead of the organic one. Not a filter over shared rows: it changes what is fetched upstream, so each side is a separate billed query.",
    ),
  minPosition: z.number().int().min(1).optional().describe("Best SERP position to include."),
  maxPosition: z.number().int().min(1).optional().describe("Worst SERP position to include."),
  minVolume: z.number().min(0).optional(),
  maxVolume: z.number().min(0).optional(),
  include: z.string().trim().min(1).optional(),
  exclude: z.string().trim().min(1).optional(),
  fresh,
});

const backlinksSummaryArgs = z.object({
  target: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .describe(
      "A domain, a subdomain, or an absolute page URL. A link profile is not per-market, so this tool takes no location or language.",
    ),
  fresh,
});

const gapKeywordsArgs = z.object({
  target: domainArg.describe("Your domain — the 'you' side of the comparison."),
  competitors: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(GAP_MAX_COMPETITORS)
    .describe(
      `Competitor hostnames, 1-${GAP_MAX_COMPETITORS}. Each one is a separate billed upstream call (two when mode is 'all').`,
    ),
  location,
  language,
  mode: z
    .enum(GAP_MODES)
    .default("missing")
    .describe(
      "missing = you do not rank and EVERY competitor does. untapped = you do not rank and AT LEAST ONE does (strictly broader). weak = you rank but at least one competitor ranks higher. all = no filter. Switching mode filters rows already fetched, so it costs nothing extra.",
    ),
  limit,
  offset,
  minVolume: z.number().min(0).optional(),
  maxVolume: z.number().min(0).optional(),
  minDifficulty: z.number().min(0).max(100).optional(),
  maxDifficulty: z.number().min(0).max(100).optional(),
  include: z.string().trim().min(1).optional(),
  exclude: z.string().trim().min(1).optional(),
  fresh,
});

const contentDiscoverArgs = z.object({
  topic: z.string().trim().min(1).max(700).describe("The subject to sweep SERPs for."),
  location,
  language,
  expand: z
    .number()
    .int()
    .refine((value) => (CONTENT_EXPAND_OPTIONS as readonly number[]).includes(value), {
      message: `expand must be one of ${CONTENT_EXPAND_OPTIONS.join(", ")}.`,
    })
    .default(0)
    .describe(
      `How many related keywords to also fetch SERPs for. One of ${CONTENT_EXPAND_OPTIONS.join(", ")}; each one is another billed SERP.`,
    ),
  maxDomainScore: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "Keep only pages whose domain scores at or below this (0-100). Pages with an unknown Domain Score are KEPT — unknown authority is not high authority.",
    ),
  minTraffic: z
    .number()
    .min(0)
    .optional()
    .describe("Keep only pages with at least this estimated monthly traffic. Pages with unknown traffic are dropped."),
  include: z.string().trim().min(1).optional().describe("Only pages whose URL contains this substring."),
  exclude: z.string().trim().min(1).optional(),
  sort: z.enum(CONTENT_SORTS).default("estTraffic"),
  limit: z.number().int().min(1).max(CONTENT_MAX_ROWS).default(50),
  offset,
  fresh,
});

const listCollectionsArgs = z.object({});

const addKeywordsArgs = z.object({
  collectionId: z
    .string()
    .trim()
    .min(1)
    .describe("Collection id, from list_collections."),
  keywords: z
    .array(
      z.object({
        keyword: z.string().trim().min(1).max(700),
        volumeSnapshot: z
          .number()
          .int()
          .min(0)
          .nullish()
          .describe("Search volume at save time, kept so a list stays comparable against itself."),
      }),
    )
    .min(1)
    .max(COLLECTION_KEYWORDS_BULK_MAX),
  location: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Market to stamp on this batch. Give both location and language, or neither."),
  language: z.string().trim().min(2).max(8).optional(),
});

const listProjectsArgs = z.object({});

const trackedKeywordsArgs = z.object({
  projectId: z.string().trim().min(1).describe("Project id, from list_projects."),
});

/* -------------------------------------------------------------------------- */
/* The catalogue                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Turns a zod object into the JSON Schema a client sees.
 *
 * `additionalProperties: false` is added rather than inferred: it is what the
 * spec recommends for a no-argument tool and what stops a model quietly
 * passing a misspelled field that would otherwise be ignored.
 */
function jsonSchema(schema: z.ZodType): JsonSchema {
  return {
    ...(z.toJSONSchema(schema, { io: "input" }) as JsonSchema),
    additionalProperties: false,
  };
}

/** Declares one tool, binding its zod schema to its handler. */
function tool<S extends z.ZodType>(
  name: string,
  title: string,
  description: string,
  schema: S,
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>,
): McpTool {
  return {
    name,
    title,
    description,
    inputSchema: jsonSchema(schema),
    run: (ctx, args) => run(ctx, schema.parse(args ?? {}) as z.infer<S>),
  };
}

/**
 * Every tool, in a fixed order.
 *
 * The order is part of the contract: the spec asks servers to return tools
 * deterministically so clients can cache the list and model prompt caches keep
 * hitting. An array literal gives that for free; a map iteration would not.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  tool(
    "keyword_overview",
    "Keyword overview",
    "Search volume, CPC, competition, keyword difficulty, search intent and 12 months of volume history for one keyword. One upstream call. Note that intentProbability is always null on this endpoint — it reports intent as a bare label with no confidence figure.",
    keywordOverviewArgs,
    (ctx, args) => keywordOverview(ctx.env, ctx.db, { ...args, workspace: ctx.workspaceId }),
  ),
  tool(
    "keyword_ideas",
    "Keyword ideas",
    "Keywords related to a seed term, with volume, CPC and difficulty. Filters are applied upstream, so a filtered page costs one call rather than narrowing a thousand rows locally.",
    keywordIdeasArgs,
    (ctx, args) => keywordIdeas(ctx.env, ctx.db, { ...args, workspace: ctx.workspaceId }),
  ),
  tool(
    "keyword_serp",
    "Keyword SERP",
    "The live Google results page for a keyword: organic results with position, title, URL and description, plus the SERP feature types present on the page.",
    keywordSerpArgs,
    (ctx, args) => keywordSerp(ctx.env, ctx.db, { ...args, workspace: ctx.workspaceId }),
  ),
  tool(
    "domain_overview",
    "Domain overview",
    "A domain's organic and paid ranking profile in one market: ranking keywords, estimated traffic, traffic value, and the spread of positions across the top 100.",
    domainOverviewArgs,
    (ctx, args) => domainOverview(ctx.env, ctx.db, { ...args, workspace: ctx.workspaceId }),
  ),
  tool(
    "domain_keywords",
    "Domain keywords",
    "The keywords a domain ranks for, with its position, the ranking URL and estimated traffic per keyword. Ordered by position.",
    domainKeywordsArgs,
    (ctx, args) => domainKeywords(ctx.env, ctx.db, { ...args, workspace: ctx.workspaceId }),
  ),
  tool(
    "backlinks_summary",
    "Backlinks summary",
    "A target's link profile: Domain Score (0-100), backlinks, referring domains, the dofollow split, broken links and spam score. Accepts a domain or a single page URL.",
    backlinksSummaryArgs,
    (ctx, args) => backlinksSummary(ctx.env, ctx.db, { ...args, workspace: ctx.workspaceId }),
  ),
  tool(
    "gap_keywords",
    "Keyword gap",
    "Keywords competitors rank for and you do not (or rank worse for). A position of null means that domain does not rank for that keyword at all — it is never zero. Costs one upstream call per competitor, or two per competitor when mode is 'all'.",
    gapKeywordsArgs,
    (ctx, args) =>
      gapKeywords(ctx.env, ctx.db, { ...args, workspace: ctx.workspaceId }),
  ),
  tool(
    "content_discover",
    "Content discovery",
    "Pages winning traffic without much authority on a topic — the openings a small site can realistically take. Unlike the other paid tools, filtering, sorting and paging happen over a cached composed set and are free; only the initial sweep costs money.",
    contentDiscoverArgs,
    (ctx, args) => contentDiscover(ctx.env, ctx.db, { ...args, workspace: ctx.workspaceId }),
  ),
  tool(
    "list_collections",
    "List keyword collections",
    "Every saved keyword collection in this workspace, with its keyword count. Free — reads the database, spends nothing.",
    listCollectionsArgs,
    (ctx) => listCollections(ctx.db, ctx.workspaceId),
  ),
  tool(
    "add_keywords_to_collection",
    "Add keywords to a collection",
    "Saves keywords into an existing collection. Idempotent: a keyword already present is skipped rather than overwritten, so the first save owns its volume snapshot and market. added + skipped always equals submitted. Free.",
    addKeywordsArgs,
    (ctx, args) =>
      addKeywordsToCollection(ctx.db, ctx.workspaceId, args.collectionId, {
        keywords: args.keywords,
        location: args.location,
        language: args.language,
      }),
  ),
  tool(
    "list_projects",
    "List projects",
    "Every project (a site tracked in this workspace), with its domain, market, tracked-keyword count and when its ranks were last checked. Free.",
    listProjectsArgs,
    (ctx) => listProjects(ctx.db, ctx.workspaceId),
  ),
  tool(
    "tracked_keywords",
    "Tracked keyword ranks",
    "The rank tracking table for one project: current position, the previous observation, 1/7/30-day movement, all-time best, whether Google shows an AI Overview, and a 30-day series. A position of null means checked and not in the top 100; latest of null means never checked. Movement is positive when the ranking improved. Free.",
    trackedKeywordsArgs,
    (ctx, args) => trackedKeywordsForProject(ctx.db, ctx.workspaceId, args.projectId),
  ),
];

/** Lookup by name, for `tools/call`. */
export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((entry) => entry.name === name);
}
