/**
 * TanStack Query bindings for `/api/v1/gap/*`.
 *
 * The same two rules as the other research modules, for the same reason — every
 * call here spends the workspace's DataForSEO credits, and this module spends
 * the most per request because the Worker runs one upstream call *per
 * competitor* (two in `all` mode):
 *
 * 1. **No automatic retries.** A 502 may already have been billed, and a
 *    409/402 will never succeed on a second attempt.
 * 2. **Nothing fetches until it is asked for.** The query is `enabled` only for
 *    a target with at least one competitor.
 *
 * **Cache mode is a request parameter, never a query key.** Re-opening a
 * comparison from the search trail asks the Worker for its cached copy even
 * past the soft TTL (`stale=true`, $0, no upstream call); Refresh asks it to
 * bypass the cache and bill (`fresh=true`). Both describe *this fetch*, not
 * *this result*, so neither belongs in a key — putting one there would fork the
 * client cache into two copies of the same comparison.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import type { GapKeywordsResponse, GapPagesResponse } from "../../../shared/gap";
import { api } from "../../lib/api";
import type { GapFilters } from "./gap-filters";
import type { GapSearch } from "./url-state";

/**
 * Rows per "Load more". The Worker caps `limit` at 200; 50 keeps a mis-click
 * cheap when the press behind it is several upstream calls.
 */
export const PAGE_SIZE = 50;

/** The Worker's cap on a server-side CSV export (`GAP_CSV_MAX_ROWS`). */
export const GAP_CSV_MAX_ROWS = 1000;

/** See the file header: money-spending queries never retry themselves. */
const NO_RETRY = { retry: false } as const;

/** DataForSEO data moves slowly; an hour of client cache is conservative. */
const RESULT_STALE_TIME = 60 * 60_000;

/**
 * How this fetch may use the server-side cache.
 *
 * `auto` is the ordinary path; `stale` accepts an expired copy rather than
 * spending, which is what makes a click in the search trail free. Bypassing the
 * cache is not a member here — that is a mutation, not a mode a mounting query
 * can fall into.
 */
export type CacheMode = "auto" | "stale";

/**
 * Everything both the JSON route and the CSV export take, so a spreadsheet is
 * always the same query as the table it was exported from.
 *
 * The export deliberately never passes a cache mode: a CSV is a fresh
 * server-side render of the comparison, not a re-read of what is on screen.
 */
export function gapQueryParams(
  workspaceId: string | null,
  search: GapSearch,
  filters: GapFilters,
  cacheMode: CacheMode = "auto",
): URLSearchParams {
  const params = new URLSearchParams({
    workspace: workspaceId ?? "",
    target: search.target,
    competitors: search.competitors.join(","),
    location: String(search.location),
    language: search.language,
    mode: search.mode,
  });

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || Number.isNaN(value)) continue;
    params.set(key, String(value));
  }

  if (cacheMode === "stale") params.set("stale", "true");

  return params;
}

/**
 * The same comparison, told to bypass the cache and bill.
 *
 * The only builder here that sets `fresh`, and it is reachable only from
 * `useRefreshGap` — which is reachable only from a button press. Never carries
 * `stale`: the pair is a 422 by contract.
 */
export function gapFreshParams(
  workspaceId: string | null,
  search: GapSearch,
  filters: GapFilters,
): URLSearchParams {
  const params = gapQueryParams(workspaceId, search, filters);
  params.set("fresh", "true");
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", "0");
  return params;
}

/** The gap table's key. Cache mode is absent by design — see the file header. */
export function gapKeywordsKey(
  workspaceId: string | null,
  search: GapSearch,
  filters: GapFilters,
) {
  return [
    "gap",
    "keywords",
    workspaceId,
    search.target,
    search.competitors.join(","),
    search.location,
    search.language,
    search.mode,
    filters,
  ] as const;
}

/**
 * The offset of the next page, or undefined when there is nothing more to buy.
 *
 * **Paging runs against the *unfiltered* set.** The Worker fetches `limit` rows
 * and then drops the ones the mode excludes, so the rows this page consumed are
 * `items.length + filteredOut` — advancing by `items.length` alone would
 * re-request and re-pay for the rows that were just filtered out, and would
 * make a page that filtered everything out loop forever on the same offset.
 */
export function nextGapOffset(page: {
  items: ReadonlyArray<unknown>;
  filteredOut: number;
  offset: number;
  limit: number;
  totalCount: number | null;
}): number | undefined {
  const fetched = page.items.length + page.filteredOut;
  // Nothing came back at all: upstream is out of rows.
  if (fetched === 0) return undefined;
  // A short page is the end of the result set, however much of it survived.
  if (fetched < page.limit) return undefined;

  const loaded = page.offset + fetched;
  if (page.totalCount !== null && loaded >= page.totalCount) return undefined;
  return loaded;
}

/**
 * The gap table.
 *
 * `mode` is part of the query key because it is part of the request: the Worker
 * needs a different upstream query for `weak` than for `missing`, and `all`
 * needs both. What it is *not* is a client-side filter over one fetched set —
 * so switching tabs re-asks, and hits the server cache whenever the underlying
 * upstream query is one this workspace has already paid for.
 */
export function useGapKeywords(
  workspaceId: string | null,
  search: GapSearch,
  filters: GapFilters,
  enabled: boolean,
  cacheMode: CacheMode = "auto",
) {
  return useInfiniteQuery({
    queryKey: gapKeywordsKey(workspaceId, search, filters),
    queryFn: ({ pageParam }) => {
      const params = gapQueryParams(workspaceId, search, filters, cacheMode);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      return api.get<GapKeywordsResponse>(`/gap/keywords?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: nextGapOffset,
    enabled: enabled && workspaceId !== null,
    staleTime: RESULT_STALE_TIME,
    ...NO_RETRY,
  });
}

/**
 * The pages view: which keywords a set of URLs rank for together.
 *
 * A different endpoint from `/gap/keywords`, and a cheaper one — `page_intersection`
 * compares the whole set in one call rather than one call per competitor, so
 * this view's "Load more" is a single request however many URLs are in it.
 *
 * `filteredOut` has no counterpart here: there is no mode, so nothing is
 * fetched and then dropped, and paging can advance by `items.length` the
 * ordinary way.
 */
export function useGapPages(
  workspaceId: string | null,
  search: GapSearch,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: [
      "gap",
      "pages",
      workspaceId,
      search.pages.join(","),
      search.location,
      search.language,
    ],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        workspace: workspaceId ?? "",
        pages: search.pages.join(","),
        location: String(search.location),
        language: search.language,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      return api.get<GapPagesResponse>(`/gap/pages?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: (page) => {
      if (page.items.length === 0) return undefined;
      if (page.items.length < page.limit) return undefined;
      const loaded = page.offset + page.items.length;
      if (page.totalCount !== null && loaded >= page.totalCount) return undefined;
      return loaded;
    },
    enabled: enabled && workspaceId !== null,
    staleTime: RESULT_STALE_TIME,
    ...NO_RETRY,
  });
}

/**
 * One deliberate, billed re-run of the comparison.
 *
 * A mutation rather than `refetch()`, for the reason the keywords module's
 * `useRefreshSerp` is one: `refetch` re-runs the query function, which does not
 * set `fresh=true` — it would hand back the same cached bytes and look like a
 * Refresh that did nothing. So this fetches page one with `fresh=true` and
 * writes it into the existing infinite-query entry.
 *
 * **One page, not every page loaded.** A comparison is one upstream call per
 * competitor *per page*; silently re-buying five pages because the user had
 * paged that far would turn one click into five times the bill they expected.
 * The pager is still there for the rest.
 */
export function useRefreshGap(
  workspaceId: string | null,
  search: GapSearch,
  filters: GapFilters,
) {
  const queryClient = useQueryClient();

  return useMutation({
    // Same reasoning as the query: a failed billed call is not retried for you.
    retry: false,
    mutationFn: () =>
      api.get<GapKeywordsResponse>(
        `/gap/keywords?${gapFreshParams(workspaceId, search, filters)}`,
      ),
    onSuccess: (page) => {
      queryClient.setQueryData(gapKeywordsKey(workspaceId, search, filters), {
        pages: [page],
        pageParams: [0],
      });
    },
  });
}

/**
 * The server-rendered CSV for the current query.
 *
 * A plain same-origin link rather than a fetch + blob: the session cookie rides
 * along, the browser names the file from `content-disposition`, and a thousand
 * rows never have to be held in memory. It is also the only export here that
 * covers rows the table has not loaded — hence the row cap in its tooltip.
 */
export function gapExportUrl(
  workspaceId: string | null,
  search: GapSearch,
  filters: GapFilters,
): string {
  return `/api/v1/gap/keywords/export.csv?${gapQueryParams(
    workspaceId,
    search,
    filters,
  )}`;
}
