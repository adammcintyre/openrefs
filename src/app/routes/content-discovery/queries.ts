/**
 * TanStack Query bindings for `/api/v1/content/*`.
 *
 * The two rules the other research modules follow carry over, for the same
 * reason — these calls spend the workspace's own DataForSEO credits:
 *
 * 1. **No automatic retries.** A 502 may already have been billed, and a
 *    409/402 will never succeed on a second attempt.
 * 2. **Nothing fetches until it is asked for.** The query is `enabled` only for
 *    a non-empty topic.
 *
 * What is different here is the *shape* of the spending, and it drives the
 * query keys. A discover request buys a composition keyed by (topic, market,
 * expansion) and then filters, sorts and pages over it for free. So the key
 * carries the filters and the sort — they are genuinely different requests —
 * but a change to any of them hits the Worker's composed-set cache rather than
 * DataForSEO. Only the first four fields can cost money.
 */
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";

import type {
  ContentDiscoverResponse,
  ContentWordCountResponse,
} from "../../../shared/content";
import { CONTENT_WORDCOUNT_MAX_URLS } from "../../../shared/content";
import { api } from "../../lib/api";
import type { ContentSearch } from "./url-state";

/**
 * Rows per "Load more". The Worker caps `limit` at `CONTENT_MAX_ROWS` (200) and
 * defaults to 50; 50 is a screenful and change, and every page after the first
 * is free anyway — it comes out of the composed set, not out of DataForSEO.
 */
export const PAGE_SIZE = 50;

/** See the file header: money-spending queries never retry themselves. */
const NO_RETRY = { retry: false } as const;

/** A composed set lives 24h in the Worker's cache; an hour here is conservative. */
const RESULT_STALE_TIME = 60 * 60_000;

/** Everything the discover route takes, minus the paging window. */
export function discoverQueryParams(
  workspaceId: string | null,
  search: ContentSearch,
): URLSearchParams {
  const params = new URLSearchParams({
    workspace: workspaceId ?? "",
    topic: search.topic.trim(),
    location: String(search.location),
    language: search.language,
    expand: String(search.expand),
    sort: search.sort,
  });

  for (const [key, value] of Object.entries(search.filters)) {
    if (value === undefined || value === "" || Number.isNaN(value)) continue;
    params.set(key, String(value));
  }

  return params;
}

/**
 * The offset of the next page, or undefined when there is nothing more.
 *
 * Paging runs over the **filtered** set, which is `totalCount - filteredOut`
 * rows: `totalCount` counts the composition before any filter and would keep
 * the button alive long after the last matching row had been shown. The short-
 * page check comes first because it is the one condition that is always true at
 * the end, whatever the counts say.
 */
export function nextContentOffset(page: {
  items: ReadonlyArray<unknown>;
  offset: number;
  limit: number;
  totalCount: number;
  filteredOut: number;
}): number | undefined {
  if (page.items.length === 0) return undefined;
  if (page.items.length < page.limit) return undefined;

  const loaded = page.offset + page.items.length;
  const matching = Math.max(0, page.totalCount - page.filteredOut);
  if (loaded >= matching) return undefined;
  return loaded;
}

/**
 * The results table.
 *
 * `fresh` is deliberately absent: there is no Refresh button on this screen.
 * Rebuilding a composition means re-buying every SERP under it, which for
 * `expand=10` is eleven live SERPs — too expensive to sit behind a button
 * someone might press to see whether anything changed. A new sweep is a new
 * topic or a new expansion, both of which are explicit.
 */
export function useContentDiscover(
  workspaceId: string | null,
  search: ContentSearch,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: [
      "content",
      "discover",
      workspaceId,
      search.topic.trim().toLowerCase(),
      search.location,
      search.language,
      search.expand,
      search.sort,
      search.filters,
    ],
    queryFn: ({ pageParam }) => {
      const params = discoverQueryParams(workspaceId, search);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      return api.get<ContentDiscoverResponse>(`/content/discover?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: nextContentOffset,
    enabled: enabled && workspaceId !== null,
    staleTime: RESULT_STALE_TIME,
    ...NO_RETRY,
  });
}

/**
 * Counting words for the selected rows.
 *
 * A mutation rather than a query because it is a purchase the user asks for by
 * name: `content_parsing` is priced per URL and fetches the live page, so it
 * cannot be something a table does on its own behalf while nobody is looking.
 * The cap is the Worker's (`CONTENT_WORDCOUNT_MAX_URLS`); slicing here as well
 * means a selection larger than the cap sends the first ten rather than 422ing
 * on the whole batch.
 */
export function useContentWordCount(workspaceId: string | null) {
  return useMutation({
    mutationFn: (urls: string[]) =>
      api.post<ContentWordCountResponse>(
        `/content/wordcount?workspace=${encodeURIComponent(workspaceId ?? "")}`,
        { urls: urls.slice(0, CONTENT_WORDCOUNT_MAX_URLS) },
      ),
    ...NO_RETRY,
  });
}
