/**
 * `backlinks/*` — DataForSEO's link index.
 *
 * Shapes verified against https://docs.dataforseo.com/v3/backlinks/<endpoint>/
 * live/ and https://docs.dataforseo.com/v3/backlinks/filters/ (2026-08-29).
 * The things that are not guessable, and that this file exists to encode:
 *
 *  - **`rank` is 0–1000 and never leaves this module.** `rank_scale` defaults
 *    to `one_thousand`; we pin it explicitly rather than inherit a default that
 *    could move under us, and every rank is converted by ./scores.ts before it
 *    reaches a caller. See RANK_SCALE below.
 *  - **There is no dofollow count anywhere in this API.** Not on summary, not
 *    on referring_domains, not on anchors. What exists is the *nofollow* side
 *    (`referring_pages_nofollow`, `referring_domains_nofollow`) plus a
 *    `referring_links_attributes` map keyed by attribute. Every "dofollow %"
 *    in the product is therefore derived by subtraction, in one place, and is
 *    null when the subtrahend is missing rather than silently reported as 100%.
 *  - **Different result shapes per endpoint.** summary returns a single flat
 *    object with NO `items`; backlinks/referring_domains/anchors return
 *    `{target, total_count, items_count, items}`; history returns
 *    `{target, date_from, date_to, items_count, items}` with **no
 *    `total_count`**; bulk_ranks returns `{items_count, items}` with **no
 *    `target` and no `total_count`**.
 *  - **bulk_ranks does not preserve input order** (their own example returns
 *    URLs before bare domains). Results are matched back by the `target`
 *    string, never by index.
 *  - **Filter/sort field paths are FLAT** here — `rank`, `dofollow`, `anchor` —
 *    unlike Labs' `keyword_data.keyword_info.…` nesting. The *encoding* of
 *    `filters` and `order_by` is identical to Labs (bare triple for one
 *    condition, `and`/`or` strings between several, `"field,desc"` sorts),
 *    which is why ./filters.ts is shared. Labs' `$item->` field-to-field
 *    comparison does NOT exist on this API.
 *  - summary and history take no `limit`, `offset`, `filters` or `order_by` at
 *    all, so those params are absent from their schemas rather than ignored.
 *  - `offset` on the backlinks list caps at 20,000; past that DataForSEO
 *    requires `search_after_token` with every other parameter held identical.
 *    Our page window is far below that, so the token is not exposed.
 */
import { z } from "zod";

import { ApiException } from "../http";
import type { DataForSeoClient } from "./client";
import type { LabsFilter, LabsSort } from "./filters";
// Same wire encoding as Labs, verified against the Backlinks filters page —
// one implementation, two APIs. Only the field paths differ.
import { toLabsFilters as toFilterExpression, toLabsOrderBy as toOrderBy } from "./filters";
import { nullableNumber, nullableString } from "./schema";
import type { WrappedMeta } from "./schema";
import { toScore } from "./scores";

export const BACKLINKS_SUMMARY_LIVE = "backlinks/summary/live";
export const BACKLINKS_BACKLINKS_LIVE = "backlinks/backlinks/live";
export const BACKLINKS_REFERRING_DOMAINS_LIVE = "backlinks/referring_domains/live";
export const BACKLINKS_ANCHORS_LIVE = "backlinks/anchors/live";
export const BACKLINKS_HISTORY_LIVE = "backlinks/history/live";
export const BACKLINKS_BULK_RANKS_LIVE = "backlinks/bulk_ranks/live";

/**
 * Pinned, not inherited. `rank_scale` chooses whether `rank`,
 * `domain_from_rank` and `page_from_rank` come back on a 0–100 or 0–1000
 * scale; `one_thousand` is their documented default and is what ./scores.ts
 * divides by. Sending it explicitly means a change to their default cannot
 * silently turn every Domain Score into a tenth of itself.
 */
const RANK_SCALE = "one_thousand";

/** Documented ceiling on `limit` for the three paged endpoints. */
export const BACKLINKS_MAX_LIMIT = 1000;

/**
 * Documented ceiling on `offset`. Beyond it DataForSEO requires
 * `search_after_token`, which we do not expose — no UI surface pages 20,000
 * links deep, and the token requires replaying every other parameter exactly.
 */
export const BACKLINKS_MAX_OFFSET = 20_000;

/** Documented ceiling on `targets` for bulk_ranks. */
export const BULK_RANKS_MAX_TARGETS = 1000;

/**
 * How the backlinks list groups its rows.
 *
 * `one_per_domain` is what a "referring domains, with an example link" view
 * wants; `as_is` is every link. `group_count` is only meaningful in a grouped
 * mode — in `as_is` it comes back 0.
 */
export const BACKLINKS_MODES = ["as_is", "one_per_domain", "one_per_anchor"] as const;
export type BacklinksMode = (typeof BACKLINKS_MODES)[number];

/**
 * Which links are counted. Their default is `live` (links found on the last
 * check), which is the honest default for "how many backlinks does this site
 * have" — `all` includes links that no longer exist.
 */
export const BACKLINKS_STATUS_TYPES = ["all", "live", "lost"] as const;
export type BacklinksStatusType = (typeof BACKLINKS_STATUS_TYPES)[number];

/**
 * Filterable/sortable paths on the backlinks list. Flat, top-level fields —
 * the whole point of naming them here is that nothing hand-writes one.
 */
export const BACKLINKS_FIELDS = {
  domainFrom: "domain_from",
  urlFrom: "url_from",
  urlTo: "url_to",
  anchor: "anchor",
  dofollow: "dofollow",
  isBroken: "is_broken",
  isNew: "is_new",
  isLost: "is_lost",
  firstSeen: "first_seen",
  lastSeen: "last_seen",
  /** 0–1000. Build the value with fromScore(), never a hand-typed rank. */
  rank: "rank",
  pageFromRank: "page_from_rank",
  domainFromRank: "domain_from_rank",
  pageFromTitle: "page_from_title",
  tldFrom: "tld_from",
} as const;

/** Filterable/sortable paths shared by referring_domains and anchors. */
export const REFERRING_FIELDS = {
  domain: "domain",
  anchor: "anchor",
  rank: "rank",
  backlinks: "backlinks",
  referringPages: "referring_pages",
  referringDomains: "referring_domains",
  brokenBacklinks: "broken_backlinks",
  firstSeen: "first_seen",
  lostDate: "lost_date",
} as const;

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `referring_links_*` are maps of label → count (`{"nofollow": 42}`), and both
 * `referring_links_semantic_locations` and `referring_links_countries` use the
 * empty string as a real key. Parsed loosely because the key sets are open.
 */
const linkAttributeMap = z
  .record(z.string(), z.number())
  .nullish()
  .transform((v) => v ?? null);

/**
 * The dofollow half of a link profile, derived rather than reported.
 *
 * DataForSEO gives us the nofollow counts and the totals; dofollow is the
 * difference. Every field is null when either operand is missing — a profile
 * we cannot compute is not a profile that is 100% dofollow.
 */
export interface DofollowSplit {
  /** Referring pages with at least one dofollow link. */
  dofollowPages: number | null;
  /** Referring pages whose links are all nofollow. Reported directly. */
  nofollowPages: number | null;
  /** 0–1. `dofollowPages / referringPages`. */
  dofollowRatio: number | null;
}

export function toDofollowSplit(
  referringPages: number | null,
  referringPagesNofollow: number | null,
): DofollowSplit {
  if (referringPages === null || referringPagesNofollow === null) {
    return {
      dofollowPages: null,
      nofollowPages: referringPagesNofollow,
      dofollowRatio: null,
    };
  }
  // Clamped at zero: the two counts come from different aggregations and are
  // not guaranteed to be consistent, and a negative count is worse than a
  // slightly wrong one.
  const dofollowPages = Math.max(referringPages - referringPagesNofollow, 0);
  return {
    dofollowPages,
    nofollowPages: referringPagesNofollow,
    dofollowRatio: referringPages > 0 ? dofollowPages / referringPages : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

const summaryParamsSchema = z.object({
  /**
   * A domain or subdomain **without** scheme or `www.`, or a page as an
   * absolute URL **with** scheme. Both are legitimate here, which is why this
   * is not run through the domain-only normaliser.
   */
  target: z.string().trim().min(1),
  includeSubdomains: z.boolean().optional(),
  backlinksStatusType: z.enum(BACKLINKS_STATUS_TYPES).optional(),
  excludeInternalBacklinks: z.boolean().optional(),
  /** Caps the size of the `referring_links_*` maps. Their default is 10. */
  internalListLimit: z.number().int().min(1).max(1000).optional(),
  /** Restricts which links feed the aggregate, e.g. dofollow only. */
  backlinksFilters: z.array(z.custom<LabsFilter>()).optional(),
  fresh: z.boolean().optional(),
});

export type BacklinksSummaryParams = z.input<typeof summaryParamsSchema>;

/** `result[0]` is this object directly — there is no `items` wrapper. */
const summaryResultSchema = z.object({
  target: nullableString,
  first_seen: nullableString,
  lost_date: nullableString,
  rank: nullableNumber,
  backlinks: nullableNumber,
  backlinks_spam_score: nullableNumber,
  crawled_pages: nullableNumber,
  info: z
    .object({
      server: nullableString,
      cms: nullableString,
      ip_address: nullableString,
      country: nullableString,
      is_ip: z.boolean().nullish().transform((v) => v ?? null),
      target_spam_score: nullableNumber,
    })
    .nullish(),
  internal_links_count: nullableNumber,
  external_links_count: nullableNumber,
  broken_backlinks: nullableNumber,
  broken_pages: nullableNumber,
  referring_domains: nullableNumber,
  referring_domains_nofollow: nullableNumber,
  referring_main_domains: nullableNumber,
  referring_main_domains_nofollow: nullableNumber,
  referring_ips: nullableNumber,
  referring_subnets: nullableNumber,
  referring_pages: nullableNumber,
  referring_pages_nofollow: nullableNumber,
  referring_links_types: linkAttributeMap,
  referring_links_attributes: linkAttributeMap,
  referring_links_platform_types: linkAttributeMap,
  referring_links_countries: linkAttributeMap,
});

export interface BacklinksSummary extends WrappedMeta {
  target: string | null;
  /** 0–100. The raw 0–1000 rank is deliberately not on this type. */
  domainScore: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  /** Domains counted once regardless of subdomain. */
  referringMainDomains: number | null;
  referringPages: number | null;
  dofollow: DofollowSplit;
  brokenBacklinks: number | null;
  brokenPages: number | null;
  crawledPages: number | null;
  internalLinksCount: number | null;
  externalLinksCount: number | null;
  referringIps: number | null;
  referringSubnets: number | null;
  /** 0–100; DataForSEO's own spam estimate, not one of ours. */
  spamScore: number | null;
  /** `yyyy-mm-dd hh-mm-ss +00:00`. */
  firstSeen: string | null;
  lostDate: string | null;
  server: string | null;
  countryIsoCode: string | null;
  /** Counts by link attribute, e.g. `{nofollow: 42}`. Open key set. */
  linkAttributes: Record<string, number> | null;
  linkTypes: Record<string, number> | null;
  raw: unknown;
}

/* -------------------------------------------------------------------------- */
/* Backlinks list                                                              */
/* -------------------------------------------------------------------------- */

const backlinksListParamsSchema = z.object({
  target: z.string().trim().min(1),
  mode: z.enum(BACKLINKS_MODES).optional(),
  limit: z.number().int().min(1).max(BACKLINKS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).max(BACKLINKS_MAX_OFFSET).optional(),
  includeSubdomains: z.boolean().optional(),
  backlinksStatusType: z.enum(BACKLINKS_STATUS_TYPES).optional(),
  excludeInternalBacklinks: z.boolean().optional(),
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type BacklinksListParams = z.input<typeof backlinksListParamsSchema>;

const backlinkItemSchema = z.object({
  domain_from: nullableString,
  url_from: nullableString,
  domain_to: nullableString,
  url_to: nullableString,
  tld_from: nullableString,
  anchor: nullableString,
  dofollow: z.boolean().nullish().transform((v) => v ?? null),
  is_broken: z.boolean().nullish().transform((v) => v ?? null),
  is_new: z.boolean().nullish().transform((v) => v ?? null),
  is_lost: z.boolean().nullish().transform((v) => v ?? null),
  first_seen: nullableString,
  last_seen: nullableString,
  /** 0–1000 for the linking page. */
  page_from_rank: nullableNumber,
  /** 0–1000 for the linking domain. */
  domain_from_rank: nullableNumber,
  page_from_title: nullableString,
  page_from_language: nullableString,
  /** Duplicate links from the same page, collapsed into one row. */
  links_count: nullableNumber,
  /** Total links from this domain. Only meaningful in a grouped `mode`. */
  group_count: nullableNumber,
  /** "anchor" | "image" | "meta" | "canonical" | "alternate" | "redirect". */
  item_type: nullableString,
  semantic_location: nullableString,
  backlink_spam_score: nullableNumber,
});

export interface BacklinkRow {
  /** The linking domain. */
  domainFrom: string | null;
  /** The linking page. */
  urlFrom: string | null;
  domainTo: string | null;
  /** The page being linked to. */
  urlTo: string | null;
  tldFrom: string | null;
  anchor: string | null;
  dofollow: boolean | null;
  isBroken: boolean | null;
  isNew: boolean | null;
  isLost: boolean | null;
  firstSeen: string | null;
  lastSeen: string | null;
  /** 0–100 for the linking page. */
  pageScore: number | null;
  /** 0–100 for the linking domain. */
  domainScore: number | null;
  pageFromTitle: string | null;
  pageFromLanguage: string | null;
  linksCount: number | null;
  groupCount: number | null;
  itemType: string | null;
  semanticLocation: string | null;
  spamScore: number | null;
  raw: unknown;
}

export interface BacklinksListResult extends WrappedMeta {
  target: string | null;
  mode: string | null;
  items: BacklinkRow[];
  totalCount: number | null;
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Referring domains + anchors                                                 */
/* -------------------------------------------------------------------------- */

const referringParamsSchema = z.object({
  target: z.string().trim().min(1),
  limit: z.number().int().min(1).max(BACKLINKS_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).optional(),
  includeSubdomains: z.boolean().optional(),
  backlinksStatusType: z.enum(BACKLINKS_STATUS_TYPES).optional(),
  excludeInternalBacklinks: z.boolean().optional(),
  filters: z.array(z.custom<LabsFilter>()).optional(),
  sorts: z.array(z.custom<LabsSort>()).optional(),
  fresh: z.boolean().optional(),
});

export type ReferringDomainsParams = z.input<typeof referringParamsSchema>;
export type AnchorsParams = z.input<typeof referringParamsSchema>;

/**
 * referring_domains and anchors return the SAME row, except that one leads with
 * `domain` and the other with `anchor`. One schema serves both.
 */
const referringItemSchema = z.object({
  domain: nullableString,
  anchor: nullableString,
  rank: nullableNumber,
  backlinks: nullableNumber,
  first_seen: nullableString,
  lost_date: nullableString,
  backlinks_spam_score: nullableNumber,
  broken_backlinks: nullableNumber,
  broken_pages: nullableNumber,
  referring_domains: nullableNumber,
  referring_domains_nofollow: nullableNumber,
  referring_main_domains: nullableNumber,
  referring_pages: nullableNumber,
  referring_pages_nofollow: nullableNumber,
  referring_links_attributes: linkAttributeMap,
});

export interface ReferringDomainRow {
  domain: string | null;
  /** 0–100. */
  domainScore: number | null;
  backlinks: number | null;
  referringPages: number | null;
  dofollow: DofollowSplit;
  brokenBacklinks: number | null;
  firstSeen: string | null;
  lostDate: string | null;
  spamScore: number | null;
  raw: unknown;
}

export interface AnchorRow {
  anchor: string | null;
  /** 0–100 — the authority this anchor's links carry. */
  score: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringPages: number | null;
  dofollow: DofollowSplit;
  brokenBacklinks: number | null;
  firstSeen: string | null;
  lostDate: string | null;
  raw: unknown;
}

export interface ReferringDomainsResult extends WrappedMeta {
  target: string | null;
  items: ReferringDomainRow[];
  /**
   * Counts MAIN domains, while `items` are domains including subdomains —
   * DataForSEO's own note. The two legitimately disagree.
   */
  totalCount: number | null;
  itemsCount: number | null;
}

export interface AnchorsResult extends WrappedMeta {
  target: string | null;
  items: AnchorRow[];
  totalCount: number | null;
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

/** Their index starts here; earlier dates are rejected. */
export const BACKLINKS_HISTORY_MIN_DATE = "2019-01-01";

/**
 * The four delta fields (`new_*` / `lost_*`) are documented as **0, not null,
 * before May 2021** — "no change" and "no data" are indistinguishable in that
 * range. Anything charting them should start here.
 */
export const BACKLINKS_HISTORY_DELTAS_FROM = "2021-05-01";

const historyParamsSchema = z.object({
  /** Docs say a DOMAIN here — unlike the other endpoints, not a URL. */
  target: z.string().trim().min(1),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  fresh: z.boolean().optional(),
});

export type BacklinksHistoryParams = z.input<typeof historyParamsSchema>;

const historyResultSchema = z.object({
  target: nullableString,
  date_from: nullableString,
  date_to: nullableString,
  items_count: nullableNumber,
  items: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

const historyItemSchema = z.object({
  /** `yyyy-mm-dd hh-mm-ss +00:00`, one point per month. */
  date: nullableString,
  rank: nullableNumber,
  backlinks: nullableNumber,
  new_backlinks: nullableNumber,
  lost_backlinks: nullableNumber,
  referring_domains: nullableNumber,
  new_referring_domains: nullableNumber,
  lost_referring_domains: nullableNumber,
  referring_main_domains: nullableNumber,
  referring_pages: nullableNumber,
  referring_pages_nofollow: nullableNumber,
  broken_backlinks: nullableNumber,
  crawled_pages: nullableNumber,
});

export interface BacklinksHistoryPoint {
  /** The API's raw timestamp. */
  date: string | null;
  /** `YYYY-MM`, derived — the chart's x axis. */
  period: string | null;
  /** 0–100. */
  domainScore: number | null;
  backlinks: number | null;
  newBacklinks: number | null;
  lostBacklinks: number | null;
  referringDomains: number | null;
  newReferringDomains: number | null;
  lostReferringDomains: number | null;
  referringMainDomains: number | null;
  referringPages: number | null;
  brokenBacklinks: number | null;
  crawledPages: number | null;
}

export interface BacklinksHistoryResult extends WrappedMeta {
  target: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  /** Monthly, oldest first. Months can be missing — do not index by position. */
  items: BacklinksHistoryPoint[];
  itemsCount: number | null;
}

/* -------------------------------------------------------------------------- */
/* Bulk ranks                                                                  */
/* -------------------------------------------------------------------------- */

const bulkRanksParamsSchema = z.object({
  targets: z.array(z.string().trim().min(1)).min(1).max(BULK_RANKS_MAX_TARGETS),
  fresh: z.boolean().optional(),
});

export type BulkRanksParams = z.input<typeof bulkRanksParamsSchema>;

/** Two fields, and no `type` — the one list endpoint without one. */
const bulkRankItemSchema = z.object({
  target: nullableString,
  rank: nullableNumber,
});

export interface TargetScore {
  target: string | null;
  /** 0–100. */
  domainScore: number | null;
}

export interface BulkRanksResult extends WrappedMeta {
  items: TargetScore[];
  itemsCount: number | null;
}

export interface BacklinksApi {
  summaryLive(params: BacklinksSummaryParams): Promise<BacklinksSummary>;
  backlinksLive(params: BacklinksListParams): Promise<BacklinksListResult>;
  referringDomainsLive(
    params: ReferringDomainsParams,
  ): Promise<ReferringDomainsResult>;
  anchorsLive(params: AnchorsParams): Promise<AnchorsResult>;
  historyLive(params: BacklinksHistoryParams): Promise<BacklinksHistoryResult>;
  bulkRanksLive(params: BulkRanksParams): Promise<BulkRanksResult>;
}

/** `{target, total_count, items_count, items}` — the three paged endpoints. */
const listResultSchema = z.object({
  target: nullableString,
  mode: nullableString,
  total_count: nullableNumber,
  items_count: nullableNumber,
  items: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

const bulkResultSchema = z.object({
  items_count: nullableNumber,
  items: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

export function createBacklinksApi(client: DataForSeoClient): BacklinksApi {
  return {
    async summaryLive(params) {
      const {
        target,
        includeSubdomains,
        backlinksStatusType,
        excludeInternalBacklinks,
        internalListLimit,
        backlinksFilters,
        fresh,
      } = parseParams(summaryParamsSchema, params, "Invalid backlinks summary request.");

      const response = await client.request<unknown>({
        endpoint: BACKLINKS_SUMMARY_LIVE,
        payload: [
          {
            target: normalizeBacklinksTarget(target),
            rank_scale: RANK_SCALE,
            include_subdomains: includeSubdomains,
            backlinks_status_type: backlinksStatusType,
            exclude_internal_backlinks: excludeInternalBacklinks,
            internal_list_limit: internalListLimit,
            // Filters the links that feed the aggregate — not the response.
            backlinks_filters: toFilterExpression(backlinksFilters ?? []),
          },
        ],
        // ARCHITECTURE.md puts backlink summaries in the 7-day bucket.
        ttl: "short",
        fresh,
      });

      const raw = response.results[0] ?? null;
      const parsed = summaryResultSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ApiException(
          "upstream_error",
          `DataForSEO ${BACKLINKS_SUMMARY_LIVE} returned an unrecognised result shape.`,
        );
      }
      const item = parsed.data;

      return {
        target: item.target,
        // The one conversion that matters: 0–1000 in, 0–100 out.
        domainScore: toScore(item.rank),
        backlinks: item.backlinks,
        referringDomains: item.referring_domains,
        referringMainDomains: item.referring_main_domains,
        referringPages: item.referring_pages,
        dofollow: toDofollowSplit(
          item.referring_pages,
          item.referring_pages_nofollow,
        ),
        brokenBacklinks: item.broken_backlinks,
        brokenPages: item.broken_pages,
        crawledPages: item.crawled_pages,
        internalLinksCount: item.internal_links_count,
        externalLinksCount: item.external_links_count,
        referringIps: item.referring_ips,
        referringSubnets: item.referring_subnets,
        spamScore: item.backlinks_spam_score,
        firstSeen: item.first_seen,
        lostDate: item.lost_date,
        server: item.info?.server ?? null,
        countryIsoCode: item.info?.country ?? null,
        linkAttributes: item.referring_links_attributes,
        linkTypes: item.referring_links_types,
        raw,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
      };
    },

    async backlinksLive(params) {
      const {
        target,
        mode,
        limit,
        offset,
        includeSubdomains,
        backlinksStatusType,
        excludeInternalBacklinks,
        filters,
        sorts,
        fresh,
      } = parseParams(
        backlinksListParamsSchema,
        params,
        `Invalid backlinks request (limit 1–${BACKLINKS_MAX_LIMIT}, offset up to ${BACKLINKS_MAX_OFFSET}).`,
      );

      const response = await client.request<unknown>({
        endpoint: BACKLINKS_BACKLINKS_LIVE,
        payload: [
          {
            target: normalizeBacklinksTarget(target),
            mode,
            rank_scale: RANK_SCALE,
            limit,
            offset,
            include_subdomains: includeSubdomains,
            backlinks_status_type: backlinksStatusType,
            exclude_internal_backlinks: excludeInternalBacklinks,
            filters: toFilterExpression(filters ?? []),
            order_by: toOrderBy(sorts ?? []),
          },
        ],
        ttl: "short",
        fresh,
      });

      const wrapper = parseListResult(response.results[0], BACKLINKS_BACKLINKS_LIVE);
      return {
        target: wrapper.target,
        mode: wrapper.mode,
        items: wrapper.items.map(toBacklinkRow),
        totalCount: wrapper.total_count,
        itemsCount: wrapper.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
      };
    },

    async referringDomainsLive(params) {
      const wrapper = await requestReferring(
        client,
        BACKLINKS_REFERRING_DOMAINS_LIVE,
        params,
      );
      return {
        target: wrapper.result.target,
        items: wrapper.result.items.map(toReferringDomainRow),
        totalCount: wrapper.result.total_count,
        itemsCount: wrapper.result.items_count,
        costUsd: wrapper.costUsd,
        cached: wrapper.cached,
        stale: wrapper.stale,
      };
    },

    async anchorsLive(params) {
      const wrapper = await requestReferring(client, BACKLINKS_ANCHORS_LIVE, params);
      return {
        target: wrapper.result.target,
        items: wrapper.result.items.map(toAnchorRow),
        totalCount: wrapper.result.total_count,
        itemsCount: wrapper.result.items_count,
        costUsd: wrapper.costUsd,
        cached: wrapper.cached,
        stale: wrapper.stale,
      };
    },

    async historyLive(params) {
      const { target, dateFrom, dateTo, fresh } = parseParams(
        historyParamsSchema,
        params,
        "Invalid backlinks history request (dates must be yyyy-mm-dd).",
      );

      const response = await client.request<unknown>({
        endpoint: BACKLINKS_HISTORY_LIVE,
        payload: [
          {
            target: normalizeBacklinksTarget(target),
            rank_scale: RANK_SCALE,
            date_from: dateFrom,
            date_to: dateTo,
          },
        ],
        // A monthly series: ARCHITECTURE.md's 30-day historical bucket.
        ttl: "long",
        fresh,
      });

      const raw = response.results[0] ?? null;
      const parsed = historyResultSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ApiException(
          "upstream_error",
          `DataForSEO ${BACKLINKS_HISTORY_LIVE} returned an unrecognised result shape.`,
        );
      }

      return {
        target: parsed.data.target,
        dateFrom: parsed.data.date_from,
        dateTo: parsed.data.date_to,
        items: parsed.data.items.map(toHistoryPoint),
        itemsCount: parsed.data.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
      };
    },

    async bulkRanksLive(params) {
      const { targets, fresh } = parseParams(
        bulkRanksParamsSchema,
        params,
        `Invalid bulk ranks request (max ${BULK_RANKS_MAX_TARGETS} targets).`,
      );

      const response = await client.request<unknown>({
        endpoint: BACKLINKS_BULK_RANKS_LIVE,
        payload: [
          {
            targets: normalizeTargetList(targets),
            rank_scale: RANK_SCALE,
          },
        ],
        ttl: "short",
        fresh,
      });

      const raw = response.results[0] ?? null;
      const parsed = bulkResultSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ApiException(
          "upstream_error",
          `DataForSEO ${BACKLINKS_BULK_RANKS_LIVE} returned an unrecognised result shape.`,
        );
      }

      return {
        items: parsed.data.items.map((row) => {
          const item = bulkRankItemSchema.parse(row);
          return { target: item.target, domainScore: toScore(item.rank) };
        }),
        itemsCount: parsed.data.items_count,
        costUsd: response.costUsd,
        cached: response.cached,
        stale: response.stale,
      };
    },
  };
}

/** referring_domains and anchors differ only in how their rows are read. */
async function requestReferring(
  client: DataForSeoClient,
  endpoint: string,
  params: unknown,
): Promise<{
  result: z.infer<typeof listResultSchema>;
  costUsd: number;
  cached: boolean;
  stale: boolean;
}> {
  const {
    target,
    limit,
    offset,
    includeSubdomains,
    backlinksStatusType,
    excludeInternalBacklinks,
    filters,
    sorts,
    fresh,
  } = parseParams(
    referringParamsSchema,
    params,
    `Invalid request (limit must be 1–${BACKLINKS_MAX_LIMIT}).`,
  );

  const response = await client.request<unknown>({
    endpoint,
    payload: [
      {
        target: normalizeBacklinksTarget(target),
        rank_scale: RANK_SCALE,
        limit,
        offset,
        include_subdomains: includeSubdomains,
        backlinks_status_type: backlinksStatusType,
        exclude_internal_backlinks: excludeInternalBacklinks,
        filters: toFilterExpression(filters ?? []),
        order_by: toOrderBy(sorts ?? []),
      },
    ],
    ttl: "short",
    fresh,
  });

  return {
    result: parseListResult(response.results[0], endpoint),
    costUsd: response.costUsd,
    cached: response.cached,
    stale: response.stale,
  };
}

function parseParams<S extends z.ZodType>(
  schema: S,
  params: unknown,
  message: string,
): z.infer<S> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new ApiException("validation_failed", message, z.flattenError(parsed.error));
  }
  return parsed.data;
}

function parseListResult(
  result: unknown,
  endpoint: string,
): z.infer<typeof listResultSchema> {
  const parsed = listResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new ApiException(
      "upstream_error",
      `DataForSEO ${endpoint} returned an unrecognised result shape.`,
    );
  }
  return parsed.data;
}

/**
 * Trims and lowercases, and strips `www.` and a trailing slash from a bare
 * host — but **keeps a scheme and path when one is given**, because these
 * endpoints legitimately accept a page URL as well as a domain. That is the
 * difference from labs.ts's `normalizeTarget`, which flattens everything to a
 * hostname because Labs' domain endpoints only mean domains.
 */
export function normalizeBacklinksTarget(target: string): string {
  const trimmed = target.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .replace(/\.$/, "");
}

/**
 * De-duplicated and sorted, so the same set of targets asked for in a different
 * order hits one cache entry. Case is preserved for URLs (paths are
 * case-sensitive) but hosts are lowercased by `normalizeBacklinksTarget`.
 */
export function normalizeTargetList(targets: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const target of targets) {
    const normalized = normalizeBacklinksTarget(target);
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
}

function toBacklinkRow(raw: unknown): BacklinkRow {
  const item = backlinkItemSchema.parse(raw);
  return {
    domainFrom: item.domain_from,
    urlFrom: item.url_from,
    domainTo: item.domain_to,
    urlTo: item.url_to,
    tldFrom: item.tld_from,
    anchor: item.anchor,
    dofollow: item.dofollow,
    isBroken: item.is_broken,
    isNew: item.is_new,
    isLost: item.is_lost,
    firstSeen: item.first_seen,
    lastSeen: item.last_seen,
    pageScore: toScore(item.page_from_rank),
    domainScore: toScore(item.domain_from_rank),
    pageFromTitle: item.page_from_title,
    pageFromLanguage: item.page_from_language,
    linksCount: item.links_count,
    groupCount: item.group_count,
    itemType: item.item_type,
    semanticLocation: item.semantic_location,
    spamScore: item.backlink_spam_score,
    raw,
  };
}

function toReferringDomainRow(raw: unknown): ReferringDomainRow {
  const item = referringItemSchema.parse(raw);
  return {
    domain: item.domain,
    domainScore: toScore(item.rank),
    backlinks: item.backlinks,
    referringPages: item.referring_pages,
    dofollow: toDofollowSplit(item.referring_pages, item.referring_pages_nofollow),
    brokenBacklinks: item.broken_backlinks,
    firstSeen: item.first_seen,
    lostDate: item.lost_date,
    spamScore: item.backlinks_spam_score,
    raw,
  };
}

function toAnchorRow(raw: unknown): AnchorRow {
  const item = referringItemSchema.parse(raw);
  return {
    anchor: item.anchor,
    score: toScore(item.rank),
    backlinks: item.backlinks,
    referringDomains: item.referring_domains,
    referringPages: item.referring_pages,
    dofollow: toDofollowSplit(item.referring_pages, item.referring_pages_nofollow),
    brokenBacklinks: item.broken_backlinks,
    firstSeen: item.first_seen,
    lostDate: item.lost_date,
    raw,
  };
}

function toHistoryPoint(raw: unknown): BacklinksHistoryPoint {
  const item = historyItemSchema.parse(raw);
  return {
    date: item.date,
    period: toHistoryPeriod(item.date),
    domainScore: toScore(item.rank),
    backlinks: item.backlinks,
    newBacklinks: item.new_backlinks,
    lostBacklinks: item.lost_backlinks,
    referringDomains: item.referring_domains,
    newReferringDomains: item.new_referring_domains,
    lostReferringDomains: item.lost_referring_domains,
    referringMainDomains: item.referring_main_domains,
    referringPages: item.referring_pages,
    brokenBacklinks: item.broken_backlinks,
    crawledPages: item.crawled_pages,
  };
}

/**
 * `"2020-08-31 00:00:00 +00:00"` → `"2020-08"`.
 *
 * Sliced rather than parsed as a Date: the timestamp carries an explicit
 * +00:00 offset, and constructing a Date would reinterpret it in the runtime's
 * zone, which can move a month-end point into the previous month.
 */
export function toHistoryPeriod(date: string | null): string | null {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})/.exec(date.trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}
