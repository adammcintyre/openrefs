/**
 * TanStack Query bindings for the audit endpoints.
 *
 * **Reads are free, writes are not.** `GET /audits/:id` and the drill-downs
 * serve D1 and R2 — DataForSEO bills only for `task_post`, and even collecting
 * a finished crawl is free — so the detail query can poll happily. `POST
 * /projects/:id/audits` spends real money, so it never auto-retries: a request
 * that appeared to fail may already have posted the task, and a retry would
 * start a second crawl (or, more likely, collect a 409).
 *
 * **Polling is the whole design of this screen.** An audit takes one to three
 * minutes, and nothing arrives incrementally except `progress`. So the detail
 * query re-asks every 10s while the status is pending or running and goes
 * silent the moment it is not — an idle finished audit makes no background
 * requests at all.
 *
 * **Two queries watch the same thing.** The history list carries
 * `auditInProgress`, which is what the module uses to notice a crawl started in
 * another tab; it polls on the same condition. When the detail query sees a
 * status change it invalidates the list, so the two cannot disagree for longer
 * than one round trip.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type {
  AuditCategory,
  AuditCreatedResponse,
  AuditDeletedResponse,
  AuditDetailResponse,
  AuditIssuesResponse,
  AuditListResponse,
  CreateAuditBody,
} from "../../../shared/audits";
import { api } from "../../lib/api";
import { isInFlight } from "./format";

/**
 * How often to re-ask while a crawl is running.
 *
 * Audits finish in 1–3 minutes, so 10s is roughly 6–18 requests per audit
 * against our own D1 — cheap, and fast enough that "finished" appears while
 * the user is still looking at the progress card.
 */
export const AUDIT_POLL_INTERVAL_MS = 10_000;

export const auditKeys = {
  all: ["audits"] as const,
  list: (workspaceId: string, projectId: string) =>
    ["audits", "list", workspaceId, projectId] as const,
  detail: (workspaceId: string, auditId: string) =>
    ["audits", "detail", workspaceId, auditId] as const,
  issues: (
    workspaceId: string,
    auditId: string,
    category: string,
    page: number,
  ) => ["audits", "issues", workspaceId, auditId, category, page] as const,
};

function workspaceQuery(workspaceId: string | null): string {
  return `workspace=${encodeURIComponent(workspaceId ?? "")}`;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** The history list for a project, plus whether a crawl is in flight. */
export function useAudits(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useQuery({
    queryKey: auditKeys.list(workspaceId ?? "", projectId ?? ""),
    queryFn: () =>
      api.get<AuditListResponse>(
        `/projects/${encodeURIComponent(projectId ?? "")}/audits?${workspaceQuery(
          workspaceId,
        )}`,
      ),
    enabled: workspaceId !== null && projectId !== null,
    // Watch while any audit for this project is queued or crawling.
    refetchInterval: (query) =>
      query.state.data?.auditInProgress === true
        ? AUDIT_POLL_INTERVAL_MS
        : false,
  });
}

/**
 * One audit: summary, progress, and the previous rollup for the chips.
 *
 * The `previous` field is why the comparison chips need no second request —
 * see the header of src/shared/audits.ts.
 */
export function useAudit(workspaceId: string | null, auditId: string | null) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: auditKeys.detail(workspaceId ?? "", auditId ?? ""),
    queryFn: async () => {
      const detail = await api.get<AuditDetailResponse>(
        `/audits/${encodeURIComponent(auditId ?? "")}?${workspaceQuery(workspaceId)}`,
      );
      /*
       * A finished crawl changes the history row too — its score and page
       * count arrive with the same ingest. Refreshing the list here is what
       * makes the history entry fill in without the user navigating away and
       * back. Cheap: the list only refetches when it has an observer.
       */
      if (!isInFlight(detail.status)) {
        void queryClient.invalidateQueries({
          queryKey: auditKeys.list(workspaceId ?? "", detail.projectId),
        });
      }
      return detail;
    },
    enabled: workspaceId !== null && auditId !== null,
    refetchInterval: (query) =>
      query.state.data !== undefined && isInFlight(query.state.data.status)
        ? AUDIT_POLL_INTERVAL_MS
        : false,
  });
}

/**
 * One page of a category drill-down.
 *
 * `placeholderData` keeps the previous page's rows on screen while the next
 * loads, so paging through affected URLs does not collapse the table to a
 * skeleton and bounce the scroll position on every click.
 */
export function useAuditIssues(
  workspaceId: string | null,
  auditId: string | null,
  category: AuditCategory | null,
  page: number,
) {
  return useQuery({
    queryKey: auditKeys.issues(
      workspaceId ?? "",
      auditId ?? "",
      category ?? "",
      page,
    ),
    queryFn: () =>
      api.get<AuditIssuesResponse>(
        `/audits/${encodeURIComponent(auditId ?? "")}/issues/${encodeURIComponent(
          category ?? "",
        )}?${workspaceQuery(workspaceId)}&page=${page}`,
      ),
    enabled: workspaceId !== null && auditId !== null && category !== null,
    placeholderData: (previous) => previous,
  });
}

/* -------------------------------------------------------------------------- */
/* The Lighthouse grace period                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How long to wait for Lighthouse after the crawl reports done.
 *
 * The crawl and the Lighthouse run are two DataForSEO tasks. The crawl usually
 * finishes first, so `status: "done"` with `lighthouse: null` and a
 * `lighthouseNote` is the *normal* first sight of a fresh audit, not a failure.
 * 30s is comfortably longer than the gap in practice.
 */
export const LIGHTHOUSE_GRACE_MS = 30_000;

/**
 * One extra look before declaring Lighthouse unavailable.
 *
 * Returns true while still waiting. Fires exactly once per audit id — the
 * detail query's own polling has already stopped by this point (the audit is
 * `done`), so without this the screen would sit on a permanent "unavailable"
 * for a result that arrived four seconds later.
 */
export function useLighthouseGrace(
  auditId: string | null,
  /** True when the audit is finished but carries no Lighthouse block yet. */
  missing: boolean,
  refetch: () => void,
): boolean {
  const [retriedFor, setRetriedFor] = useState<string | null>(null);

  // A ref so a new `refetch` identity cannot restart the timer mid-wait.
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  const waiting = missing && auditId !== null && retriedFor !== auditId;

  useEffect(() => {
    if (!waiting || auditId === null) return;
    const timer = setTimeout(() => {
      refetchRef.current();
      setRetriedFor(auditId);
    }, LIGHTHOUSE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [waiting, auditId]);

  return waiting;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Start a crawl. Admin only, and 409 when one is already running for this
 * project — the caller surfaces that as "an audit is already running" rather
 * than as a failure, because it is a description of a normal state.
 *
 * `retry: false` for the reason in the file header: this spends money.
 */
export function useCreateAudit(
  workspaceId: string | null,
  projectId: string | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: (body: CreateAuditBody) =>
      api.post<AuditCreatedResponse>(
        `/projects/${encodeURIComponent(projectId ?? "")}/audits?${workspaceQuery(
          workspaceId,
        )}`,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: auditKeys.list(workspaceId ?? "", projectId ?? ""),
      });
    },
  });
}

/**
 * Delete an audit and its R2 blobs. Admin only.
 *
 * Invalidates the whole `audits` key rather than just the list: the deleted
 * audit's own detail entry, and any drill-down page cached under it, are now
 * 404s and must not be served from cache if the user hits Back.
 */
export function useDeleteAudit(
  workspaceId: string | null,
  projectId: string | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: (auditId: string) =>
      api.del<AuditDeletedResponse>(
        `/audits/${encodeURIComponent(auditId)}?${workspaceQuery(workspaceId)}`,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: auditKeys.all });
      void queryClient.invalidateQueries({
        queryKey: auditKeys.list(workspaceId ?? "", projectId ?? ""),
      });
    },
  });
}
