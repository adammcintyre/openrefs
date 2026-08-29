/**
 * TanStack Query bindings for `/api/v1/projects`.
 *
 * Unlike the research modules, nothing here spends: projects are pure D1, so
 * these are ordinary cheap reads that may retry and refetch like any other.
 * The rule those modules follow — never auto-retry a billed call — starts to
 * apply again in `../tracking/queries.ts`, at the two routes that enqueue a
 * rank check.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateProjectBody,
  ProjectListResponse,
  ProjectMutationResponse,
} from "../../../shared/projects";
import { api } from "../../lib/api";

export const projectKeys = {
  all: ["projects"] as const,
  list: (workspaceId: string) => ["projects", "list", workspaceId] as const,
};

/** Every project in the workspace, newest first, with counts and last-checked. */
export function useProjects(workspaceId: string | null) {
  return useQuery({
    queryKey: projectKeys.list(workspaceId ?? ""),
    queryFn: () =>
      api.get<ProjectListResponse>(
        `/projects?workspace=${encodeURIComponent(workspaceId ?? "")}`,
      ),
    enabled: workspaceId !== null,
  });
}

/**
 * Create a project. `admin` only — the route rejects a member with 403, which
 * is why the picker hides the form rather than letting someone fill it in and
 * then be told no.
 */
export function useCreateProject(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectBody) =>
      api.post<ProjectMutationResponse>(
        `/projects?workspace=${encodeURIComponent(workspaceId ?? "")}`,
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.list(workspaceId ?? ""),
      });
    },
  });
}
