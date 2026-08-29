/**
 * `serp/google/organic/live/advanced` — a real Google SERP, fetched now.
 *
 * Shapes verified against https://docs.dataforseo.com/v3/serp/google/organic/
 * live/advanced/ (2026-08-29). The things worth knowing before touching this:
 *
 *  - This is the most expensive endpoint in Phase 1 and the only one whose TTL
 *    is measured in hours. Billing is per 10 results, so `depth: 20` is two
 *    SERPs' worth of charge, not one.
 *  - `result[0]` is a wrapper, like the Labs endpoints, but with a different
 *    field set — `item_types` on it is the list of SERP features present,
 *    which is exactly the "SERP feature list" the UI wants and is far more
 *    reliable than inferring features from the items we kept.
 *  - `position` is the column ("left"/"right"), NOT the rank. Rank is
 *    `rank_group` / `rank_absolute`. Same trap as ranked_keywords.
 *  - The `is_featured_snippet` / `is_video` / `is_image` booleans are
 *    documented as no longer populated; the live signal is the `checks` array.
 *    Nothing here reads the deprecated booleans.
 */
import { z } from "zod";

import { ApiException } from "../http";
import type { DataForSeoClient } from "./client";
import type { WrappedMeta } from "./schema";
import { nullableNumber, nullableString } from "./schema";

export const GOOGLE_ORGANIC_LIVE_ADVANCED = "serp/google/organic/live/advanced";

/** Documented ceiling on `depth`. Default is 10; billing is per 10 results. */
export const SERP_MAX_DEPTH = 200;

/** What the Phase 1 SERP panel shows. Two SERPs' worth of charge. */
export const SERP_DEFAULT_DEPTH = 20;

export const SERP_DEVICES = ["desktop", "mobile"] as const;
export type SerpDevice = (typeof SERP_DEVICES)[number];

const paramsSchema = z.object({
  keyword: z.string().trim().min(1).max(700),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  depth: z.number().int().min(1).max(SERP_MAX_DEPTH).optional(),
  device: z.enum(SERP_DEVICES).optional(),
  /** Bypass a cache hit and pay for a fresh SERP. The "Refresh" button. */
  fresh: z.boolean().optional(),
});

export type OrganicSerpParams = z.input<typeof paramsSchema>;

const serpItemSchema = z.object({
  type: nullableString,
  /** The rank among items of the same type. */
  rank_group: nullableNumber,
  /** The rank among every element on the page. */
  rank_absolute: nullableNumber,
  domain: nullableString,
  title: nullableString,
  url: nullableString,
  description: nullableString,
  breadcrumb: nullableString,
  website_name: nullableString,
  /** SERP page number this item appeared on. */
  page: nullableNumber,
});

const serpResultSchema = z.object({
  keyword: nullableString,
  check_url: nullableString,
  datetime: nullableString,
  /** Every SERP feature type present on the page. The feature-chip source. */
  item_types: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  se_results_count: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v) => (v === null || v === undefined ? null : Number(v))),
  items_count: nullableNumber,
  items: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

export interface OrganicSerpItem {
  /** `rank_group` — the organic ranking. */
  position: number | null;
  /** `rank_absolute` — counting every SERP element, features included. */
  positionAbsolute: number | null;
  title: string | null;
  url: string | null;
  domain: string | null;
  description: string | null;
  breadcrumb: string | null;
  raw: unknown;
}

export interface OrganicSerpResult extends WrappedMeta {
  keyword: string | null;
  /** The Google URL this was read from — the "see it yourself" link. */
  checkUrl: string | null;
  /** When DataForSEO fetched the SERP. */
  fetchedAt: string | null;
  /** Every feature type on the page, e.g. ["organic","people_also_ask"]. */
  serpFeatures: string[];
  /**
   * Google's own "about N results". A string on the wire often enough to be
   * worth coercing rather than trusting.
   */
  totalResults: number | null;
  /** Organic rows only, in rank order. */
  items: OrganicSerpItem[];
}

export interface SerpApi {
  googleOrganicLiveAdvanced(
    params: OrganicSerpParams,
  ): Promise<OrganicSerpResult>;
}

export function createSerpApi(client: DataForSeoClient): SerpApi {
  return {
    async googleOrganicLiveAdvanced(params) {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        throw new ApiException(
          "validation_failed",
          `Invalid SERP request (depth must be 1–${SERP_MAX_DEPTH}).`,
          z.flattenError(parsed.error),
        );
      }
      const { keyword, locationCode, languageCode, depth, device, fresh } =
        parsed.data;

      const response = await client.request<unknown>({
        endpoint: GOOGLE_ORGANIC_LIVE_ADVANCED,
        payload: [
          {
            keyword: keyword.toLowerCase(),
            location_code: locationCode,
            language_code: languageCode,
            depth: depth ?? SERP_DEFAULT_DEPTH,
            device: device ?? "desktop",
          },
        ],
        // A live SERP is a snapshot of a moving thing; ARCHITECTURE.md caps it
        // at 24h, and `fresh` is how the Refresh button pays to skip that.
        ttl: "live",
        fresh,
      });

      const result = serpResultSchema.safeParse(response.results[0]);
      if (!result.success) {
        throw new ApiException(
          "upstream_error",
          `DataForSEO ${GOOGLE_ORGANIC_LIVE_ADVANCED} returned an unrecognised result shape.`,
        );
      }
      const data = result.data;

      return {
        keyword: data.keyword,
        checkUrl: data.check_url,
        fetchedAt: data.datetime,
        serpFeatures: data.item_types,
        totalResults: data.se_results_count,
        items: pickOrganic(data.items),
        costUsd: response.costUsd,
        cached: response.cached,
      };
    },
  };
}

/**
 * Organic rows, in rank order.
 *
 * The response interleaves features (people_also_ask, video carousels, ads)
 * with the organic results, so filtering by `type` is what makes "position 3"
 * mean the third organic result rather than the third thing on the page. The
 * full feature list is still reported separately as `serpFeatures`, so nothing
 * is lost by dropping the feature rows here.
 */
function pickOrganic(items: readonly unknown[]): OrganicSerpItem[] {
  const organic: OrganicSerpItem[] = [];
  for (const raw of items) {
    const parsed = serpItemSchema.safeParse(raw);
    // A malformed row is one missing result, not a failed (paid) request.
    if (!parsed.success) continue;
    const item = parsed.data;
    if (item.type !== "organic") continue;
    organic.push({
      position: item.rank_group,
      positionAbsolute: item.rank_absolute,
      title: item.title,
      url: item.url,
      domain: item.domain,
      description: item.description,
      breadcrumb: item.breadcrumb,
      raw,
    });
  }
  return organic.sort(byPosition);
}

function byPosition(a: OrganicSerpItem, b: OrganicSerpItem): number {
  // Nulls last: a row with no rank is not a rank-zero row.
  if (a.position === null) return b.position === null ? 0 : 1;
  if (b.position === null) return -1;
  return a.position - b.position;
}
