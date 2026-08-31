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
 */
import { useInfiniteQuery } from "@tanstack/react-query";

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
 * Everything both the JSON route and the CSV export take, so a spreadsheet is
 * always the same query as the table it was exported from.
 */
export function gapQueryParams(
  workspaceId: string | null,
  search: GapSearch,
  filters: GapFilters,
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

  return params;
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
) {
  return useInfiniteQuery({
    queryKey: [
      "gap",
      "keywords",
      workspaceId,
      search.target,
      search.competitors.join(","),
      search.location,
      search.language,
      search.mode,
      filters,
    ],
    queryFn: ({ pageParam }) => {
      const params = gapQueryParams(workspaceId, search, filters);
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
