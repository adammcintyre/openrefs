/**
 * TanStack Query bindings for `/api/v1/projects/:id/ai/*`.
 *
 * The reads are free — prompts and snapshots come out of D1, not out of an LLM
 * — so they behave like any ordinary query. The mutations are not: **three of
 * the four spend money**, and one of those is not obviously a spender.
 *
 * - `POST /ai/prompts` **runs the new prompt immediately** (the response says
 *   so in `runEnqueued`) and deliberately does not consume the hourly run
 *   limit. Adding a prompt is therefore a purchase, which is why the add
 *   dialog quotes an estimate rather than treating it as ordinary form entry.
 * - `PATCH` does not re-run. Editing the wording of a prompt costs nothing
 *   until the next scheduled or manual run.
 * - `POST /ai/run` runs every prompt, once per hour per project.
 *
 * None of them retry. A request that timed out may already have enqueued the
 * run — a silent second attempt would buy the same answers twice — and the
 * limiter would answer the retry with a 429 anyway.
 *
 * **Polling.** `runInProgress` is live, so the prompts list watches itself
 * while a run is queued or executing and goes quiet the moment it clears.
 * Results are invalidated when it clears rather than polled, because a run
 * that has just finished is exactly when the timelines changed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type {
  AiPromptDeletedResponse,
  AiPromptListResponse,
  AiPromptMutationResponse,
  AiResultsResponse,
  AiRunEnqueuedResponse,
  CreateAiPromptBody,
  UpdateAiPromptBody,
} from "../../../shared/ai";
import { api } from "../../lib/api";
import { projectKeys } from "../projects/queries";

/**
 * How often to re-ask while a run is in flight.
 *
 * A live LLM call is documented at up to 120s and a run fans out one per
 * engine, so this is not trying to catch the result the instant it lands — it
 * keeps a screen someone is watching from going stale, cheaply.
 */
export const AI_RUN_POLL_INTERVAL_MS = 10_000;

export const aiKeys = {
  all: ["ai"] as const,
  prompts: (workspaceId: string, projectId: string) =>
    ["ai", "prompts", workspaceId, projectId] as const,
  results: (workspaceId: string, projectId: string, from: string, to: string) =>
    ["ai", "results", workspaceId, projectId, from, to] as const,
};

/**
 * `/projects/<id>/ai<path>?workspace=<ws>&…`
 *
 * Every AI route is workspace-scoped by query parameter and project-scoped by
 * path, so one builder covers all six. Blank extras are dropped rather than
 * sent empty — `from=` would fail the API's `YYYY-MM-DD` regex, where an
 * absent `from` correctly means "use the default window".
 */
function scoped(
  workspaceId: string | null,
  projectId: string | null,
  path: string,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({ workspace: workspaceId ?? "" });
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== "") params.set(key, value);
  }
  return `/projects/${encodeURIComponent(projectId ?? "")}/ai${path}?${params.toString()}`;
}

/* ---------------------------------- reads ---------------------------------- */

/** The prompts manager: every prompt with its per-engine latest verdict. */
export function useAiPrompts(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useQuery({
    queryKey: aiKeys.prompts(workspaceId ?? "", projectId ?? ""),
    queryFn: () =>
      api.get<AiPromptListResponse>(scoped(workspaceId, projectId, "/prompts")),
    enabled: workspaceId !== null && projectId !== null,
    // Watch while a run executes; stop as soon as it finishes.
    refetchInterval: (query) =>
      query.state.data?.runInProgress === true
        ? AI_RUN_POLL_INTERVAL_MS
        : false,
  });
}

/**
 * Timelines and latest runs for a window.
 *
 * `from`/`to` are part of the key, so changing the range is a new query rather
 * than a refetch that briefly shows the old window's numbers under the new
 * dates. Empty strings mean "let the server pick", and are dropped from the
 * query string rather than sent blank.
 */
export function useAiResults(
  workspaceId: string | null,
  projectId: string | null,
  range: { from: string; to: string },
) {
  return useQuery({
    queryKey: aiKeys.results(
      workspaceId ?? "",
      projectId ?? "",
      range.from,
      range.to,
    ),
    queryFn: () =>
      api.get<AiResultsResponse>(
        scoped(workspaceId, projectId, "/results", {
          from: range.from,
          to: range.to,
        }),
      ),
    enabled: workspaceId !== null && projectId !== null,
  });
}

/**
 * Refresh the results the moment a run finishes.
 *
 * The prompts query already polls `runInProgress`; this watches that flag go
 * from true to false and invalidates the results, so the chart and the runs
 * table fill in on their own. Polling the results endpoint on its own timer
 * would ask repeatedly for a window that only changes once.
 */
export function useRefreshResultsWhenRunCompletes(
  workspaceId: string | null,
  projectId: string | null,
  runInProgress: boolean,
) {
  const queryClient = useQueryClient();
  const wasRunning = useRef(runInProgress);

  useEffect(() => {
    if (wasRunning.current && !runInProgress) {
      void queryClient.invalidateQueries({
        queryKey: ["ai", "results", workspaceId ?? "", projectId ?? ""],
      });
    }
    wasRunning.current = runInProgress;
  }, [runInProgress, queryClient, workspaceId, projectId]);
}

/* -------------------------------- mutations -------------------------------- */

/**
 * Anything that changes the prompts refreshes the list and the project record
 * — and the results too, since a run enqueued by a create will land there.
 */
function useAiMutation<TArgs, TResult>(
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
        queryKey: aiKeys.prompts(workspaceId ?? "", projectId ?? ""),
      });
      void queryClient.invalidateQueries({
        queryKey: ["ai", "results", workspaceId ?? "", projectId ?? ""],
      });
      void queryClient.invalidateQueries({
        queryKey: projectKeys.list(workspaceId ?? ""),
      });
    },
  });
}

/**
 * Create a prompt — and, as a side effect the API documents, run it now.
 *
 * The 201 carries `runEnqueued`, which the caller should report rather than
 * assume: it is the difference between "saved" and "saved, and you have just
 * bought one answer per engine you ticked".
 */
export function useCreateAiPrompt(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useAiMutation(workspaceId, projectId, (body: CreateAiPromptBody) =>
    api.post<AiPromptMutationResponse>(
      scoped(workspaceId, projectId, "/prompts"),
      body,
    ),
  );
}

/** Edit a prompt's text or engines. Never re-runs — no spend. */
export function useUpdateAiPrompt(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useAiMutation(
    workspaceId,
    projectId,
    ({ id, body }: { id: string; body: UpdateAiPromptBody }) =>
      api.patch<AiPromptMutationResponse>(
        scoped(workspaceId, projectId, `/prompts/${encodeURIComponent(id)}`),
        body,
      ),
  );
}

/** Remove a prompt and its history. */
export function useDeleteAiPrompt(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useAiMutation(workspaceId, projectId, (id: string) =>
    api.del<AiPromptDeletedResponse>(
      scoped(workspaceId, projectId, `/prompts/${encodeURIComponent(id)}`),
    ),
  );
}

/**
 * Run every prompt in the project. Admin only, once per hour per project.
 *
 * A 429 carries `nextAllowedAt` in its details, which the button turns into a
 * disabled state and a tooltip rather than an error — being refused here is a
 * normal outcome, not a failure.
 */
export function useRunAiNow(
  workspaceId: string | null,
  projectId: string | null,
) {
  // Explicitly `void` args so callers can write `mutateAsync()` — "run this
  // project" takes no parameters.
  return useAiMutation<void, AiRunEnqueuedResponse>(
    workspaceId,
    projectId,
    () =>
      api.post<AiRunEnqueuedResponse>(scoped(workspaceId, projectId, "/run")),
  );
}

/**
 * `nextAllowedAt` out of a 429's details.
 *
 * Read defensively: an error body is the payload most likely to be reshaped by
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
