/**
 * TanStack Query hooks for the shared search-history trail.
 *
 * History rows are cheap D1 reads — never a DataForSEO call — so unlike the
 * research hooks these keep the normal retry default. The list is invalidated
 * by the research modules after a successful search (`useInvalidateHistory` is
 * the handle they share) rather than polled.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  HistoryDeletedResponse,
  HistoryEntryByModule,
  HistoryListResponse,
  HistoryModule,
} from "../../../shared/history";
import { HISTORY_DEFAULT_LIMIT } from "../../../shared/history";
import { api } from "../../lib/api";

export const historyKeys = {
  all: ["history"] as const,
  list: (workspaceId: string, module: HistoryModule) =>
    ["history", "list", workspaceId, module] as const,
};

/** The trail for one module, newest first. Items narrow to the module's type. */
export function useSearchHistory<M extends HistoryModule>(
  workspaceId: string | null,
  module: M,
  limit: number = HISTORY_DEFAULT_LIMIT,
) {
  return useQuery({
    queryKey: [...historyKeys.list(workspaceId ?? "", module), limit] as const,
    queryFn: () => {
      const params = new URLSearchParams({
        workspace: workspaceId ?? "",
        module,
        limit: String(limit),
      });
      return api.get<HistoryListResponse>(`/history?${params.toString()}`);
    },
    enabled: workspaceId !== null,
    staleTime: 30_000,
    select: (data) => ({
      total: data.total,
      items: data.items.filter(
        (entry): entry is HistoryEntryByModule[M] => entry.module === module,
      ),
    }),
  });
}

/** Call after a successful search so the new entry surfaces without a reload. */
export function useInvalidateHistory(
  workspaceId: string | null,
  module: HistoryModule,
): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: historyKeys.list(workspaceId ?? "", module),
    });
  };
}

function useHistoryMutation<TArgs>(
  workspaceId: string | null,
  module: HistoryModule,
  mutationFn: (args: TArgs) => Promise<HistoryDeletedResponse>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: historyKeys.list(workspaceId ?? "", module),
      });
    },
  });
}

/** Remove one entry from the trail. */
export function useDeleteHistoryEntry(
  workspaceId: string | null,
  module: HistoryModule,
) {
  return useHistoryMutation(workspaceId, module, (id: string) =>
    api.del<HistoryDeletedResponse>(
      `/history/${encodeURIComponent(id)}?${new URLSearchParams({
        workspace: workspaceId ?? "",
      }).toString()}`,
    ),
  );
}

/** Clear the module's whole trail for this workspace. */
export function useClearHistory(
  workspaceId: string | null,
  module: HistoryModule,
) {
  return useHistoryMutation(workspaceId, module, (_: void) =>
    api.del<HistoryDeletedResponse>(
      `/history?${new URLSearchParams({
        workspace: workspaceId ?? "",
        module,
      }).toString()}`,
    ),
  );
}
