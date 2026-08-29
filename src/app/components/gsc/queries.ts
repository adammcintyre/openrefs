/**
 * TanStack Query bindings for `/api/v1/gsc/*`.
 *
 * Three things about this module are unlike every other set of bindings here:
 *
 *  - **Nothing costs money.** The data comes from Google on the user's own
 *    grant, so these are ordinary cheap reads that may retry and refetch freely.
 *    There is no cost chip anywhere in this module and no spend to guard.
 *  - **`status` is the state selector.** It never fails for a configuration
 *    reason and answers from D1 and KV without calling Google, so it is the
 *    only query enabled unconditionally. Every report is gated behind it: with
 *    no property bound there is nothing to report on, and asking anyway would
 *    turn a normal "not set up yet" into four failed requests.
 *  - **Connecting is a navigation, not a fetch.** See `gscConnectUrl`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  GscConnectionResponse,
  GscDisconnectedResponse,
  GscOpportunitiesResponse,
  GscOverviewResponse,
  GscPagesResponse,
  GscQueriesResponse,
  GscSitesResponse,
  GscStatusResponse,
  UpdateGscConnectionBody,
} from "../../../shared/gsc";
import { api } from "../../lib/api";
import { GSC_CONNECT_PATH } from "./paths";
import type { GscRangeId } from "./range";
import { gscRangeQuery } from "./range";

export const gscKeys = {
  all: ["gsc"] as const,
  status: (workspaceId: string, projectId: string) =>
    ["gsc", "status", workspaceId, projectId] as const,
  sites: (workspaceId: string, projectId: string) =>
    ["gsc", "sites", workspaceId, projectId] as const,
  report: (
    report: "overview" | "queries" | "pages" | "opportunities",
    workspaceId: string,
    projectId: string,
    range: GscRangeId,
  ) => ["gsc", report, workspaceId, projectId, range] as const,
};

function scope(workspaceId: string | null, projectId: string | null): string {
  return `workspace=${encodeURIComponent(workspaceId ?? "")}&project=${encodeURIComponent(
    projectId ?? "",
  )}`;
}

/**
 * Where the browser goes to connect a property.
 *
 * **This must be a full-page navigation** — `window.location.href = …`, never
 * `fetch`. The route answers 302 to Google's consent screen, and Google refuses
 * to be framed or fetched cross-origin: an XHR would follow the redirect, be
 * blocked by CORS, and surface as an unexplained network error while the user
 * sits looking at a button that did nothing. Handing the whole tab over is not
 * a workaround, it is how OAuth works.
 */
export function gscConnectUrl(
  workspaceId: string | null,
  projectId: string | null,
): string {
  return `${GSC_CONNECT_PATH}?${scope(workspaceId, projectId)}`;
}

/** Leaves the SPA for Google. Nothing after this call runs on this page. */
export function startGscConnect(
  workspaceId: string | null,
  projectId: string | null,
): void {
  globalThis.location.href = gscConnectUrl(workspaceId, projectId);
}

/* --------------------------------- status ---------------------------------- */

/**
 * The one call the module needs to choose between its states.
 *
 * `staleTime: 0` because the states this drives change *outside* this tab: the
 * user comes back from Google's consent screen, or an admin disconnects from
 * another browser. Everything else in the module inherits the app-wide 60s.
 */
export function useGscStatus(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useQuery({
    queryKey: gscKeys.status(workspaceId ?? "", projectId ?? ""),
    queryFn: () =>
      api.get<GscStatusResponse>(`/gsc/status?${scope(workspaceId, projectId)}`),
    enabled: workspaceId !== null && projectId !== null,
    staleTime: 0,
  });
}

/**
 * The properties this grant can read, for the picker.
 *
 * Admin-only server-side and one live Google call, so it is only fetched while
 * the picker is actually open — `enabled` is the caller's switch.
 */
export function useGscSites(
  workspaceId: string | null,
  projectId: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: gscKeys.sites(workspaceId ?? "", projectId ?? ""),
    queryFn: () =>
      api.get<GscSitesResponse>(`/gsc/sites?${scope(workspaceId, projectId)}`),
    enabled: enabled && workspaceId !== null && projectId !== null,
  });
}

/* -------------------------------- mutations -------------------------------- */

/**
 * Anything that changes the connection invalidates the whole `["gsc"]` tree.
 *
 * Coarse on purpose: binding a different property makes every cached report
 * describe the wrong site. A narrower invalidation would leave last property's
 * numbers on screen under the new property's name, which is the worst failure
 * this module could have.
 */
function useConnectionMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    retry: false,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gscKeys.all });
    },
  });
}

/** Bind a property to the project. Validated against sites.list server-side. */
export function useSetGscProperty(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useConnectionMutation((body: UpdateGscConnectionBody) =>
    api.patch<GscConnectionResponse>(
      `/gsc/connection?${scope(workspaceId, projectId)}`,
      body,
    ),
  );
}

/** Revoke the grant with Google and delete the row. Admin only. */
export function useDisconnectGsc(
  workspaceId: string | null,
  projectId: string | null,
) {
  return useConnectionMutation<void, GscDisconnectedResponse>(() =>
    api.del<GscDisconnectedResponse>(
      `/gsc/connection?${scope(workspaceId, projectId)}`,
    ),
  );
}

/* --------------------------------- reports --------------------------------- */

/**
 * Reports are only asked for once a property is bound.
 *
 * `enabled` carries that condition from `status` rather than each report
 * discovering it by failing, which is what keeps "connected, no property
 * chosen" a calm screen with a picker on it instead of four error notices.
 */
function reportPath(
  report: string,
  workspaceId: string | null,
  projectId: string | null,
  range: GscRangeId,
  now: Date,
  extra = "",
): string {
  return `/gsc/${report}?${scope(workspaceId, projectId)}${gscRangeQuery(range, now)}${extra}`;
}

export function useGscOverview(
  workspaceId: string | null,
  projectId: string | null,
  range: GscRangeId,
  enabled: boolean,
) {
  return useQuery({
    queryKey: gscKeys.report("overview", workspaceId ?? "", projectId ?? "", range),
    queryFn: () =>
      api.get<GscOverviewResponse>(
        reportPath("overview", workspaceId, projectId, range, new Date()),
      ),
    enabled: enabled && workspaceId !== null && projectId !== null,
  });
}

/**
 * Top queries.
 *
 * `limit` is the server's window over the fetched set, not a page size for the
 * table — the table paginates whatever it is given, client-side. 200 rows is
 * enough to be worth exporting and small enough to render without a fight.
 */
export const GSC_TABLE_LIMIT = 200;

export function useGscQueries(
  workspaceId: string | null,
  projectId: string | null,
  range: GscRangeId,
  enabled: boolean,
) {
  return useQuery({
    queryKey: gscKeys.report("queries", workspaceId ?? "", projectId ?? "", range),
    queryFn: () =>
      api.get<GscQueriesResponse>(
        reportPath(
          "queries",
          workspaceId,
          projectId,
          range,
          new Date(),
          `&limit=${GSC_TABLE_LIMIT}`,
        ),
      ),
    enabled: enabled && workspaceId !== null && projectId !== null,
  });
}

export function useGscPages(
  workspaceId: string | null,
  projectId: string | null,
  range: GscRangeId,
  enabled: boolean,
) {
  return useQuery({
    queryKey: gscKeys.report("pages", workspaceId ?? "", projectId ?? "", range),
    queryFn: () =>
      api.get<GscPagesResponse>(
        reportPath(
          "pages",
          workspaceId,
          projectId,
          range,
          new Date(),
          `&limit=${GSC_TABLE_LIMIT}`,
        ),
      ),
    enabled: enabled && workspaceId !== null && projectId !== null,
  });
}

export function useGscOpportunities(
  workspaceId: string | null,
  projectId: string | null,
  range: GscRangeId,
  enabled: boolean,
) {
  return useQuery({
    queryKey: gscKeys.report(
      "opportunities",
      workspaceId ?? "",
      projectId ?? "",
      range,
    ),
    queryFn: () =>
      api.get<GscOpportunitiesResponse>(
        reportPath("opportunities", workspaceId, projectId, range, new Date()),
      ),
    enabled: enabled && workspaceId !== null && projectId !== null,
  });
}
