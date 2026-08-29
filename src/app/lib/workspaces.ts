/**
 * Workspace data hooks, plus the "which workspace am I looking at" state.
 *
 * The active workspace lives in localStorage and is always validated against
 * the list the server returned — a stale id from another account or a deleted
 * workspace must never be used to build a request path.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import type {
  ApiKeySummary,
  CreateApiKeyBody,
  CreateInviteBody,
  CreatedApiKey,
  CreatedInvite,
  CredentialsBody,
  UpdateWorkspaceBody,
  Workspace,
  WorkspaceCredentials,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
} from "../../shared/workspaces";
import { api } from "./api";

const ACTIVE_WORKSPACE_KEY = "openrefs.activeWorkspaceId";

export const workspacesKey = ["workspaces"] as const;
export const membersKey = (id: string) => ["workspaces", id, "members"] as const;
export const invitesKey = (id: string) => ["workspaces", id, "invites"] as const;
export const apiKeysKey = (id: string) => ["workspaces", id, "api-keys"] as const;

/* ------------------------------- queries ---------------------------------- */

export function useWorkspaces() {
  return useQuery({
    queryKey: workspacesKey,
    queryFn: () => api.get<Workspace[]>("/workspaces"),
  });
}

export function useMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: membersKey(workspaceId ?? ""),
    queryFn: () => api.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
    enabled: workspaceId !== null,
  });
}

export function useInvites(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: invitesKey(workspaceId ?? ""),
    queryFn: () => api.get<WorkspaceInvite[]>(`/workspaces/${workspaceId}/invites`),
    enabled: workspaceId !== null && enabled,
  });
}

export function useApiKeys(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: apiKeysKey(workspaceId ?? ""),
    queryFn: () => api.get<ApiKeySummary[]>(`/workspaces/${workspaceId}/api-keys`),
    enabled: workspaceId !== null && enabled,
  });
}

/* ------------------------------ mutations --------------------------------- */

/** Anything that changes a workspace refreshes the list and `GET /me`. */
function useWorkspaceMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspacesKey });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useCreateWorkspace() {
  return useWorkspaceMutation((name: string) =>
    api.post<Workspace>("/workspaces", { name }),
  );
}

export function useUpdateWorkspace(workspaceId: string | null) {
  return useWorkspaceMutation((patch: UpdateWorkspaceBody) =>
    api.patch<Workspace>(`/workspaces/${workspaceId}`, patch),
  );
}

export function useSetCredentials(workspaceId: string | null) {
  return useWorkspaceMutation((body: CredentialsBody) =>
    api.put<WorkspaceCredentials>(`/workspaces/${workspaceId}/credentials`, body),
  );
}

export function useClearCredentials(workspaceId: string | null) {
  return useWorkspaceMutation<void, WorkspaceCredentials>(() =>
    api.del<WorkspaceCredentials>(`/workspaces/${workspaceId}/credentials`),
  );
}

export function useDeleteWorkspace(workspaceId: string | null) {
  return useWorkspaceMutation((confirmName: string) =>
    api.del<{ deleted: boolean }>(`/workspaces/${workspaceId}`, { confirmName }),
  );
}

function useMemberMutation<TArgs, TResult>(
  workspaceId: string | null,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKey(workspaceId ?? "") });
      void queryClient.invalidateQueries({ queryKey: invitesKey(workspaceId ?? "") });
      void queryClient.invalidateQueries({ queryKey: workspacesKey });
    },
  });
}

export function useUpdateMemberRole(workspaceId: string | null) {
  return useMemberMutation(
    workspaceId,
    ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api.patch<{ userId: string; role: WorkspaceRole }>(
        `/workspaces/${workspaceId}/members/${userId}`,
        { role },
      ),
  );
}

export function useRemoveMember(workspaceId: string | null) {
  return useMemberMutation(workspaceId, (userId: string) =>
    api.del<void>(`/workspaces/${workspaceId}/members/${userId}`),
  );
}

export function useCreateInvite(workspaceId: string | null) {
  return useMemberMutation(workspaceId, (body: CreateInviteBody) =>
    api.post<CreatedInvite>(`/workspaces/${workspaceId}/invites`, body),
  );
}

export function useRevokeInvite(workspaceId: string | null) {
  return useMemberMutation(workspaceId, (inviteId: string) =>
    api.del<void>(`/workspaces/${workspaceId}/invites/${inviteId}`),
  );
}

function useApiKeyMutation<TArgs, TResult>(
  workspaceId: string | null,
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: apiKeysKey(workspaceId ?? "") });
    },
  });
}

export function useCreateApiKey(workspaceId: string | null) {
  return useApiKeyMutation(workspaceId, (body: CreateApiKeyBody) =>
    api.post<CreatedApiKey>(`/workspaces/${workspaceId}/api-keys`, body),
  );
}

export function useRevokeApiKey(workspaceId: string | null) {
  return useApiKeyMutation(workspaceId, (keyId: string) =>
    api.del<void>(`/workspaces/${workspaceId}/api-keys/${keyId}`),
  );
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.post<Workspace>("/workspaces/invites/accept", { token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspacesKey });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

/* --------------------------- active workspace ------------------------------ */

function readStoredWorkspaceId(): string | null {
  try {
    return globalThis.localStorage?.getItem(ACTIVE_WORKSPACE_KEY) ?? null;
  } catch {
    // Private mode or blocked storage: fall back to "first workspace".
    return null;
  }
}

/**
 * The workspace the UI is acting in. Reads from localStorage, but the stored
 * value only wins if it is still one of the caller's workspaces.
 */
export function useActiveWorkspace() {
  const query = useWorkspaces();
  const workspaces = query.data;
  const [storedId, setStoredId] = useState<string | null>(readStoredWorkspaceId);

  const active =
    workspaces?.find((workspace) => workspace.id === storedId) ??
    workspaces?.[0] ??
    null;

  // Heal a stale or missing selection so the next read is already correct.
  useEffect(() => {
    if (active !== null && active.id !== storedId) {
      setStoredId(active.id);
      try {
        globalThis.localStorage?.setItem(ACTIVE_WORKSPACE_KEY, active.id);
      } catch {
        /* storage unavailable — in-memory state still works for this tab */
      }
    }
  }, [active, storedId]);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setStoredId(id);
    try {
      globalThis.localStorage?.setItem(ACTIVE_WORKSPACE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  return {
    workspaces: workspaces ?? [],
    activeWorkspace: active,
    activeWorkspaceId: active?.id ?? null,
    setActiveWorkspaceId,
    isPending: query.isPending,
    error: query.error,
  };
}
