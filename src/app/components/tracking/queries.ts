/**
 * TanStack Query bindings for `/api/v1/projects/:id/keywords`.
 *
 * The reads are free — snapshots come from D1, not from DataForSEO — so the
 * tracking table itself refetches like any ordinary query. The three mutations
 * are different: each one *enqueues* a `rank_post` job, and the sweeper spends
 * real money running it. They never auto-retry, for the usual reason (a
 * request that timed out may already have enqueued) plus a local one: the
 * check-now limiter would answer a retry with a 429 anyway.
 *
 * **Polling.** `checkInProgress` is live, so the table watches itself: while a
 * check is queued or running it refetches every 15s and stops the moment the
 * flag clears. That is what turns "Add keywords" into a screen that fills
 * itself in rather than one the user has to reload. It only runs while the
 * flag is true, so an idle project makes no background requests at all.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  AddTrackedKeywordsBody,
  RankCheckEnqueuedResponse,
  RemoveTrackedKeywordsBody,
  TrackedKeywordsAddedResponse,
  TrackedKeywordsRemovedResponse,
  TrackedKeywordsResponse,
} from "../../../shared/tracking";
import { api } from "../../lib/api";
import { projectKeys } from "../projects/queries";

/**
 * How often to re-ask while a check is in flight.
 *
 * A first check typically takes 5–20 minutes end to end (task_post, then the
 * collector polling DataForSEO's queue), so this is not trying to catch the
 * result the instant it lands — it is keeping a screen someone is watching
 * from going stale, cheaply.
 */
export const CHECK_POLL_INTERVAL_MS = 15_000;

export const trackingKeys = {
  all: ["tracking"] as const,
  keywords: (workspaceId: string, projectId: string) =>
    ["tracking", "keywords", workspaceId, projectId] as const,
};

function scoped(workspaceId: string | null, projectId: string | null): string {
  return `/projects/${encodeURIComponent(projectId ?? "")}/keywords?workspace=${encodeURIComponent(
    workspaceId ?? "",
  )}`;
}

/** The tracking table: every keyword with its latest, deltas and 30-day series. */
export function useTrackedKeywords(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useQuery({
    queryKey: trackingKeys.keywords(workspaceId ?? "", projectId ?? ""),
    queryFn: () =>
      api.get<TrackedKeywordsResponse>(scoped(workspaceId, projectId)),
    enabled: workspaceId !== null && projectId !== null,
    // Watch while a check runs; go quiet as soon as it finishes.
    refetchInterval: (query) =>
      query.state.data?.checkInProgress === true
        ? CHECK_POLL_INTERVAL_MS
        : false,
  });
}

/**
 * Anything that changes the tracked set refreshes the table and the project
 * list — the list carries `keywordCount` and `lastCheckedAt`, which the header
 * and the picker both render.
 */
function useTrackingMutation<TArgs, TResult>(
  workspaceId: string | null,
  projectId: string | null,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    // See the file header: these enqueue spending, so a failure is reported
    // rather than quietly tried again.
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: trackingKeys.keywords(workspaceId ?? "", projectId ?? ""),
      });
      void queryClient.invalidateQueries({
        queryKey: projectKeys.list(workspaceId ?? ""),
      });
    },
  });
}

/**
 * Bulk add. Idempotent server-side against the (project, keyword, location,
 * language, device) unique index, so re-adding is reported as `skipped` rather
 * than failing — which is what makes "select all → Track" safe to double-click.
 */
export function useAddTrackedKeywords(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useTrackingMutation(workspaceId, projectId, (body: AddTrackedKeywordsBody) =>
    api.post<TrackedKeywordsAddedResponse>(scoped(workspaceId, projectId), body),
  );
}

/**
 * Bulk remove by tracked-keyword id, not by keyword text: the same word can be
 * tracked twice under different devices or markets, and text would take both.
 */
export function useRemoveTrackedKeywords(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useTrackingMutation(
    workspaceId,
    projectId,
    (body: RemoveTrackedKeywordsBody) =>
      api.del<TrackedKeywordsRemovedResponse>(
        scoped(workspaceId, projectId),
        body,
      ),
  );
}

/**
 * Force a re-check of the whole project. Admin only, and rate-limited to once
 * an hour per project — a 429 carries `nextAllowedAt` in its details, which the
 * header turns into a disabled button with a "try again after…" tooltip rather
 * than an error.
 */
export function useCheckNow(
  workspaceId: string | null,
  projectId: string | null,
) {
  // Explicitly `void` variables so the caller can write `mutateAsync()` —
  // "check this project" takes no arguments, and inferring `unknown` here
  // would force a placeholder at every call site.
  return useTrackingMutation<void, RankCheckEnqueuedResponse>(
    workspaceId,
    projectId,
    () =>
      api.post<RankCheckEnqueuedResponse>(
        `/projects/${encodeURIComponent(projectId ?? "")}/keywords/check-now?workspace=${encodeURIComponent(
          workspaceId ?? "",
        )}`,
      ),
  );
}

/**
 * `nextAllowedAt` out of a 429's details.
 *
 * The Worker sends `{ nextAllowedAt: string | null }`, but this reads it
 * defensively: an error body is the one payload most likely to be reshaped by
 * a proxy or an older deployment, and the fallback ("try again later") is
 * perfectly usable without a timestamp.
 */
export function nextAllowedAtFrom(details: unknown): Date | null {
  if (typeof details !== "object" || details === null) return null;
  const { nextAllowedAt } = details as { nextAllowedAt?: unknown };
  if (typeof nextAllowedAt !== "string") return null;
  const parsed = Date.parse(nextAllowedAt);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}
