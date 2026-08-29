/**
 * Shared query validation for the research routes (keywords, domains).
 *
 * Every one of them takes the same four things — a workspace, a market
 * (location + language), and a page window — so they are defined once here.
 * Query strings arrive as strings, so the numeric params coerce; `location`
 * being a numeric code and `language` an ISO string is a contract the UI
 * depends on and the reason these are not interchangeable.
 */
import { z } from "zod";

import type { Db } from "../../db";
import { getDb } from "../../db";
import type { WorkspaceRole } from "../../shared/workspaces";
import { requireWorkspaceRole } from "./authorization";
import type { SessionContext } from "../types";

/**
 * Our page-size ceiling, deliberately below DataForSEO's 1000.
 *
 * A table that renders 200 rows is already past what anyone scrolls, and each
 * row is money — capping here means a hand-edited URL cannot turn one click
 * into five times the intended spend. "Load more" pages past it with `offset`.
 */
export const MAX_LIMIT = 200;

export const DEFAULT_LIMIT = 50;

/** `?workspace=<id>` — required on every workspace-scoped route. */
export const workspaceParam = z
  .string()
  .trim()
  .min(1, "A workspace id is required.");

/**
 * `?location=2826`. A numeric DataForSEO location code, never a name: names
 * are ambiguous across their APIs and the UI resolves them from /meta first.
 */
export const locationParam = z.coerce
  .number({ message: "location must be a numeric DataForSEO location code." })
  .int()
  .positive();

/** `?language=en`. ISO 639-1, occasionally with a region suffix. */
export const languageParam = z
  .string()
  .trim()
  .min(2)
  .max(8)
  .regex(/^[A-Za-z-]+$/, "language must be an ISO language code, e.g. 'en'.");

/**
 * Query-string booleans. `?fresh` with no value, `?fresh=true` and `?fresh=1`
 * all mean true; absent means undefined so the wrapper's own default applies
 * rather than a `false` we invented.
 */
export const booleanParam = z
  .union([z.literal(""), z.string()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === "") return true;
    return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  });

export const limitParam = z.coerce.number().int().min(1).max(MAX_LIMIT);
export const offsetParam = z.coerce.number().int().min(0);

/** The market half of every research query. */
export const marketQuerySchema = z.object({
  workspace: workspaceParam,
  location: locationParam,
  language: languageParam,
});

/** The page window, with defaults, for the list routes. */
export const pagingQuerySchema = z.object({
  limit: limitParam.optional().default(DEFAULT_LIMIT),
  offset: offsetParam.optional().default(0),
});

/** Optional min/max numeric bounds, as a filter row supplies them. */
export const rangeQuerySchema = z.object({
  minVolume: z.coerce.number().min(0).optional(),
  maxVolume: z.coerce.number().min(0).optional(),
  minDifficulty: z.coerce.number().min(0).max(100).optional(),
  maxDifficulty: z.coerce.number().min(0).max(100).optional(),
});

/**
 * Membership proof plus a request-scoped db handle, in one call — the same
 * shape routes/usage.ts uses, so every workspace-scoped route in the Worker
 * proves membership the same way. Non-membership and a nonexistent workspace
 * are deliberately indistinguishable (403).
 */
export async function authorizeWorkspace(
  env: Env,
  session: SessionContext | null,
  workspaceId: string,
  role: WorkspaceRole = "member",
): Promise<Db> {
  const db = getDb(env.DB);
  await requireWorkspaceRole(db, session, workspaceId, role);
  return db;
}

/**
 * A bare hostname: no scheme, no `www.`, no path, no trailing dot.
 *
 * DataForSEO treats `example.com/page` as a page-level query returning far
 * fewer keywords, so normalising here means a user pasting a full URL into the
 * domain box gets the domain report they expected rather than a near-empty one.
 */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

/** `?domain=` — validated as something that could plausibly be a hostname. */
export const domainParam = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeDomain)
  .refine((value) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value), {
    message: "domain must be a hostname, e.g. 'example.com'.",
  });
