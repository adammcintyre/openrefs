/**
 *   GET  /api/v1/content/discover   compose SERPs → deduped pages → enriched
 *   POST /api/v1/content/wordcount  on_page content_parsing, ≤10 URLs
 *
 * Workspace-scoped with the same guard as every other research route.
 * Responses are the shared types in src/shared/content.ts.
 *
 * ## What this module is
 *
 * No new DataForSEO family — a **composition** of four existing wrappers into
 * one question: which pages win traffic without much authority?
 *
 *   1. the topic's SERP                       (serp organic live advanced)
 *   2. optionally, SERPs for its top N ideas   (labs keyword_ideas, then 1–10 more SERPs)
 *   3. Domain and Page Scores in bulk          (backlinks bulk_ranks)
 *   4. per-page traffic estimates in bulk      (labs bulk_traffic_estimation)
 *
 * ## The composed cache is the point
 *
 * Steps 1–4 are expensive and their result is a *set*, not a page of one. So
 * the deduplicated, enriched, **pre-filter** set is cached under one key per
 * (workspace, topic, market, expand) — and every filter, sort and offset is
 * applied here, over that cached set, at no cost.
 *
 * That ordering is the whole design. Filtering upstream instead would make
 * "raise the Domain Score cap from 30 to 40" a fresh fan-out of a dozen paid
 * SERPs, which is exactly the knob users are meant to turn freely. It also
 * makes `filteredOut` honest: it counts against the full set, so the empty
 * state can truthfully say how many pages the cap removed.
 *
 * ## The windowing caveat, stated plainly
 *
 * `limit`/`offset` page over the composed set, which is itself bounded by the
 * SERP depth (top 20 per keyword). A page ranking 21st for every keyword is
 * not in the set at all — no amount of paging reveals it. That is a property
 * of what was bought, not of the paging.
 */
import { Hono } from "hono";
import { z } from "zod";

import type {
  ContentDiscoverCosts,
  ContentDiscoverResponse,
  ContentPageKeyword,
  ContentPageRow,
  ContentSort,
  ContentWordCountResponse,
  ContentWordCountRow,
} from "../../shared/content";
import {
  CONTENT_DEFAULT_ROWS,
  CONTENT_EXPAND_OPTIONS,
  CONTENT_MAX_ROWS,
  CONTENT_SORTS,
  CONTENT_WORDCOUNT_MAX_URLS,
  normalizeContentUrl,
} from "../../shared/content";
import { createDataForSeoApi } from "../dataforseo";
import type { DataForSeoApi } from "../dataforseo";
import { BULK_RANKS_MAX_TARGETS } from "../dataforseo/backlinks";
import { CACHE_TTL_SECONDS } from "../dataforseo/client";
import { canonicalJson } from "../dataforseo/client";
import { BULK_TRAFFIC_ESTIMATION_MAX_TARGETS } from "../dataforseo/labs";
import { SERP_DEFAULT_DEPTH } from "../dataforseo/serp";
import { sha256Hex } from "../lib/crypto";
import {
  authorizeWorkspace,
  booleanParam,
  marketQuerySchema,
  offsetParam,
} from "../lib/research";
import { readJson, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const content = new Hono<AppEnv>();

content.use("*", requireSession);

/**
 * How many keyword ideas to ask for when expanding.
 *
 * Asks for exactly `expand` and takes them in the order DataForSEO returns
 * under a volume sort, so the expansion is "the N biggest related searches"
 * rather than a sample of a larger list we paid to fetch and threw away.
 */
const IDEAS_SORT = [
  { field: "keyword_info.search_volume", direction: "desc" as const },
];

/**
 * Ideas below this volume are not worth a $0.004 SERP.
 *
 * A zero-volume expansion keyword contributes a SERP of pages that, by
 * definition, no one is searching for — and every page it adds dilutes the
 * table. Filtering upstream means we do not pay for those SERPs at all.
 */
const MIN_EXPANSION_VOLUME = 10;

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

type DiscoverQuery = z.infer<typeof discoverQuerySchema>;

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
/* The composed set                                                            */
/* -------------------------------------------------------------------------- */

/** What goes in KV: the full deduplicated, enriched set plus how it was paid for. */
interface ComposedDiscovery {
  v: 1;
  keywordsSearched: string[];
  rows: ContentPageRow[];
  costs: ContentDiscoverCosts;
  pageScoresAvailable: boolean;
  composedAt: number;
}

const COMPOSED_VERSION = 1;

/**
 * `ws:<id>:content:discover:<sha256>`.
 *
 * Under the workspace prefix, so workspace deletion's `ws:<id>:` sweep takes
 * it — a composed set is derived from tenant-paid results and is tenant data
 * exactly as the responses it was built from are.
 *
 * Keyed on what was *bought*, and nothing else: topic, market and expansion.
 * Filters, sort and paging are deliberately absent, because they are applied
 * to this set rather than being part of what it is.
 */
async function composedCacheKey(
  workspaceId: string,
  query: DiscoverQuery,
): Promise<string> {
  const hash = await sha256Hex(
    canonicalJson({
      topic: query.topic.trim().toLowerCase(),
      location: query.location,
      language: query.language,
      expand: query.expand,
      depth: SERP_DEFAULT_DEPTH,
    }),
  );
  return `ws:${workspaceId}:content:discover:${hash}`;
}

/** A page as it is being accumulated across SERPs, before enrichment. */
interface PageAccumulator {
  url: string;
  domain: string;
  title: string | null;
  keywords: ContentPageKeyword[];
}

/**
 * Folds N SERPs into one row per unique page.
 *
 * Deduplication is by `normalizeContentUrl`, so the same article found on
 * three keywords is one row carrying three keywords — which is the entire
 * point of expanding a topic. A page's `title` is taken from the first SERP
 * that carried one: they are near-identical across SERPs, and preferring the
 * first keeps the row stable when the composition is rebuilt.
 *
 * A keyword is recorded at most once per page (its best position), because a
 * page can legitimately appear twice on one SERP — a sitelink-style double
 * listing — and counting its volume twice would inflate `totalVolume`.
 */
export function mergeSerpPages(
  serps: readonly {
    keyword: string;
    volume: number | null;
    items: readonly {
      url: string | null;
      domain: string | null;
      title: string | null;
      position: number | null;
    }[];
  }[],
): PageAccumulator[] {
  const byUrl = new Map<string, PageAccumulator>();

  for (const serp of serps) {
    for (const item of serp.items) {
      if (item.url === null || item.position === null) continue;
      const url = normalizeContentUrl(item.url);
      if (url === "") continue;

      let page = byUrl.get(url);
      if (page === undefined) {
        page = {
          url,
          domain: item.domain ?? hostOf(url),
          title: item.title,
          keywords: [],
        };
        byUrl.set(url, page);
      }
      if (page.title === null && item.title !== null) page.title = item.title;

      const existing = page.keywords.find(
        (entry) => entry.keyword === serp.keyword,
      );
      if (existing === undefined) {
        page.keywords.push({
          keyword: serp.keyword,
          position: item.position,
          volume: serp.volume,
        });
      } else if (item.position < existing.position) {
        existing.position = item.position;
      }
    }
  }

  return [...byUrl.values()];
}

/** `["a","b","c"]` in chunks of `size`. */
export function batch<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** The bare host of a URL, or "" when it will not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Builds the whole set: SERPs, dedupe, then two bulk enrichment passes.
 *
 * The enrichment is where batching matters and where the two endpoints differ:
 *
 *  - **`bulk_ranks`** is asked for domains AND page URLs in one target list.
 *    It accepts both (its own docs return URL targets before bare domains),
 *    so one call answers both the Domain Score and the Page Score column.
 *    Ceiling 1000 targets per call.
 *  - **`bulk_traffic_estimation`** is asked for page URLs only — a domain's
 *    traffic is not this table's question. Ceiling 1000, and its price is
 *    per-task PLUS per-item, so batching to the ceiling rather than under it
 *    is worth real money.
 *
 * Neither preserves input order and both omit targets their index has never
 * seen, so results are joined back by target string and a miss is null.
 */
async function compose(
  dfs: DataForSeoApi,
  query: DiscoverQuery,
): Promise<ComposedDiscovery> {
  const topic = query.topic.trim().toLowerCase();
  const costs: ContentDiscoverCosts = {
    serpUsd: 0,
    serpCalls: 0,
    ideasUsd: 0,
    scoresUsd: 0,
    trafficUsd: 0,
    totalUsd: 0,
  };

  /*
   * The expansion keywords, bought before any SERP so the SERP fan-out can run
   * as one concurrent batch. Volume travels with each keyword from here: the
   * ideas response carries it, and re-looking it up later would be a second
   * paid call for a number we already have.
   */
  const seeds: { keyword: string; volume: number | null }[] = [
    { keyword: topic, volume: null },
  ];

  if (query.expand > 0) {
    const ideas = await dfs.labs.googleKeywordIdeasLive({
      keyword: topic,
      locationCode: query.location,
      languageCode: query.language,
      limit: query.expand,
      filters: [
        { field: "keyword_info.search_volume", operator: ">", value: MIN_EXPANSION_VOLUME },
      ],
      sorts: IDEAS_SORT,
      fresh: query.fresh,
    });
    costs.ideasUsd += ideas.costUsd;

    for (const idea of ideas.items) {
      if (idea.keyword === topic) continue;
      seeds.push({ keyword: idea.keyword, volume: idea.metrics.searchVolume });
      if (seeds.length > query.expand) break;
    }
  }

  const serps = await Promise.all(
    seeds.map(async (seed) => {
      const serp = await dfs.serp.googleOrganicLiveAdvanced({
        keyword: seed.keyword,
        locationCode: query.location,
        languageCode: query.language,
        depth: SERP_DEFAULT_DEPTH,
        fresh: query.fresh,
      });
      return { seed, serp };
    }),
  );

  for (const { serp } of serps) {
    costs.serpUsd += serp.costUsd;
    costs.serpCalls += 1;
  }

  /*
   * The topic's own volume, taken from the seed SERP's keyword when the ideas
   * call did not supply one. Left null rather than bought: a dedicated volume
   * lookup for one keyword is a paid call for a column the table can show as
   * an em dash.
   */
  const pages = mergeSerpPages(
    serps.map(({ seed, serp }) => ({
      keyword: seed.keyword,
      volume: seed.volume,
      items: serp.items,
    })),
  );

  const urls = pages.map((page) => page.url);
  const domains = [...new Set(pages.map((page) => page.domain))].filter(Boolean);

  /*
   * Scores and traffic are independent of each other, so both fan-outs run
   * together. Within each, batches run concurrently too — they are separate
   * billed calls against separate target slices.
   */
  const [scores, traffic] = await Promise.all([
    Promise.all(
      batch([...domains, ...urls], BULK_RANKS_MAX_TARGETS).map((targets) =>
        dfs.backlinks.bulkRanksLive({ targets, fresh: query.fresh }),
      ),
    ),
    urls.length === 0
      ? Promise.resolve([])
      : Promise.all(
          batch(urls, BULK_TRAFFIC_ESTIMATION_MAX_TARGETS).map((targets) =>
            dfs.labs.googleBulkTrafficEstimationLive({
              targets,
              locationCode: query.location,
              languageCode: query.language,
              // Organic only: this table is about traffic a page earns, not
              // traffic a domain buys.
              itemTypes: ["organic"],
              fresh: query.fresh,
            }),
          ),
        ),
  ]);

  const scoreByTarget = new Map<string, number | null>();
  for (const result of scores) {
    costs.scoresUsd += result.costUsd;
    for (const item of result.items) {
      if (item.target !== null) scoreByTarget.set(item.target, item.domainScore);
    }
  }

  const trafficByTarget = new Map<string, number | null>();
  for (const result of traffic) {
    costs.trafficUsd += result.costUsd;
    for (const item of result.items) {
      if (item.target !== null) trafficByTarget.set(item.target, item.organic.etv);
    }
  }

  const rows: ContentPageRow[] = pages.map((page) => {
    const keywords = [...page.keywords].sort((a, b) => a.position - b.position);
    return {
      url: page.url,
      domain: page.domain,
      title: page.title,
      domainScore: scoreByTarget.get(page.domain) ?? null,
      pageScore: scoreByTarget.get(page.url) ?? null,
      estTraffic: trafficByTarget.get(page.url) ?? null,
      keywords,
      totalVolume: keywords.reduce((sum, kw) => sum + (kw.volume ?? 0), 0),
      bestPosition: keywords.reduce(
        (best, kw) => Math.min(best, kw.position),
        Number.POSITIVE_INFINITY,
      ),
      // Counted on demand, per URL, by POST /content/wordcount.
      wordCount: null,
    };
  });

  costs.totalUsd =
    costs.serpUsd + costs.ideasUsd + costs.scoresUsd + costs.trafficUsd;

  return {
    v: COMPOSED_VERSION,
    keywordsSearched: seeds.map((seed) => seed.keyword),
    rows,
    costs,
    // See the field note on the response type: an all-null page-score column
    // is a fact about their index, not a bug in ours.
    pageScoresAvailable: rows.some((row) => row.pageScore !== null),
    composedAt: Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/* Filtering, sorting, paging — all free, all over the cached set              */
/* -------------------------------------------------------------------------- */

/**
 * The filter row, applied here rather than upstream.
 *
 * `maxDomainScore` deliberately keeps rows whose score is **null**: unknown
 * authority is not high authority, and a site DataForSEO has never crawled is
 * usually a small one — precisely what someone capping the score is looking
 * for. Dropping them would hide the best answers behind a missing value.
 *
 * `minTraffic` does the opposite and drops nulls, because "at least 500 visits"
 * is a claim an unknown page cannot be said to meet.
 */
export function filterContentRows(
  rows: readonly ContentPageRow[],
  filters: {
    maxDomainScore?: number;
    minTraffic?: number;
    include?: string;
    exclude?: string;
  },
): ContentPageRow[] {
  const include = filters.include?.toLowerCase();
  const exclude = filters.exclude?.toLowerCase();

  return rows.filter((row) => {
    if (
      filters.maxDomainScore !== undefined &&
      row.domainScore !== null &&
      row.domainScore > filters.maxDomainScore
    ) {
      return false;
    }
    if (filters.minTraffic !== undefined) {
      if (row.estTraffic === null) return false;
      if (row.estTraffic < filters.minTraffic) return false;
    }
    const url = row.url.toLowerCase();
    if (include !== undefined && !url.includes(include)) return false;
    if (exclude !== undefined && url.includes(exclude)) return false;
    return true;
  });
}

/**
 * Sorts descending on the chosen column, nulls last.
 *
 * Nulls last in every direction: a page with no traffic estimate is not a
 * zero-traffic page, and floating unknowns to the top of a "most traffic"
 * table would bury the answer. Ties break on URL so a repeated request over
 * the same cached set returns rows in the same order.
 */
export function sortContentRows(
  rows: readonly ContentPageRow[],
  sort: ContentSort,
): ContentPageRow[] {
  const value = (row: ContentPageRow): number | null => {
    if (sort === "estTraffic") return row.estTraffic;
    if (sort === "domainScore") return row.domainScore;
    return row.totalVolume;
  };

  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return a.url.localeCompare(b.url);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || a.url.localeCompare(b.url);
  });
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

content.get("/discover", async (c) => {
  const query = readQuery(c, discoverQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);

  const cacheKey = await composedCacheKey(query.workspace, query);

  /*
   * `fresh` skips the read but still writes: the composition is rebuilt at
   * full price and replaces the cached one, which is what a Refresh button
   * should do — and the same rule the DataForSEO client follows.
   */
  let composed: ComposedDiscovery | null = null;
  if (!query.fresh) {
    const hit = await c.env.CACHE.get<ComposedDiscovery>(cacheKey, "json");
    if (hit !== null && hit.v === COMPOSED_VERSION) composed = hit;
  }

  const cached = composed !== null;
  if (composed === null) {
    const dfs = await createDataForSeoApi(c.env, db, query.workspace);
    composed = await compose(dfs, query);
    await c.env.CACHE.put(cacheKey, JSON.stringify(composed), {
      // A composed set is as perishable as the live SERPs under it, so it
      // takes the same 24-hour bucket. Unlike the client's own entries this
      // one does expire in KV: it is derived data that can always be rebuilt,
      // and there is no stale-if-error story for a composition.
      expirationTtl: CACHE_TTL_SECONDS.live,
    });
  }

  const filtered = filterContentRows(composed.rows, query);
  const sorted = sortContentRows(filtered, query.sort);
  const windowed = sorted.slice(query.offset, query.offset + query.limit);

  const body: ContentDiscoverResponse = {
    topic: query.topic,
    locationCode: query.location,
    languageCode: query.language,
    expand: query.expand,
    keywordsSearched: composed.keywordsSearched,
    items: windowed,
    totalCount: composed.rows.length,
    itemsCount: windowed.length,
    filteredOut: composed.rows.length - filtered.length,
    limit: query.limit,
    offset: query.offset,
    sort: query.sort,
    // A cached composition cost nothing *now*. The breakdown still travels, so
    // the UI can say what the set cost to build rather than showing $0 with no
    // explanation of where the data came from.
    costs: composed.costs,
    pageScoresAvailable: composed.pageScoresAvailable,
    costUsd: cached ? 0 : composed.costs.totalUsd,
    cached,
  };
  return c.json(body);
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
