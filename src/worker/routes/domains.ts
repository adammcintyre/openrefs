/**
 *   GET /api/v1/domains/overview      labs domain_rank_overview
 *   GET /api/v1/domains/history       labs historical_rank_overview
 *   GET /api/v1/domains/keywords      labs ranked_keywords (organic | paid)
 *   GET /api/v1/domains/pages         labs relevant_pages
 *   GET /api/v1/domains/competitors   labs competitors_domain
 *   GET /api/v1/domains/countries     domain_rank_overview across ~10 markets
 *
 * Every route is workspace-scoped and proves membership before it spends.
 * Responses are the shared types in src/shared/domains.ts.
 */
import { Hono } from "hono";
import { z } from "zod";

import type {
  DomainCompetitorsResponse,
  DomainCountriesResponse,
  DomainCountryRow,
  DomainHistoryResponse,
  DomainPagesResponse,
} from "../../shared/domains";
import { createDataForSeoApi } from "../dataforseo";
import type { DataForSeoApi } from "../dataforseo";
import { RELEVANT_PAGES_FIELDS } from "../dataforseo";
import { fetchedAtIso } from "../dataforseo/schema";
import { readQuery } from "../lib/validate";
import {
  authorizeWorkspace,
  booleanParam,
  domainParam,
  freshnessShape,
  marketQuerySchema,
  pagingQuerySchema,
  rangeQuerySchema,
  toFreshness,
  withFreshness,
} from "../lib/research";
import { requireSession } from "../middleware/auth";
import { domainKeywords, domainOverview, toRankMetrics } from "../services/domains";
import { historyContext, recordSearch } from "../services/history";
import type { AppEnv } from "../types";

const domains = new Hono<AppEnv>();

domains.use("*", requireSession);

/**
 * The country breakdown's markets, with each market's supported languages.
 *
 * Codes resolved from `dataforseo_labs/locations_and_languages` — the only
 * location list Labs endpoints accept — and pinned here rather than looked up
 * per request: the breakdown is already ~10 paid calls, and adding one more to
 * re-derive constants that change approximately never would be worse. They
 * happen to follow DataForSEO's ISO 3166-1 numeric + 2000 convention, but each
 * was verified against the live list rather than computed from it.
 *
 * **`languages` is the load-bearing part.** A Labs location accepts only its
 * own languages: Germany is `de` only, France `fr` only, Spain `es` only. A
 * naive fan-out passing the caller's single `language=en` to all ten markets
 * therefore fails five of them outright — the breakdown would come back half
 * empty and look like the domain had no presence there. So each market is
 * queried in the caller's language when it supports it, and in its own primary
 * language otherwise. The language actually used is reported per row.
 */
export const COUNTRY_BREAKDOWN_MARKETS = [
  { locationCode: 2840, countryIsoCode: "US", countryName: "United States", languages: ["en", "es"] },
  { locationCode: 2826, countryIsoCode: "GB", countryName: "United Kingdom", languages: ["en"] },
  { locationCode: 2276, countryIsoCode: "DE", countryName: "Germany", languages: ["de"] },
  { locationCode: 2250, countryIsoCode: "FR", countryName: "France", languages: ["fr"] },
  { locationCode: 2724, countryIsoCode: "ES", countryName: "Spain", languages: ["es"] },
  { locationCode: 2380, countryIsoCode: "IT", countryName: "Italy", languages: ["it"] },
  { locationCode: 2036, countryIsoCode: "AU", countryName: "Australia", languages: ["en"] },
  { locationCode: 2124, countryIsoCode: "CA", countryName: "Canada", languages: ["en", "fr"] },
  { locationCode: 2528, countryIsoCode: "NL", countryName: "Netherlands", languages: ["nl"] },
  { locationCode: 2356, countryIsoCode: "IN", countryName: "India", languages: ["en", "hi"] },
] as const;

/**
 * The language to query one market in: the caller's if that market supports
 * it, else the market's own first language.
 */
export function marketLanguage(
  market: { languages: readonly string[] },
  requested: string,
): string {
  const wanted = requested.toLowerCase();
  if (market.languages.includes(wanted)) return wanted;
  return market.languages[0] ?? wanted;
}

const domainQuerySchema = marketQuerySchema
  .extend({ domain: domainParam })
  .extend(freshnessShape);

const listQuerySchema = domainQuerySchema.extend(pagingQuerySchema.shape);

/**
 * The two views the MCP server also exposes as tools. Their bodies live in
 * `../services/domains` so the tool and the endpoint cannot drift; everything
 * else in this file has exactly one caller and stays inline.
 */
export const domainOverviewQuerySchema = domainQuerySchema;

export const domainKeywordsQuerySchema = listQuerySchema
  .extend(rangeQuerySchema.shape)
  .extend({
    paid: booleanParam,
    minPosition: z.coerce.number().int().min(1).optional(),
    maxPosition: z.coerce.number().int().min(1).optional(),
    include: z.string().trim().min(1).optional(),
    exclude: z.string().trim().min(1).optional(),
  });

/**
 * GET /api/v1/domains/overview
 *
 * The module's headline metrics, and the one domain route that records
 * history: the tabs below it are views of the same target in the same market,
 * so recording each of them would fill the trail with one search five times.
 */
domains.get("/overview", async (c) => {
  const query = readQuery(c, withFreshness(domainOverviewQuerySchema));
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  const body = await domainOverview(c.env, db, query);

  recordSearch(
    historyContext(c, db),
    query.workspace,
    "domains",
    // `query.domain` is already through `normalizeDomain`, which is the form
    // the module's URL state stores — so a trail row round-trips into the
    // search box unchanged.
    {
      target: query.domain,
      location: query.location,
      language: query.language,
    },
    {
      /*
       * Structurally null: Domain Score is a link-graph metric from the
       * Backlinks API, and this endpoint is a Labs traffic query that does not
       * carry one. Buying a second call to fill in a number for a list row
       * would make a free trail expensive, which is the opposite of the point.
       * The field stays in the shape because the summary is a contract, and
       * null there honestly means "not measured here".
       */
      domainScore: null,
      organicTraffic: body.organic.traffic,
      organicKeywords: body.organic.keywordCount,
    },
  );

  return c.json(body);
});

domains.get("/history", async (c) => {
  const query = readQuery(
    c,
    withFreshness(
      domainQuerySchema.extend({
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    ),
  );
  const { dfs } = await open(c.env, c.get("session"), query.workspace);

  const result = await dfs.labs.googleHistoricalRankOverviewLive({
    target: query.domain,
    locationCode: query.location,
    languageCode: query.language,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    ...toFreshness(query),
  });

  const body: DomainHistoryResponse = {
    domain: query.domain,
    locationCode: query.location,
    languageCode: query.language,
    // Oldest first, so a line chart reads left to right without re-sorting.
    items: [...result.items]
      .sort((a, b) => (a.period ?? "").localeCompare(b.period ?? ""))
      .map((point) => ({
        year: point.year,
        month: point.month,
        period: point.period,
        organic: toRankMetrics(point.organic),
        paid: toRankMetrics(point.paid),
      })),
    costUsd: result.costUsd,
    cached: result.cached,
    stale: result.stale ?? false,
    fetchedAt: fetchedAtIso(result),
  };
  return c.json(body);
});

domains.get("/keywords", async (c) => {
  const query = readQuery(c, withFreshness(domainKeywordsQuerySchema));
  const db = await authorizeWorkspace(c.env, c.get("session"), query.workspace);
  return c.json(await domainKeywords(c.env, db, query));
});

domains.get("/pages", async (c) => {
  const query = readQuery(c, withFreshness(listQuerySchema));
  const { dfs } = await open(c.env, c.get("session"), query.workspace);

  const result = await dfs.labs.googleRelevantPagesLive({
    target: query.domain,
    locationCode: query.location,
    languageCode: query.language,
    limit: query.limit,
    offset: query.offset,
    sorts: [{ field: RELEVANT_PAGES_FIELDS.organicEtv, direction: "desc" }],
    ...toFreshness(query),
  });

  const body: DomainPagesResponse = {
    domain: query.domain,
    locationCode: query.location,
    languageCode: query.language,
    items: result.items.map((page) => ({
      url: page.url,
      organic: toRankMetrics(page.organic),
      paid: toRankMetrics(page.paid),
    })),
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
    stale: result.stale ?? false,
    fetchedAt: fetchedAtIso(result),
  };
  return c.json(body);
});

domains.get("/competitors", async (c) => {
  const query = readQuery(c, withFreshness(listQuerySchema));
  const { dfs } = await open(c.env, c.get("session"), query.workspace);

  const result = await dfs.labs.googleCompetitorsDomainLive({
    target: query.domain,
    locationCode: query.location,
    languageCode: query.language,
    limit: query.limit,
    offset: query.offset,
    sorts: [{ field: "metrics.organic.count", direction: "desc" }],
    ...toFreshness(query),
  });

  const body: DomainCompetitorsResponse = {
    domain: query.domain,
    locationCode: query.location,
    languageCode: query.language,
    items: result.items.map((competitor) => ({
      domain: competitor.domain,
      commonKeywords: competitor.intersections,
      avgPosition: competitor.avgPosition,
      // The competitor's own totals...
      organic: toRankMetrics(competitor.fullDomain.organic),
      paid: toRankMetrics(competitor.fullDomain.paid),
      // ...and the target's numbers on the keywords they share. Different
      // domains' data; see the note on CompetitorRow.
      sharedOrganic: toRankMetrics(competitor.sharedKeywords.organic),
      sharedPaid: toRankMetrics(competitor.sharedKeywords.paid),
    })),
    totalCount: result.totalCount,
    itemsCount: result.itemsCount,
    limit: query.limit,
    offset: query.offset,
    costUsd: result.costUsd,
    cached: result.cached,
    stale: result.stale ?? false,
    fetchedAt: fetchedAtIso(result),
  };
  return c.json(body);
});

/**
 * GET /api/v1/domains/countries
 *
 * The expensive one: one domain_rank_overview per market, ~10 calls, which is
 * why the UI hides it behind a button with a cost hint.
 *
 * `Promise.allSettled`, not `Promise.all`: a domain with no presence in one
 * market, or a single upstream hiccup, must not cost the user the nine calls
 * that worked. A failed market is omitted from `items` and named in
 * `failedCountries`, and `costUsd` reflects only what actually completed.
 */
domains.get("/countries", async (c) => {
  const query = readQuery(
    c,
    withFreshness(
      marketQuerySchema
        .omit({ location: true })
        .extend({ domain: domainParam })
        .extend(freshnessShape),
    ),
  );
  const { dfs } = await open(c.env, c.get("session"), query.workspace);

  const settled = await Promise.allSettled(
    COUNTRY_BREAKDOWN_MARKETS.map(async (market) => {
      const languageCode = marketLanguage(market, query.language);
      const result = await dfs.labs.googleDomainRankOverviewLive({
        target: query.domain,
        locationCode: market.locationCode,
        languageCode,
        ...toFreshness(query),
      });
      return { market, result, languageCode };
    }),
  );

  const items: DomainCountryRow[] = [];
  const failedCountries: string[] = [];
  let costUsd = 0;
  let allCached = true;
  let anyStale = false;
  /*
   * The OLDEST market's fetch, not the newest.
   *
   * This one body is composed from ten separately cached answers, so there is
   * no single moment it was fetched. "Updated N days ago" has to be true of the
   * whole table, and only the oldest leg makes it true — claiming the newest
   * would date the report by its freshest row.
   */
  let oldestFetchedAtMs: number | null = null;

  for (const [index, outcome] of settled.entries()) {
    const market = COUNTRY_BREAKDOWN_MARKETS[index];
    if (market === undefined) continue;

    if (outcome.status === "rejected") {
      failedCountries.push(market.countryIsoCode);
      continue;
    }

    const { result, languageCode } = outcome.value;
    costUsd += result.costUsd;
    allCached &&= result.cached;
    anyStale ||= result.stale === true;
    if (
      typeof result.fetchedAtMs === "number" &&
      (oldestFetchedAtMs === null || result.fetchedAtMs < oldestFetchedAtMs)
    ) {
      oldestFetchedAtMs = result.fetchedAtMs;
    }
    items.push({
      locationCode: market.locationCode,
      countryIsoCode: market.countryIsoCode,
      countryName: market.countryName,
      // Not necessarily the requested language — see COUNTRY_BREAKDOWN_MARKETS.
      languageCode,
      organic: toRankMetrics(result.organic),
      paid: toRankMetrics(result.paid),
    });
  }

  const body: DomainCountriesResponse = {
    domain: query.domain,
    languageCode: query.language,
    // Biggest market first — the bar chart's order.
    items: items.sort((a, b) => (b.organic.traffic ?? 0) - (a.organic.traffic ?? 0)),
    failedCountries,
    requestedCount: COUNTRY_BREAKDOWN_MARKETS.length,
    costUsd,
    // "Cached" only if nothing was paid for; an empty success set is not cached.
    cached: items.length > 0 && allCached,
    // One stale leg makes the whole table older than we would normally serve.
    stale: anyStale,
    fetchedAt:
      oldestFetchedAtMs === null ? null : new Date(oldestFetchedAtMs).toISOString(),
  };
  return c.json(body);
});

/** Membership proof plus a workspace-bound DataForSEO client. */
async function open(
  env: Env,
  session: AppEnv["Variables"]["session"],
  workspaceId: string,
): Promise<{ dfs: DataForSeoApi }> {
  const db = await authorizeWorkspace(env, session, workspaceId);
  return { dfs: await createDataForSeoApi(env, db, workspaceId) };
}

export default domains;
