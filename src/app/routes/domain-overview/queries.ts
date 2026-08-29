/**
 * TanStack Query bindings for `/api/v1/domains/*`.
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
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

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
import type { DomainSearch } from "./url-state";

/**
 * Rows per "Load more". The Worker caps `limit` at 200 and defaults to 50;
 * 50 is a screenful and change, and keeps a mis-click cheap.
 */
export const PAGE_SIZE = 50;

function marketParams(workspaceId: string, search: DomainSearch): URLSearchParams {
  return new URLSearchParams({
    workspace: workspaceId,
    domain: search.target,
    location: String(search.location),
    language: search.language,
  });
}

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

export function useDomainOverview(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "domains",
      "overview",
      workspaceId,
      search.target,
      search.location,
      search.language,
    ],
    queryFn: () =>
      api.get<DomainOverviewResponse>(
        `/domains/overview?${marketParams(workspaceId ?? "", search)}`,
      ),
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

export function useDomainHistory(
  workspaceId: string | null,
  search: DomainSearch,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "domains",
      "history",
      workspaceId,
      search.target,
      search.location,
      search.language,
    ],
    queryFn: () =>
      api.get<DomainHistoryResponse>(
        `/domains/history?${marketParams(workspaceId ?? "", search)}`,
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
  options: { paid: boolean; filters: KeywordFilters; enabled: boolean },
) {
  return useInfiniteQuery({
    queryKey: [
      "domains",
      "keywords",
      workspaceId,
      search.target,
      search.location,
      search.language,
      options.paid,
      options.filters,
    ],
    queryFn: ({ pageParam }) => {
      const params = withFilters(
        marketParams(workspaceId ?? "", search),
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
) {
  return useInfiniteQuery({
    queryKey: [
      "domains",
      "pages",
      workspaceId,
      search.target,
      search.location,
      search.language,
    ],
    queryFn: ({ pageParam }) => {
      const params = marketParams(workspaceId ?? "", search);
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
) {
  return useInfiniteQuery({
    queryKey: [
      "domains",
      "competitors",
      workspaceId,
      search.target,
      search.location,
      search.language,
    ],
    queryFn: ({ pageParam }) => {
      const params = marketParams(workspaceId ?? "", search);
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
) {
  return useQuery({
    queryKey: [
      "domains",
      "countries",
      workspaceId,
      search.target,
      search.language,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        workspace: workspaceId ?? "",
        domain: search.target,
        language: search.language,
      });
      return api.get<DomainCountriesResponse>(`/domains/countries?${params}`);
    },
    enabled: enabled && workspaceId !== null,
    // A ten-call breakdown should not quietly re-run in the background.
    staleTime: 30 * 60_000,
    ...NO_RETRY,
  });
}
