/**
 * Gap Analysis, as functions rather than routes.
 *
 * This module holds what `routes/gap.ts` used to do inline. It moved here when
 * the MCP server landed: `/gap/keywords` is a tool as well as an endpoint, and
 * an agent calling the tool must get exactly what the SPA gets from the
 * endpoint. Two copies of a fan-out is precisely how that stops being true, so
 * there is one.
 *
 * The split is drawn at authorisation. Everything here takes an already-proven
 * `Db` handle and a validated input object; nothing here reads a Hono context,
 * parses a query string, or checks membership. The route does that, the MCP
 * tool does that, and both then call the same function.
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
import type { Db } from "../../db";
import type {
  GapKeywordRow,
  GapKeywordsResponse,
  GapMode,
  GapPosition,
} from "../../shared/gap";
import { createDataForSeoApi } from "../dataforseo";
import type { DomainIntersectionRow, IntersectionSerpElement } from "../dataforseo";
import {
  DOMAIN_INTERSECTION_FIELDS,
  INTERSECTION_KEYWORD_FIELDS,
  containsFilter,
  itemFieldRef,
  normalizeTarget,
  rangeFilters,
} from "../dataforseo";
import type { LabsFilter, LabsSort } from "../dataforseo/filters";
import { ApiException } from "../http";

/** Rankings are compared as organic positions; ads are a different question. */
export const ORGANIC_ONLY = ["organic"] as const;

/** One sort rule, sent on every call so merged pages line up. */
export const BY_VOLUME_DESC: LabsSort[] = [
  { field: INTERSECTION_KEYWORD_FIELDS.searchVolume, direction: "desc" },
];

/** The validated input `GET /api/v1/gap/keywords` resolves to. */
export interface GapKeywordsInput {
  workspace: string;
  /** Already normalised to a bare hostname. */
  target: string;
  /** Already split and normalised, 1..GAP_MAX_COMPETITORS of them. */
  competitors: string[];
  location: number;
  language: string;
  mode: GapMode;
  limit: number;
  offset: number;
  /** Bypass the cache and buy a new answer. */
  fresh?: boolean;
  /** Serve a cached answer past its normal lifetime, spending nothing. */
  allowStale?: boolean;
  minVolume?: number;
  maxVolume?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
  include?: string;
  exclude?: string;
}

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

export function toGapPosition(
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

export interface GapResult {
  rows: GapKeywordRow[];
  /** Merged rows before the mode filter — the source of `filteredOut`. */
  fetchedCount: number;
  totalCount: number | null;
  costUsd: number;
  cached: boolean;
  /** True when ANY pairwise leg served an entry past its normal lifetime. */
  stale: boolean;
  /**
   * The OLDEST leg's fetch, epoch ms, or null when no leg reported one.
   *
   * A gap table is composed from N separately cached pairwise answers, so
   * there is no single moment it was fetched. Only the oldest leg makes
   * "updated N days ago" true of the whole table.
   */
  fetchedAtMs: number | null;
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
 *
 * `limit` is a parameter rather than being read off the input because the CSV
 * export runs the identical fan-out at its own ceiling: the endpoint passes
 * `input.limit`, the export passes `GAP_CSV_MAX_ROWS` and ignores it.
 */
export async function fetchGapKeywords(
  env: Env,
  db: Db,
  input: GapKeywordsInput,
  limit: number,
): Promise<GapResult> {
  // A domain cannot be its own competitor, and leaving it in would make every
  // mode nonsense (you always rank exactly where you rank).
  const competitors = [...new Set(input.competitors)].filter(
    (domain) => domain !== normalizeTarget(input.target),
  );
  if (competitors.length === 0) {
    throw new ApiException(
      "validation_failed",
      "Give at least one competitor domain other than the target.",
    );
  }

  const dfs = await createDataForSeoApi(env, db, input.workspace);

  const baseFilters = gapKeywordFilters(input);
  const upstreamQueries = upstreamQueriesForMode(input.mode);

  const calls = competitors.flatMap((competitor, competitorIndex) =>
    upstreamQueries.map(async (upstream) => {
      const result = await dfs.labs.googleDomainIntersectionLive({
        // Uniform for every call in this module: the competitor is target1,
        // you are target2. `first` is theirs, `second` is yours.
        target1: competitor,
        target2: input.target,
        locationCode: input.location,
        languageCode: input.language,
        intersections: upstream.intersections,
        itemTypes: [...ORGANIC_ONLY],
        limit,
        offset: input.offset,
        filters: upstream.requireOutranking
          ? [...baseFilters, competitorOutranksFilter()]
          : baseFilters,
        sorts: BY_VOLUME_DESC,
        fresh: input.fresh,
        allowStale: input.allowStale,
      });
      return { competitorIndex, result };
    }),
  );

  const settled = await Promise.all(calls);

  const merged = mergeGapRows(
    input.target,
    competitors,
    settled.map(({ competitorIndex, result }) => ({
      competitorIndex,
      rows: result.items,
    })),
  );

  return {
    rows: merged.filter((row) => matchesGapMode(input.mode, row)),
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
    stale: settled.some(({ result }) => result.stale === true),
    fetchedAtMs: settled.reduce<number | null>(
      (oldest, { result }) =>
        typeof result.fetchedAtMs !== "number"
          ? oldest
          : oldest === null
            ? result.fetchedAtMs
            : Math.min(oldest, result.fetchedAtMs),
      null,
    ),
    competitors,
  };
}

/** The fan-out at the caller's own page size, in the endpoint's envelope. */
export async function gapKeywords(
  env: Env,
  db: Db,
  input: GapKeywordsInput,
): Promise<GapKeywordsResponse> {
  const result = await fetchGapKeywords(env, db, input, input.limit);

  return {
    target: input.target,
    competitors: result.competitors,
    locationCode: input.location,
    languageCode: input.language,
    mode: input.mode,
    items: result.rows,
    totalCount: result.totalCount,
    itemsCount: result.rows.length,
    filteredOut: result.fetchedCount - result.rows.length,
    limit: input.limit,
    offset: input.offset,
    costUsd: result.costUsd,
    cached: result.cached,
    stale: result.stale,
    fetchedAt:
      result.fetchedAtMs === null
        ? null
        : new Date(result.fetchedAtMs).toISOString(),
  };
}
