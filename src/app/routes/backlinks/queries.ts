/**
 * TanStack Query bindings for `/api/v1/backlinks/*`.
 *
 * The two rules from Domain Overview's `queries.ts` carry over unchanged,
 * because the reason for them is the same — every call here spends the
 * workspace's own DataForSEO credits:
 *
 * 1. **No automatic retries.** The app-wide default retries once, which is right
 *    for a free read and wrong here: a 502 may already have been billed, and a
 *    409/402 will never succeed on a second attempt. Failures surface with a
 *    Retry the user chooses to press.
 * 2. **Nothing fetches until it is asked for.** Queries are `enabled` only for a
 *    searchable target, and tab panels mount lazily, so switching to Anchors is
 *    what buys the anchors.
 *
 * No `location` or `language` appears anywhere in this file. The Backlinks API
 * has no market: none of these endpoints accepts a location code, so none is in
 * the query keys either.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import type {
  AnchorsResponse,
  BacklinkSort,
  BacklinksHistoryResponse,
  BacklinksListMode,
  BacklinksListResponse,
  BacklinksSummaryResponse,
  ReferringDomainsResponse,
} from "../../../shared/backlinks";
import { BACKLINKS_HISTORY_MIN_DATE } from "../../../shared/backlinks";
import { api } from "../../lib/api";
import type { LinkFilters } from "./link-filters";

/**
 * Rows per "Load more". The Worker caps `limit` at 200 and defaults to 50;
 * 50 is a screenful and change, and keeps a mis-click cheap.
 */
export const PAGE_SIZE = 50;

/** See the file header: money-spending queries never retry themselves. */
const NO_RETRY = { retry: false } as const;

function targetParams(workspaceId: string, target: string): URLSearchParams {
  return new URLSearchParams({ workspace: workspaceId, target });
}

function pageParams(
  workspaceId: string,
  target: string,
  offset: number,
): URLSearchParams {
  const params = targetParams(workspaceId, target);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  return params;
}

/**
 * Offset of the next page, or undefined when we have everything.
 *
 * Three stop conditions, because the upstream is not consistent about which one
 * it gives us: an empty page, a short page, or a `totalCount` we have already
 * reached. Any of them means one more call would buy nothing.
 *
 * **`totalCount` is not a reliable stop on its own** for referring domains —
 * the Backlinks API counts main domains there while returning rows per
 * subdomain, so `loaded` legitimately overshoots it. That is why the short-page
 * check comes first and the count check only ever *ends* paging early, never
 * extends it.
 */
function nextOffset(page: {
  items: ReadonlyArray<unknown>;
  offset: number;
  limit: number;
  totalCount: number | null;
}): number | undefined {
  if (page.items.length === 0) return undefined;
  if (page.items.length < page.limit) return undefined;
  return page.offset + page.items.length;
}

export function useBacklinksSummary(
  workspaceId: string | null,
  target: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["backlinks", "summary", workspaceId, target],
    queryFn: () =>
      api.get<BacklinksSummaryResponse>(
        `/backlinks/summary?${targetParams(workspaceId ?? "", target)}`,
      ),
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

/**
 * The whole monthly series, always.
 *
 * `from` is pinned to the provider's index start rather than to the picker's
 * range: one purchase covers every range the picker offers, and the picker
 * slices it locally (see history-range.ts). `to` is left off so the Worker's
 * clamp — DataForSEO rejects a `date_to` of today — never has to fire.
 */
export function useBacklinksHistory(
  workspaceId: string | null,
  target: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["backlinks", "history", workspaceId, target],
    queryFn: () => {
      const params = targetParams(workspaceId ?? "", target);
      params.set("from", BACKLINKS_HISTORY_MIN_DATE);
      return api.get<BacklinksHistoryResponse>(`/backlinks/history?${params}`);
    },
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

/**
 * Everything the backlinks list takes, as one URL.
 *
 * Exported because every one of these is a *server-side* narrowing — the
 * provider applies the sort as its `order_by` and the filters as its own
 * conditions — so what lands in this query string is what the workspace pays
 * for. Asserting on it is how the "changing sort is a fresh query, not a
 * client-side reshuffle" contract stays honest.
 */
export function backlinksListParams(
  workspaceId: string | null,
  target: string,
  options: {
    mode: BacklinksListMode;
    filters: LinkFilters;
    sort: BacklinkSort;
    offset?: number;
  },
): URLSearchParams {
  const params = pageParams(workspaceId ?? "", target, options.offset ?? 0);
  params.set("mode", options.mode);
  params.set("sort", options.sort);
  if (options.filters.dofollow === true) params.set("dofollow", "true");
  if (options.filters.minDomainScore !== undefined) {
    params.set("minDomainScore", String(options.filters.minDomainScore));
  }
  if (options.filters.anchor !== undefined) {
    params.set("anchor", options.filters.anchor);
  }
  if (options.filters.maxSpamScore !== undefined) {
    params.set("maxSpamScore", String(options.filters.maxSpamScore));
  }
  return params;
}

/**
 * The Backlinks tab.
 *
 * `mode`, `sort` and the filters are all in the key because they are all part
 * of the *query*: `one_per_domain` groups upstream, the sort is the provider's
 * `order_by`, and the filters are applied by DataForSEO. Each combination is a
 * different purchase rather than a different view of rows already bought — so
 * the cache must keep them apart, and the UI has to say so.
 */
export function useBacklinksList(
  workspaceId: string | null,
  target: string,
  options: {
    mode: BacklinksListMode;
    filters: LinkFilters;
    sort: BacklinkSort;
    enabled: boolean;
  },
) {
  return useInfiniteQuery({
    queryKey: [
      "backlinks",
      "list",
      workspaceId,
      target,
      options.mode,
      options.sort,
      options.filters,
    ],
    queryFn: ({ pageParam }) =>
      api.get<BacklinksListResponse>(
        `/backlinks/list?${backlinksListParams(workspaceId, target, {
          mode: options.mode,
          filters: options.filters,
          sort: options.sort,
          offset: pageParam,
        })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled: options.enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

export function useReferringDomains(
  workspaceId: string | null,
  target: string,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["backlinks", "referring", workspaceId, target],
    queryFn: ({ pageParam }) =>
      api.get<ReferringDomainsResponse>(
        `/backlinks/referring-domains?${pageParams(
          workspaceId ?? "",
          target,
          pageParam,
        )}`,
      ),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}

export function useAnchors(
  workspaceId: string | null,
  target: string,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["backlinks", "anchors", workspaceId, target],
    queryFn: ({ pageParam }) =>
      api.get<AnchorsResponse>(
        `/backlinks/anchors?${pageParams(workspaceId ?? "", target, pageParam)}`,
      ),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    enabled: enabled && workspaceId !== null,
    ...NO_RETRY,
  });
}
