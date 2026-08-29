/**
 *   GET /api/v1/gap/keywords             labs domain_intersection (fanned out)
 *   GET /api/v1/gap/keywords/export.csv  the same query, as an attachment
 *   GET /api/v1/gap/pages                labs page_intersection
 *
 * Workspace-scoped with the same guard as routes/keywords.ts. Responses are
 * the shared types in src/shared/gap.ts.
 *
 * ## Why this module fans out
 *
 * `domain_intersection` compares exactly **two** domains — `target1` and
 * `target2`, two flat strings, with no third slot and no array form. Comparing
 * your site against four competitors is therefore four pairwise calls, merged
 * here. Every call is `target1 = competitor, target2 = you`, so the mapping is
 * uniform throughout: `first` is always the competitor, `second` is always you.
 *
 * ## What is filtered upstream and what is filtered here
 *
 * **Upstream (server-side), always:** volume range, difficulty range, keyword
 * include/exclude — all on `keyword_data.*` paths — plus the mode's own half:
 *
 *  - `missing` / `untapped` send `intersections: false`, which is DataForSEO's
 *    own "target1 ranks, target2 does not" query. The "you don't rank" half of
 *    those two modes therefore costs nothing to evaluate here.
 *  - `weak` sends `intersections: true` plus a field-to-field filter
 *    (`first_domain_serp_element.rank_group < $item->second_domain_serp_element
 *    .rank_group`), so only keywords where that competitor already outranks you
 *    come back.
 *  - `all` sends both queries per competitor and filters nothing.
 *
 * **Worker-side, and only this:** combining the per-competitor result sets.
 * `missing` needs "every competitor ranks" and `weak` needs "every competitor
 * outranks me", and neither is expressible in one pairwise call — they are
 * facts about the intersection of N separate responses. `untapped` needs only
 * the union, so its worker-side step is the merge itself.
 *
 * ## The windowing caveat
 *
 * `limit`/`offset` apply to each pairwise call, so a merged page is the union
 * (or intersection) of N windows, not a window over a merged set. A keyword
 * that a competitor ranks for beyond its own window shows as a null position
 * rather than a missing row, which can understate `missing` on a small page.
 * A larger `limit` narrows the gap; there is no upstream shape that avoids it.
 */
import { Hono } from "hono";
import { z } from "zod";

import type {
  GapKeywordRow,
  GapKeywordsResponse,
  GapMode,
  GapPageRow,
  GapPagesResponse,
  GapPosition,
} from "../../shared/gap";
import {
  GAP_MAX_COMPETITORS,
  GAP_MAX_PAGES,
  GAP_MODES,
} from "../../shared/gap";
import { createDataForSeoApi } from "../dataforseo";
import type { DomainIntersectionRow, IntersectionSerpElement } from "../dataforseo";
import {
  DOMAIN_INTERSECTION_FIELDS,
  INTERSECTION_KEYWORD_FIELDS,
  PAGE_INTERSECTION_MODES,
  containsFilter,
  itemFieldRef,
  normalizeTarget,
  rangeFilters,
} from "../dataforseo";
import type { LabsFilter, LabsSort } from "../dataforseo/filters";
import { ApiException } from "../http";
import { attachmentHeader, slugify, toCsv } from "../lib/csv";
import {
  authorizeWorkspace,
  booleanParam,
  domainParam,
  marketQuerySchema,
  normalizeDomain,
  pagingQuerySchema,
  rangeQuerySchema,
} from "../lib/research";
import { readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const gap = new Hono<AppEnv>();

gap.use("*", requireSession);

/**
 * How many rows one CSV export may contain.
 *
 * The export makes exactly the same upstream calls as the table — one window
 * per competitor, at this limit — so clicking Export costs the same as loading
 * one page, never a runaway multiple of it. 1000 is DataForSEO's own per-call
 * ceiling and comfortably more than a spreadsheet needs.
 */
export const GAP_CSV_MAX_ROWS = 1000;

/** Rankings are compared as organic positions; ads are a different question. */
const ORGANIC_ONLY = ["organic"] as const;

/** One sort rule, sent on every call so merged pages line up. */
const BY_VOLUME_DESC: LabsSort[] = [
  { field: INTERSECTION_KEYWORD_FIELDS.searchVolume, direction: "desc" },
];

/** `?competitors=a.com,b.com` → normalised, de-duplicated hostnames. */
const competitorsParam = z
  .string()
  .trim()
  .min(1, "Give at least one competitor domain.")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => normalizeDomain(entry))
      .filter((entry) => entry.length > 0),
  )
  .refine((list) => list.length > 0, "Give at least one competitor domain.")
  .refine(
    (list) => list.length <= GAP_MAX_COMPETITORS,
    `At most ${GAP_MAX_COMPETITORS} competitors per request.`,
  )
  .refine(
    (list) => list.every((entry) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(entry)),
    "Each competitor must be a hostname, e.g. 'example.com'.",
  );

const gapKeywordsQuerySchema = marketQuerySchema
  .extend({
    target: domainParam,
    competitors: competitorsParam,
    mode: z.enum(GAP_MODES).optional().default("missing"),
    fresh: booleanParam,
  })
  .extend(pagingQuerySchema.shape)
  .extend(rangeQuerySchema.shape)
  .extend({
    include: z.string().trim().min(1).optional(),
    exclude: z.string().trim().min(1).optional(),
  });

type GapKeywordsQuery = z.infer<typeof gapKeywordsQuerySchema>;

const gapPagesQuerySchema = marketQuerySchema
  .extend({
    /** Absolute URLs, comma-separated. Wildcards (`/*`) are passed through. */
    pages: z
      .string()
      .trim()
      .min(1)
      .transform((value) =>
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      )
      .refine((list) => list.length > 0, "Give at least one page URL.")
      .refine(
        (list) => list.length <= GAP_MAX_PAGES,
        `At most ${GAP_MAX_PAGES} pages per request.`,
      ),
    excludePages: z
      .string()
      .trim()
      .optional()
      .transform((value) =>
        value === undefined
          ? undefined
          : value
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
      ),
    intersectionMode: z.enum(PAGE_INTERSECTION_MODES).optional(),
    fresh: booleanParam,
  })
  .extend(pagingQuerySchema.shape)
  .extend(rangeQuerySchema.shape)
  .extend({
    include: z.string().trim().min(1).optional(),
    exclude: z.string().trim().min(1).optional(),
  });

/**
 * The filters every intersection call carries. All on `keyword_data.*`, which
 * is the nesting both intersection endpoints use for the keyword half of a row.
 *
 * At most six conditions, leaving room under DataForSEO's limit of eight for
 * the `weak` mode's comparison filter.
 */
export function gapKeywordFilters(query: {
  minVolume?: number;
  maxVolume?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
  include?: string;
  exclude?: string;
}): LabsFilter[] {
  return [
    ...rangeFilters(
      INTERSECTION_KEYWORD_FIELDS.searchVolume,
      query.minVolume,
      query.maxVolume,
    ),
    ...rangeFilters(
      INTERSECTION_KEYWORD_FIELDS.keywordDifficulty,
      query.minDifficulty,
      query.maxDifficulty,
    ),
    ...(query.include
      ? [containsFilter(INTERSECTION_KEYWORD_FIELDS.keyword, query.include)]
      : []),
    ...(query.exclude
      ? [containsFilter(INTERSECTION_KEYWORD_FIELDS.keyword, query.exclude, true)]
      : []),
  ];
}

/**
 * "This competitor already outranks me", server-side.
 *
 * Uses DataForSEO's field-to-field comparison form, where the right-hand side
 * is another field prefixed with `$item->`. Positions are compared as
 * `rank_group`, and lower is better, so the competitor (`first`) must be
 * strictly less than you (`second`).
 */
export function competitorOutranksFilter(): LabsFilter {
  return {
    field: DOMAIN_INTERSECTION_FIELDS.firstPosition,
    operator: "<",
    value: itemFieldRef(DOMAIN_INTERSECTION_FIELDS.secondPosition),
  };
}

/**
 * Which upstream queries a mode needs, per competitor.
 *
 * `intersections: false` is "the competitor ranks and you do not";
 * `intersections: true` is "you both rank". `all` is the only mode that needs
 * both, and is correspondingly the only one that costs two calls per
 * competitor.
 */
export function upstreamQueriesForMode(
  mode: GapMode,
): { intersections: boolean; requireOutranking: boolean }[] {
  switch (mode) {
    case "missing":
    case "untapped":
      return [{ intersections: false, requireOutranking: false }];
    case "weak":
      return [{ intersections: true, requireOutranking: true }];
    case "all":
      return [
        { intersections: false, requireOutranking: false },
        { intersections: true, requireOutranking: false },
      ];
  }
}

/**
 * Does this merged row belong in this mode?
 *
 * The definitions, stated once so the tests and the UI copy cannot drift:
 *
 *  - `missing` — you are absent AND every competitor ranks.
 *  - `untapped` — you are absent AND at least one competitor ranks. Strictly
 *    broader than `missing`: every missing keyword is also untapped. The
 *    difference is the whole peer set having it (a strong signal that the
 *    keyword applies to your market) versus one rival having found it.
 *  - `weak` — you rank, and at least one competitor ranks ahead of you. The
 *    lenient reading (industry convention, and the orchestrator's call): with
 *    several competitors, "every competitor outranks you" is so rare the tab
 *    reads as broken, while "someone you named beats you here" is exactly the
 *    actionable list. Competitors that do not rank contribute nothing either
 *    way.
 *  - `all` — everything fetched.
 */
export function matchesGapMode(mode: GapMode, row: GapKeywordRow): boolean {
  const positions = row.competitors.map((competitor) => competitor.position);
  const ranking = positions.filter(
    (position): position is number => position !== null,
  );
  const everyCompetitorRanks =
    positions.length > 0 && ranking.length === positions.length;

  switch (mode) {
    case "all":
      return true;
    case "missing":
      return row.target.position === null && everyCompetitorRanks;
    case "untapped":
      return row.target.position === null && ranking.length > 0;
    case "weak": {
      const mine = row.target.position;
      if (mine === null || ranking.length === 0) return false;
      return ranking.some((position) => position < mine);
    }
  }
}

/** One competitor's pairwise result set, tagged with which competitor it is. */
export interface GapFetch {
  competitorIndex: number;
  rows: DomainIntersectionRow[];
}

function toGapPosition(
  domain: string,
  element: IntersectionSerpElement | null,
): GapPosition {
  return {
    domain,
    position: element?.position ?? null,
    url: element?.url ?? null,
    traffic: element?.etv ?? null,
  };
}

/**
 * Folds N pairwise result sets into one row per keyword.
 *
 * `first` is always the competitor and `second` always you — the fan-out sends
 * every call as `target1 = competitor, target2 = you` precisely so this holds.
 * A competitor whose result set does not contain a keyword gets a null
 * position in its slot rather than being dropped, which is what keeps one
 * table column per competitor aligned.
 */
export function mergeGapRows(
  target: string,
  competitors: readonly string[],
  fetches: readonly GapFetch[],
): GapKeywordRow[] {
  const byKeyword = new Map<string, GapKeywordRow>();

  for (const fetch of fetches) {
    for (const row of fetch.rows) {
      const keyword = row.keyword?.keyword;
      if (!keyword) continue;

      let entry = byKeyword.get(keyword);
      if (!entry) {
        entry = {
          keyword,
          searchVolume: row.keyword?.metrics.searchVolume ?? null,
          cpc: row.keyword?.metrics.cpc ?? null,
          competition: row.keyword?.metrics.competition ?? null,
          competitionLevel: row.keyword?.metrics.competitionLevel ?? null,
          keywordDifficulty: row.keyword?.keywordDifficulty ?? null,
          intent: row.keyword?.mainIntent ?? null,
          target: { domain: target, position: null, url: null, traffic: null },
          competitors: competitors.map((domain) => ({
            domain,
            position: null,
            url: null,
            traffic: null,
          })),
          bestCompetitorTraffic: null,
        };
        byKeyword.set(keyword, entry);
      }

      entry.competitors[fetch.competitorIndex] = toGapPosition(
        competitors[fetch.competitorIndex] ?? "",
        row.first,
      );
      // Only the `intersections: true` half carries a second element, and a
      // keyword appears in at most one of the two halves, so this never
      // overwrites a known position with a null one.
      if (row.second) {
        entry.target = toGapPosition(target, row.second);
      }
    }
  }

  for (const entry of byKeyword.values()) {
    const traffic = entry.competitors
      .filter((competitor) => competitor.position !== null)
      .map((competitor) => competitor.traffic)
      .filter((value): value is number => value !== null);
    entry.bestCompetitorTraffic = traffic.length > 0 ? Math.max(...traffic) : null;
  }

  // Highest volume first, then alphabetical so equal-volume rows have a stable
  // order across requests (the merge iterates a Map, whose order depends on
  // which competitor's call happened to see a keyword first).
  return [...byKeyword.values()].sort(
    (a, b) =>
      (b.searchVolume ?? -1) - (a.searchVolume ?? -1) ||
      a.keyword.localeCompare(b.keyword),
  );
}

interface GapResult {
  rows: GapKeywordRow[];
  /** Merged rows before the mode filter — the source of `filteredOut`. */
  fetchedCount: number;
  totalCount: number | null;
  costUsd: number;
  cached: boolean;
  competitors: string[];
}

/**
 * The fan-out: one pairwise call per competitor per upstream query, run
 * concurrently, merged, then mode-filtered.
 *
 * A competitor that errors is **not** swallowed. Unlike the country breakdown
 * in routes/domains.ts — where a missing market is one empty row — a missing
 * competitor here silently changes what `missing` and `weak` mean (both are
 * "every competitor" claims), so a partial answer would be a wrong answer
 * rather than an incomplete one.
 */
async function fetchGap(
  env: Env,
  session: Parameters<typeof authorizeWorkspace>[1],
  query: GapKeywordsQuery,
  limit: number,
): Promise<GapResult> {
  // A domain cannot be its own competitor, and leaving it in would make every
  // mode nonsense (you always rank exactly where you rank).
  const competitors = [...new Set(query.competitors)].filter(
    (domain) => domain !== normalizeTarget(query.target),
  );
  if (competitors.length === 0) {
    throw new ApiException(
      "validation_failed",
      "Give at least one competitor domain other than the target.",
    );
  }

  const db = await authorizeWorkspace(env, session, query.workspace);
  const dfs = await createDataForSeoApi(env, db, query.workspace);

  const baseFilters = gapKeywordFilters(query);
  const upstreamQueries = upstreamQueriesForMode(query.mode);

  const calls = competitors.flatMap((competitor, competitorIndex) =>
    upstreamQueries.map(async (upstream) => {
      const result = await dfs.labs.googleDomainIntersectionLive({
        // Uniform for every call in this module: the competitor is target1,
        // you are target2. `first` is theirs, `second` is yours.
        target1: competitor,
        target2: query.target,
        locationCode: query.location,
        languageCode: query.language,
        intersections: upstream.intersections,
        itemTypes: [...ORGANIC_ONLY],
        limit,
        offset: query.offset,
        filters: upstream.requireOutranking
          ? [...baseFilters, competitorOutranksFilter()]
          : baseFilters,
        sorts: BY_VOLUME_DESC,
        fresh: query.fresh,
      });
      return { competitorIndex, result };
    }),
  );

  const settled = await Promise.all(calls);

  const merged = mergeGapRows(
    query.target,
    competitors,
    settled.map(({ competitorIndex, result }) => ({
      competitorIndex,
      rows: result.items,
    })),
  );

  return {
    rows: merged.filter((row) => matchesGapMode(query.mode, row)),
    fetchedCount: merged.length,
    // The largest of the per-competitor totals. Paging is per pairwise call,
    // so "is there more upstream?" is true while ANY competitor has more —
    // this is that signal, not a count of the merged set.
    totalCount: settled.reduce<number | null>(
      (max, { result }) =>
        result.totalCount === null ? max : Math.max(max ?? 0, result.totalCount),
      null,
    ),
    costUsd: settled.reduce((total, { result }) => total + result.costUsd, 0),
    cached: settled.every(({ result }) => result.cached),
    competitors,
  };
}

/**
 * GET /api/v1/gap/keywords
 */
gap.get("/keywords", async (c) => {
  const query = readQuery(c, gapKeywordsQuerySchema);
  const result = await fetchGap(c.env, c.get("session"), query, query.limit);

  const body: GapKeywordsResponse = {
    target: query.target,
    competitors: result.competitors,
    locationCode: query.location,
    languageCode: query.language,
    mode: query.mode,
    items: result.rows,
    totalCount: result.totalCount,
    itemsCount: result.rows.length,
    filteredOut: result.fetchedCount - result.rows.length,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

/**
 * GET /api/v1/gap/keywords/export.csv
 *
 * Same query parameters as `/gap/keywords`, so a table's current filter and
 * mode export exactly what is on screen — except `limit`, which is raised to
 * `GAP_CSV_MAX_ROWS` because a spreadsheet is not paged.
 */
gap.get("/keywords/export.csv", async (c) => {
  const query = readQuery(c, gapKeywordsQuerySchema);
  const result = await fetchGap(c.env, c.get("session"), query, GAP_CSV_MAX_ROWS);

  const csv = toCsv(
    gapCsvHeader(result.competitors),
    result.rows.map((row) => gapCsvRow(row)),
  );

  const filename = `${slugify(`${query.target}-gap-${query.mode}`, "gap")}.csv`;
  return c.body(csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": attachmentHeader(filename),
    // An export is a point-in-time snapshot; a cached one is a wrong one.
    "cache-control": "no-store",
  });
});

/** Column order for the CSV, with one position column per competitor. */
export function gapCsvHeader(competitors: readonly string[]): string[] {
  return [
    "keyword",
    "search_volume",
    "keyword_difficulty",
    "cpc",
    "intent",
    "your_position",
    ...competitors.map((domain) => `${domain}_position`),
    "best_competitor_traffic",
  ];
}

/**
 * One CSV row. A domain that does not rank exports as an empty cell rather
 * than a 0 — the same distinction the table draws with a dash, and the one
 * that would otherwise turn "absent" into "position zero" in a spreadsheet.
 */
export function gapCsvRow(row: GapKeywordRow): unknown[] {
  return [
    row.keyword,
    row.searchVolume,
    row.keywordDifficulty,
    row.cpc,
    row.intent,
    row.target.position,
    ...row.competitors.map((competitor) => competitor.position),
    row.bestCompetitorTraffic,
  ];
}

/**
 * GET /api/v1/gap/pages
 *
 * page_intersection compares up to 20 **URLs** rather than domains, and has no
 * "you" — every page is one of the compared set — so it carries no mode.
 */
gap.get("/pages", async (c) => {
  const query = readQuery(c, gapPagesQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const dfs = await createDataForSeoApi(c.env, db, query.workspace);

  const result = await dfs.labs.googlePageIntersectionLive({
    pages: query.pages,
    excludePages: query.excludePages,
    intersectionMode: query.intersectionMode,
    locationCode: query.location,
    languageCode: query.language,
    itemTypes: [...ORGANIC_ONLY],
    limit: query.limit,
    offset: query.offset,
    filters: gapKeywordFilters(query),
    sorts: BY_VOLUME_DESC,
    fresh: query.fresh,
  });

  const items: GapPageRow[] = result.items.map((row) => ({
    keyword: row.keyword?.keyword ?? "",
    searchVolume: row.keyword?.metrics.searchVolume ?? null,
    cpc: row.keyword?.metrics.cpc ?? null,
    competition: row.keyword?.metrics.competition ?? null,
    competitionLevel: row.keyword?.metrics.competitionLevel ?? null,
    keywordDifficulty: row.keyword?.keywordDifficulty ?? null,
    intent: row.keyword?.mainIntent ?? null,
    // Positioned like the `pages` that were requested, so column N is page N.
    pages: row.pages.map((element, index) =>
      toGapPosition(query.pages[index] ?? "", element),
    ),
  }));

  const body: GapPagesResponse = {
    pages: query.pages,
    locationCode: query.location,
    languageCode: query.language,
    items,
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
  };
  return c.json(body);
});

export default gap;
