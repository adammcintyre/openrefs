/**
 * Shared zod schemas. Worker routes validate with these; the SPA reuses the
 * inferred types so a query param can't drift between the two sides.
 *
 * This file is the worked example for the pattern — one schema per request
 * shape, exported alongside its inferred type.
 */
import { z } from "zod";

/** Cursor-free pagination used by every list endpoint. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type Pagination = z.infer<typeof paginationSchema>;

/**
 * A bare hostname: no scheme, no path, no trailing dot. DataForSEO wants
 * targets in this form, and normalising at the edge keeps cache keys stable.
 */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "Expected a bare hostname such as example.com",
  );

/** DataForSEO location/language pair. Defaults are the UK market. */
export const marketSchema = z.object({
  locationCode: z.coerce.number().int().positive().default(2826),
  languageCode: z.string().trim().min(2).max(8).default("en"),
});
export type Market = z.infer<typeof marketSchema>;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
});
