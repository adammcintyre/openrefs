/**
 * TanStack Query bindings for `/api/v1/domains/*`, plus the one call this
 * screen makes outside that family: `POST /backlinks/scores` for the Domain
 * Score gauge. The score is not on any Labs response — it comes from the
 * backlinks index, which is a separate endpoint at a separate price — so it is
 * a separate purchase that obeys all the same rules.
 *
 * Two rules shape this file, and both come from the fact that every one of
 * these calls spends the workspace's DataForSEO credits:
 *
 * 1. **No automatic retries.** The app-wide default retries once, which is
 *    right for a free read and wrong here: a 502 from DataForSEO may already
 *    have been billed, and a 409/402 will never succeed on a second attempt.
 *    Failures surface with an explicit Retry the user chooses to press.
 * 2. **Nothing fetches until it is asked for.** Queries are `enabled` only for
 *    a searchable target, tab panels mount lazily (so switching tabs is what
 *    triggers that tab's call), and the country breakdown needs a click.
 *
 * **Cache mode is a request parameter, never a query key.** Opening a search
 * from the history trail asks the Worker for the cached copy even past its soft
 * TTL (`stale=true`, $0, no network upstream); Refresh asks it to bypass the
 * cache and bill (`fresh=true`). Both are properties of *this fetch*, not of
 * *this result* — putting either in a key would mint a second client cache
 * entry for the same domain and market, so the same screen would be holding two
 * copies of one report and flipping between them as the mode changed.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import type { BacklinksScoresResponse } from "../../../shared/backlinks";
import type {
  DomainCompetitorsResponse,
  DomainCountriesResponse,
  DomainHistoryResponse,
  DomainKeywordsResponse,
  DomainOverviewResponse,
  DomainPagesResponse,
} from "../../../shared/domains";
import { api } from "../../lib/api";
import type { KeywordFilters } from "./keyword-filters";
import type { DomainSearch, DomainTabId } from "./url-state";

/**
 * Rows per "Load more". The Worker caps `limit` at 200 and defaults to 50;
 * 50 is a screenful and change, and keeps a mis-click cheap.
 */
export const PAGE_SIZE = 50;

/**
 * How this fetch may use the server-side cache.
 *
 * `auto` is the ordinary path: serve the cache inside its TTL, otherwise fetch
 * and bill. `stale` accepts an expired copy rather than spending — what a
 * history click wants, and the only reason revisiting past research is free.
 * There is no `fresh` member: bypassing the cache is a mutation, not a mode a
 * mounting query can fall into.
 */
export type CacheMode = "auto" | "stale";

/** Appends `stale=true` for the history path; `auto` adds nothing. */
function withCacheMode(
  params: URLSearchParams,
  cacheMode: CacheMode,
): URLSearchParams {
  if (cacheMode === "stale") params.set("stale", "true");
  return params;
}

/**
 * The domain + market every endpoint here shares, plus the cache mode.
 *
 * Exported so the billing invariants can be asserted without a DOM: this
 * builder can produce `stale=true` and must never produce `fresh=true`.
 */
export function domainQueryParams(
  workspaceId: string,
  search: DomainSearch,
  cacheMode: CacheMode = "auto",
): URLSearchParams {
  return withCacheMode(
    new URLSearchParams({
      workspace: workspaceId,
      domain: search.target,
      location: String(search.location),
      language: search.language,
    }),
    cacheMode,
  );
}

/**
 * The same query, told to bypass the cache and bill.
 *
 * The only builder in this file that sets `fresh`, and it is reachable only
 * from `useRefreshDomain` — which is reachable only from a button press. Never
 * carries `stale`: the two together are a 422 by contract, and asking for a
 * fresh copy of a stale copy is not a thing anyone means.
 */
export function domainFreshParams(
  workspaceId: string,
  search: DomainSearch,
): URLSearchParams {
  const params = domainQueryParams(workspaceId, search);
  params.set("fresh", "true");
  return params;
}

/**
 * The Domain Score lookup's body, for `POST /backlinks/scores`.
 *
 * A body rather than a query string because that endpoint is a POST — it is
 * built to score a page of domains at once, and this screen happens to want
 * exactly one. The freshness fields mean what `domainQueryParams` means by
 * them, and the same invariant holds: this builder can produce `stale` and can
 * never produce `fresh`.
 *
 * **No location or language.** A link profile is a property of the web, not of
 * a market (see the Backlinks module's url-state), so switching market must not
 * re-buy a score that cannot have changed.
 */
export function domainScoreBody(
  workspaceId: string,
  search: DomainSearch,
  cacheMode: CacheMode = "auto",
): { workspace: string; targets: string[]; stale?: boolean } {
  const body = { workspace: workspaceId, targets: [search.target] };
  return cacheMode === "stale" ? { ...body, stale: true } : body;
}

/** The same lookup, told to bypass the cache and bill. Refresh only. */
export function domainScoreFreshBody(
  workspaceId: string,
  search: DomainSearch,
): { workspace: string; targets: string[]; fresh: boolean } {
  const { workspace, targets } = domainScoreBody(workspaceId, search);
  // Built field by field rather than spread, so `stale` cannot ride along: the
  // pair is a 422 by contract.
  return { workspace, targets, fresh: true };
}

/** Internal alias, so the call sites below read the way they always did. */
const marketParams = domainQueryParams;

function withFilters(
  params: URLSearchParams,
  filters: KeywordFilters,
): URLSearchParams {
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || Number.isNaN(value)) continue;
    params.set(key, String(value));
  }
  return params;
}

/**
 * Offset of the next page, or undefined when we have everything.
 *
 * Three separate stop conditions because the upstream is not consistent about
 * which one it gives us: an empty page, a short page, or a `totalCount` we
 * have already reached. Any of them means one more call would buy nothing.
 */
function nextOffset(page: {
  items: ReadonlyArray<unknown>;
  offset: number;
  limit: number;
  totalCount: number | null;
}): number | undefined {
  if (page.items.length === 0) return undefined;
  if (page.items.length < page.limit) return undefined;
  const loaded = page.offset + page.items.length;
  if (page.totalCount !== null && loaded >= page.totalCount) return undefined;
  return loaded;
}

/** See the file header: money-spending queries never retry themselves. */
const NO_RETRY = { retry: false } as const;

/* --------------------------------- keys ----------------------------------- */

/**
 * Every key this module owns, in one place, so the refresh mutation below can
 * write into exactly the entries the hooks read from. Cache mode is absent from
 * all of them by design — see the file header.
 */
export const domainKeys = {
  all: ["domains"] as const,
  overview: (workspaceId: string | null, search: DomainSearch) =>
    ["domains", "overview", workspaceId, search.target, search.location, search.language] as const,
  history: (workspaceId: string | null, search: DomainSearch) =>
    ["domains", "history", workspaceId, search.target, search.location, search.language] as const,
  keywords: (
    workspaceId: string | null,
    search: DomainSearch,
    paid: boolean,
    filters: KeywordFilters,
  ) =>
    [
      "domains",
      "keywords",
      workspaceId,
      search.target,
      search.location,
      search.language,
      paid,
      filters,
    ] as const,
  pages: (workspaceId: string | null, search: DomainSearch) =>
    ["domains", "pages", workspaceId, search.target, search.location, search.language] as const,
  competitors: (workspaceId: string | null, search: DomainSearch) =>
    ["domains", "competitors", workspaceId, search.target, search.location, search.language] as const,
  countries: (workspaceId: string | null, search: DomainSearch) =>
    ["domains", "countries", workspaceId, search.target, search.language] as const,
  /** Market-free, because a link profile is not a per-market fact. */
  score: (workspaceId: string | null, search: DomainSearch) =>
    ["domains", "score", workspaceId, search.target] as const,
};

/**
 * An hour.
 *
 * Authority moves over months, and this is a second billed call sitting beside
 * the headline block — background refetching it would be spending the user's
 * money to redraw a dial at the same number.
 */
const SCORE_STALE_TIME = 60 * 60_000;

/**
 * The gauge's query, as options rather than a hook.
 *
 * Split out for the same reason the params builders are exported: the rule that
 * matters — *this never fires without a target* — is then assertable without a
 * DOM, and a hook is not.
 */
export function domainScoreQueryOptions(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
  cacheMode: CacheMode = "auto",
) {
  return {
    queryKey: domainKeys.score(workspaceId, search),
    queryFn: () =>
      api.post<BacklinksScoresResponse>(
        "/backlinks/scores",
        domainScoreBody(workspaceId ?? "", search, cacheMode),
      ),
    // An empty target is not a lookup, it is a 422 the user pays nothing for
    // and learns nothing from.
    enabled: enabled && workspaceId !== null && search.target !== "",
    staleTime: SCORE_STALE_TIME,
    ...NO_RETRY,
  };
}

/**
 * This domain's Domain Score, for the gauge on the headline strip.
 *
 * Deliberately not part of the Labs overview call: the score comes from the
 * backlinks index, which is a different provider endpoint with a different
 * price, so it is a separate purchase and carries its own cost chip.
 */
export function useDomainScore(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
  cacheMode: CacheMode = "auto",
) {
  return useQuery(domainScoreQueryOptions(workspaceId, search, enabled, cacheMode));
}

export function useDomainOverview(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
  cacheMode: CacheMode = "auto",
) {
  return useQuery({
    queryKey: domainKeys.overview(workspaceId, search),
    queryFn: () =>
      api.get<DomainOverviewResponse>(
        `/domains/overview?${marketParams(workspaceId ?? "", search, cacheMode)}`,
      ),
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

export function useDomainHistory(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
  cacheMode: CacheMode = "auto",
) {
  return useQuery({
    queryKey: domainKeys.history(workspaceId, search),
    queryFn: () =>
      api.get<DomainHistoryResponse>(
        `/domains/history?${marketParams(workspaceId ?? "", search, cacheMode)}`,
      ),
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

/**
 * Top keywords.
 *
 * `paid` is part of the query key because it is part of the *query*: it changes
 * `item_types` upstream rather than filtering a shared result set, so the
 * organic and paid views are two different purchases. Same for the filters —
 * DataForSEO applies them server-side, so narrowing a range is a new call, not
 * a client-side sift over rows already paid for.
 */
export function useDomainKeywords(
  workspaceId: string | null,
  search: DomainSearch,
  options: {
    paid: boolean;
    filters: KeywordFilters;
    enabled: boolean;
    cacheMode?: CacheMode;
  },
) {
  return useInfiniteQuery({
    queryKey: domainKeys.keywords(
      workspaceId,
      search,
      options.paid,
      options.filters,
    ),
    queryFn: ({ pageParam }) => {
      const params = withFilters(
        marketParams(workspaceId ?? "", search, options.cacheMode ?? "auto"),
        options.filters,
      );
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      if (options.paid) params.set("paid", "true");
      return api.get<DomainKeywordsResponse>(`/domains/keywords?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled: options.enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

export function useDomainPages(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
  cacheMode: CacheMode = "auto",
) {
  return useInfiniteQuery({
    queryKey: domainKeys.pages(workspaceId, search),
    queryFn: ({ pageParam }) => {
      const params = marketParams(workspaceId ?? "", search, cacheMode);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      return api.get<DomainPagesResponse>(`/domains/pages?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

export function useDomainCompetitors(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
  cacheMode: CacheMode = "auto",
) {
  return useInfiniteQuery({
    queryKey: domainKeys.competitors(workspaceId, search),
    queryFn: ({ pageParam }) => {
      const params = marketParams(workspaceId ?? "", search, cacheMode);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      return api.get<DomainCompetitorsResponse>(`/domains/competitors?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

/**
 * The country breakdown: ~10 upstream calls in one request, hence `enabled`
 * being driven by a button rather than by mounting. There is no `location`
 * param — the market list is the point of the endpoint.
 */
export function useDomainCountries(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
  cacheMode: CacheMode = "auto",
) {
  return useQuery({
    queryKey: domainKeys.countries(workspaceId, search),
    queryFn: () => {
      const params = withCacheMode(
        new URLSearchParams({
          workspace: workspaceId ?? "",
          domain: search.target,
          language: search.language,
        }),
        cacheMode,
      );
      return api.get<DomainCountriesResponse>(`/domains/countries?${params}`);
    },
    enabled: enabled && workspaceId !== null,
    // A ten-call breakdown should not quietly re-run in the background.
    staleTime: 30 * 60_000,
    ...NO_RETRY,
  });
}

/* -------------------------------- refresh ---------------------------------- */

/**
 * What the Refresh button must re-buy: the headline block, plus the tab the
 * user is actually looking at.
 *
 * The keywords tab carries `paid` and its filters because they are part of its
 * query key — refreshing "organic, min volume 100" must overwrite that entry,
 * not the unfiltered one sitting beside it in the cache.
 */
export type RefreshTarget =
  | { tab: "keywords"; paid: boolean; filters: KeywordFilters }
  | { tab: Exclude<DomainTabId, "keywords"> };

/**
 * One deliberate, billed pass over what is on screen.
 *
 * A mutation rather than `refetch()`, for the reason `useRefreshSerp` is one in
 * the keywords module: `refetch` would re-run the query function, which does
 * *not* set `fresh=true` — it would hand back the same cached bytes and look
 * like a Refresh that did nothing. So this fetches with `fresh=true` and writes
 * the answer into the existing cache entries with `setQueryData`.
 *
 * **A tab that has never loaded is not refreshed.** Refresh renews what you are
 * looking at; fetching a panel the user has not opened would spend on data they
 * have not seen — and on the Countries tab that is ten upstream calls they
 * never consented to.
 *
 * A plain function taking the client, rather than the mutation's closure, so
 * the pass can be run once in a test and counted: "the Domain Score is bought
 * exactly once per Refresh, and nowhere else" is a claim about money, and the
 * only way to check it is to watch the calls.
 */
export async function refreshDomainReport(
  queryClient: QueryClient,
  workspaceId: string | null,
  search: DomainSearch,
  target: RefreshTarget,
): Promise<DomainOverviewResponse> {
  const fresh = () => domainFreshParams(workspaceId ?? "", search);

  /** Refetch one page-one and overwrite the infinite query, if it exists. */
  const refreshInfinite = async <T>(
    key: readonly unknown[],
    request: () => Promise<T>,
  ): Promise<void> => {
    if (queryClient.getQueryData(key) === undefined) return;
    const page = await request();
    queryClient.setQueryData(key, { pages: [page], pageParams: [0] });
  };

  const refreshSingle = async <T>(
    key: readonly unknown[],
    request: () => Promise<T>,
  ): Promise<void> => {
    if (queryClient.getQueryData(key) === undefined) return;
    queryClient.setQueryData(key, await request());
  };

  // The headline block always refreshes: it is the thing the chip beside
  // the button is describing.
  const overview = await api.get<DomainOverviewResponse>(
    `/domains/overview?${fresh()}`,
  );
  queryClient.setQueryData(domainKeys.overview(workspaceId, search), overview);
  await refreshSingle(domainKeys.history(workspaceId, search), () =>
    api.get<DomainHistoryResponse>(`/domains/history?${fresh()}`),
  );

  /*
   * The gauge is part of the headline block, so it refreshes with it and is not
   * gated on an existing cache entry the way the tabs are: the card is on
   * screen whenever this button is, and a score that failed to load the first
   * time is exactly the one a user presses Refresh to get.
   */
  if (search.target !== "") {
    queryClient.setQueryData(
      domainKeys.score(workspaceId, search),
      await api.post<BacklinksScoresResponse>(
        "/backlinks/scores",
        domainScoreFreshBody(workspaceId ?? "", search),
      ),
    );
  }

  const paged = (extra?: (params: URLSearchParams) => void) => {
    const params = fresh();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", "0");
    extra?.(params);
    return params;
  };

  switch (target.tab) {
    case "keywords":
      await refreshInfinite(
        domainKeys.keywords(workspaceId, search, target.paid, target.filters),
        () =>
          api.get<DomainKeywordsResponse>(
            `/domains/keywords?${paged((params) => {
              withFilters(params, target.filters);
              if (target.paid) params.set("paid", "true");
            })}`,
          ),
      );
      break;
    case "pages":
      await refreshInfinite(domainKeys.pages(workspaceId, search), () =>
        api.get<DomainPagesResponse>(`/domains/pages?${paged()}`),
      );
      break;
    case "competitors":
      await refreshInfinite(domainKeys.competitors(workspaceId, search), () =>
        api.get<DomainCompetitorsResponse>(`/domains/competitors?${paged()}`),
      );
      break;
    case "countries":
      await refreshSingle(domainKeys.countries(workspaceId, search), () => {
        const params = new URLSearchParams({
          workspace: workspaceId ?? "",
          domain: search.target,
          language: search.language,
          fresh: "true",
        });
        return api.get<DomainCountriesResponse>(`/domains/countries?${params}`);
      });
      break;
  }

  return overview;
}

export function useRefreshDomain(
  workspaceId: string | null,
  search: DomainSearch,
) {
  const queryClient = useQueryClient();

  return useMutation({
    // Same reasoning as the queries: a failed billed call is not retried for you.
    retry: false,
    mutationFn: (target: RefreshTarget) =>
      refreshDomainReport(queryClient, workspaceId, search, target),
  });
}
