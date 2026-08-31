/**
 * TanStack Query hooks for the Keyword Research module.
 *
 * Two rules run through this file, both about money:
 *
 * 1. **Paid queries never auto-retry.** The global default retries once, which
 *    is right for a cheap JSON read and wrong for a DataForSEO call: a request
 *    that timed out upstream may well have been billed, and retrying it bills
 *    it again. Every keyword hook opts out.
 * 2. **Nothing refetches on its own.** Results are cached server-side for days
 *    (see the TTL table in docs/ARCHITECTURE.md), so a long `staleTime` costs
 *    the user nothing in freshness and saves them round trips. Spending is
 *    something the user asks for — a search, "Load more", or Refresh.
 *
 * Phase 9 adds a third, which is really the first two applied to the cache
 * controls themselves:
 *
 * 3. **`cacheMode` is a `queryFn` argument, never part of a query key.** A tab
 *    reopened from the search history asks for `stale=true` (serve the stored
 *    copy however old it is — $0, no upstream call), and returns to `"auto"`
 *    once the user refreshes. If the mode were keyed, that transition would
 *    mint a second cache entry for the same search and TanStack would fetch it,
 *    turning a mode change into a bill. Keyed on the search alone, the mode only
 *    colours fetches that were going to happen anyway.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type {
  CollectionDeletedResponse,
  CollectionDetailResponse,
  CollectionKeywordsAddedResponse,
  CollectionKeywordsRemovedResponse,
  CollectionListResponse,
  CollectionMutationResponse,
} from "../../../shared/collections";
import type {
  KeywordListResponse,
  KeywordOverviewResponse,
  KeywordSerpResponse,
  MetaLocationsResponse,
} from "../../../shared/keywords";
import { api } from "../../lib/api";
import type { KeywordCacheMode } from "../../routes/keyword-research/research-tabs";
import type { KeywordTabId } from "../../routes/keyword-research/search-params";
import type { MarketSelection } from "./market";

/** Rows per page. The Worker's own default; "Load more" adds another page. */
export const PAGE_SIZE = 50;

/** DataForSEO data moves slowly; an hour of client cache is conservative. */
const RESULT_STALE_TIME = 60 * 60_000;

/** The locations list is a $0 reference table, cached 30d server-side. */
const META_STALE_TIME = 24 * 60 * 60_000;

/** Shared by every paid hook. See rule 1 above. */
const PAID_QUERY_OPTIONS = {
  retry: false,
  staleTime: RESULT_STALE_TIME,
} as const;

/* --------------------------------- keys ----------------------------------- */

export const keywordKeys = {
  all: ["keywords"] as const,
  meta: (workspaceId: string) => ["keywords", "meta", workspaceId] as const,
  overview: (workspaceId: string, keyword: string, market: MarketSelection) =>
    ["keywords", "overview", workspaceId, keyword, market.locationCode, market.languageCode] as const,
  list: (
    workspaceId: string,
    tab: KeywordTabId,
    keyword: string,
    market: MarketSelection,
  ) =>
    ["keywords", "list", workspaceId, tab, keyword, market.locationCode, market.languageCode] as const,
  serp: (workspaceId: string, keyword: string, market: MarketSelection) =>
    ["keywords", "serp", workspaceId, keyword, market.locationCode, market.languageCode] as const,
};

export const collectionKeys = {
  all: ["collections"] as const,
  list: (workspaceId: string) => ["collections", "list", workspaceId] as const,
  detail: (workspaceId: string, id: string) =>
    ["collections", "detail", workspaceId, id] as const,
};

/* ------------------------------ query strings ------------------------------ */

/**
 * Builds a query string from parts, dropping anything undefined.
 *
 * URLSearchParams does the escaping, which matters more than it looks: a
 * keyword can legitimately contain `&`, `#` or `+`.
 */
function queryString(parts: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parts)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

/** The market half every keyword endpoint shares. */
function marketParams(
  workspaceId: string,
  keyword: string,
  market: MarketSelection,
) {
  return {
    workspace: workspaceId,
    keyword,
    location: market.locationCode,
    language: market.languageCode,
  };
}

/**
 * The cache half.
 *
 * `stale=true` is sent only for a mode that asked for it, and `fresh=true` never
 * appears here at all — the refresh mutations below are its only source, so
 * "did something bill?" is answerable by reading the call sites rather than by
 * tracing state. The Worker rejects the two together with a 422; keeping them in
 * separate code paths means we cannot send that pair by accident.
 */
function cacheParams(mode: KeywordCacheMode): { stale?: true } {
  return mode === "stale" ? { stale: true } : {};
}

/**
 * The server-rendered CSV export for a collection.
 *
 * A plain same-origin link rather than a fetch + blob: the session cookie
 * rides along, the browser names the file from `content-disposition`, and a
 * large export never has to be held in memory.
 */
export function collectionExportUrl(workspaceId: string, id: string): string {
  return `/api/v1/collections/${encodeURIComponent(id)}/export.csv?${queryString({
    workspace: workspaceId,
  })}`;
}

/* -------------------------------- metadata --------------------------------- */

/**
 * The selectable markets, each carrying the languages valid for it.
 *
 * Country-level Labs codes, not the ~100k-entry SERP list — see the note in
 * the Worker's routes/meta.ts for why that distinction is a correctness one.
 */
export function useMetaLocations(workspaceId: string | null) {
  return useQuery({
    queryKey: keywordKeys.meta(workspaceId ?? ""),
    queryFn: () =>
      api.get<MetaLocationsResponse>(
        `/meta/locations?${queryString({ workspace: workspaceId ?? "", engine: "google" })}`,
      ),
    enabled: workspaceId !== null,
    staleTime: META_STALE_TIME,
    retry: false,
  });
}

/* -------------------------------- keywords --------------------------------- */

export function useKeywordOverview(
  workspaceId: string | null,
  keyword: string,
  market: MarketSelection,
  cacheMode: KeywordCacheMode = "auto",
) {
  return useQuery({
    queryKey: keywordKeys.overview(workspaceId ?? "", keyword, market),
    queryFn: () =>
      api.get<KeywordOverviewResponse>(
        `/keywords/overview?${queryString({
          ...marketParams(workspaceId ?? "", keyword, market),
          ...cacheParams(cacheMode),
        })}`,
      ),
    enabled: workspaceId !== null && keyword !== "",
    ...PAID_QUERY_OPTIONS,
  });
}

/**
 * One of ideas / suggestions / related, paged.
 *
 * `getNextPageParam` returns the next offset, or undefined to retire the
 * "Load more" button. It stops on an empty page as well as on the reported
 * total, because `totalCount` is upstream's estimate and has been known to
 * overstate what the endpoint will actually hand back.
 */
export function useKeywordList(
  workspaceId: string | null,
  tab: KeywordTabId,
  keyword: string,
  market: MarketSelection,
  cacheMode: KeywordCacheMode = "auto",
) {
  return useInfiniteQuery({
    queryKey: keywordKeys.list(workspaceId ?? "", tab, keyword, market),
    queryFn: ({ pageParam }) =>
      api.get<KeywordListResponse>(
        `/keywords/${tab}?${queryString({
          ...marketParams(workspaceId ?? "", keyword, market),
          limit: PAGE_SIZE,
          offset: pageParam,
          ...cacheParams(cacheMode),
        })}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.items.length === 0) return undefined;
      const loaded = lastPage.offset + lastPage.items.length;
      if (lastPage.totalCount !== null && loaded >= lastPage.totalCount) {
        return undefined;
      }
      return loaded;
    },
    enabled: workspaceId !== null && keyword !== "",
    ...PAID_QUERY_OPTIONS,
  });
}

/**
 * The SERP for one keyword.
 *
 * Deliberately split from the refresh below. This one runs on open and is
 * happy to be served from the server's 24h cache; `useRefreshSerp` is the only
 * path that sets `fresh=true`, so spending is always something the user
 * clicked rather than something a mount did.
 */
export function useSerp(
  workspaceId: string | null,
  keyword: string,
  market: MarketSelection,
  enabled: boolean,
) {
  return useQuery({
    queryKey: keywordKeys.serp(workspaceId ?? "", keyword, market),
    queryFn: () =>
      api.get<KeywordSerpResponse>(
        `/keywords/serp?${queryString(
          marketParams(workspaceId ?? "", keyword, market),
        )}`,
      ),
    enabled: enabled && workspaceId !== null && keyword !== "",
    ...PAID_QUERY_OPTIONS,
  });
}

/** Forces a live SERP read and writes the result into the query above. */
export function useRefreshSerp(
  workspaceId: string | null,
  keyword: string,
  market: MarketSelection,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.get<KeywordSerpResponse>(
        `/keywords/serp?${queryString({
          ...marketParams(workspaceId ?? "", keyword, market),
          fresh: true,
        })}`,
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(
        keywordKeys.serp(workspaceId ?? "", keyword, market),
        data,
      );
    },
  });
}

/**
 * What one Refresh press spent, so the UI can say so.
 *
 * Both halves are reported because they are two calls to two priced endpoints
 * and a single figure would hide which one is expensive.
 */
export interface KeywordRefreshResult {
  overview: KeywordOverviewResponse;
  list: KeywordListResponse;
  costUsd: number;
}

/**
 * Re-fetches the searched keyword live: the overview, plus the first page of
 * whichever list the user is looking at.
 *
 * The scope is the product decision. "Refresh" has to mean one predictable
 * charge, so it touches exactly the two things on screen — never the other two
 * tabs, never another research tab, and never page two of anything. Each of the
 * two requests carries `fresh=true` exactly once, which is the whole of the
 * module's spending surface outside an explicit search and "Load more".
 *
 * Results are written straight into the cache rather than invalidated, mirroring
 * `useRefreshSerp`: an invalidate would refetch what we have just paid for. The
 * infinite query is reset to a single page, because page two of the previous
 * fetch describes a ranking that has just moved underneath it.
 */
export function useRefreshKeywordSearch(
  workspaceId: string | null,
  keyword: string,
  market: MarketSelection,
  tab: KeywordTabId,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<KeywordRefreshResult> => {
      const shared = marketParams(workspaceId ?? "", keyword, market);
      const [overview, list] = await Promise.all([
        api.get<KeywordOverviewResponse>(
          `/keywords/overview?${queryString({ ...shared, fresh: true })}`,
        ),
        api.get<KeywordListResponse>(
          `/keywords/${tab}?${queryString({
            ...shared,
            limit: PAGE_SIZE,
            offset: 0,
            fresh: true,
          })}`,
        ),
      ]);
      return { overview, list, costUsd: overview.costUsd + list.costUsd };
    },
    onSuccess: ({ overview, list }) => {
      queryClient.setQueryData(
        keywordKeys.overview(workspaceId ?? "", keyword, market),
        overview,
      );
      queryClient.setQueryData(
        keywordKeys.list(workspaceId ?? "", tab, keyword, market),
        { pages: [list], pageParams: [0] },
      );
    },
  });
}

/* ------------------------------- collections ------------------------------- */

export function useCollections(workspaceId: string | null) {
  return useQuery({
    queryKey: collectionKeys.list(workspaceId ?? ""),
    queryFn: () =>
      api.get<CollectionListResponse>(
        `/collections?${queryString({ workspace: workspaceId ?? "" })}`,
      ),
    enabled: workspaceId !== null,
  });
}

export function useCollection(workspaceId: string | null, id: string | null) {
  return useQuery({
    queryKey: collectionKeys.detail(workspaceId ?? "", id ?? ""),
    queryFn: () =>
      api.get<CollectionDetailResponse>(
        `/collections/${encodeURIComponent(id ?? "")}?${queryString({
          workspace: workspaceId ?? "",
        })}`,
      ),
    enabled: workspaceId !== null && id !== null,
  });
}

/**
 * Every collection mutation invalidates the list (counts change) and, when it
 * targets one collection, that collection's detail.
 */
function useCollectionMutation<TArgs, TResult>(
  workspaceId: string | null,
  mutationFn: (args: TArgs) => Promise<TResult>,
  collectionId?: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: collectionKeys.list(workspaceId ?? ""),
      });
      if (collectionId !== undefined && collectionId !== null) {
        void queryClient.invalidateQueries({
          queryKey: collectionKeys.detail(workspaceId ?? "", collectionId),
        });
      }
    },
  });
}

export function useCreateCollection(workspaceId: string | null) {
  return useCollectionMutation(workspaceId, (name: string) =>
    api.post<CollectionMutationResponse>(
      `/collections?${queryString({ workspace: workspaceId ?? "" })}`,
      { name },
    ),
  );
}

export function useRenameCollection(
  workspaceId: string | null,
  collectionId: string | null,
) {
  return useCollectionMutation(
    workspaceId,
    (name: string) =>
      api.patch<CollectionMutationResponse>(
        `/collections/${encodeURIComponent(collectionId ?? "")}?${queryString({
          workspace: workspaceId ?? "",
        })}`,
        { name },
      ),
    collectionId,
  );
}

export function useDeleteCollection(workspaceId: string | null) {
  return useCollectionMutation(workspaceId, (collectionId: string) =>
    api.del<CollectionDeletedResponse>(
      `/collections/${encodeURIComponent(collectionId)}?${queryString({
        workspace: workspaceId ?? "",
      })}`,
    ),
  );
}

/** One entry in a bulk add — the snapshot is what makes a list comparable. */
export interface KeywordToAdd {
  keyword: string;
  volumeSnapshot?: number | null;
}

export function useAddKeywords(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      collectionId,
      keywords,
      market,
    }: {
      collectionId: string;
      keywords: KeywordToAdd[];
      /**
       * The market the keywords were researched in. Stamped onto each row so
       * the collection's View SERP action knows where to look; omitted rows
       * store an unknown market and the UI has to ask.
       */
      market?: { location: number; language: string };
    }) =>
      api.post<CollectionKeywordsAddedResponse>(
        `/collections/${encodeURIComponent(collectionId)}/keywords?${queryString({
          workspace: workspaceId ?? "",
        })}`,
        market === undefined
          ? { keywords }
          : { keywords, location: market.location, language: market.language },
      ),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: collectionKeys.list(workspaceId ?? ""),
      });
      void queryClient.invalidateQueries({
        queryKey: collectionKeys.detail(workspaceId ?? "", variables.collectionId),
      });
    },
  });
}

export function useRemoveKeywords(
  workspaceId: string | null,
  collectionId: string | null,
) {
  return useCollectionMutation(
    workspaceId,
    (keywords: string[]) =>
      api.del<CollectionKeywordsRemovedResponse>(
        `/collections/${encodeURIComponent(collectionId ?? "")}/keywords?${queryString({
          workspace: workspaceId ?? "",
        })}`,
        { keywords },
      ),
    collectionId,
  );
}
