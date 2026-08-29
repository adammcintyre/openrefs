/**
 * Session state for the SPA.
 *
 * `GET /auth/me` is the single source of truth for "am I signed in" — there is
 * no client-side token to inspect, because the session cookie is httpOnly by
 * design. A 401 is a normal answer here, not an error, so it resolves to null
 * and the route guard reads that.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { LoginBody, MeResponse, RegisterBody } from "../../shared/auth";
import { ApiError, api } from "./api";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async (): Promise<MeResponse | null> => {
      try {
        return await api.get<MeResponse>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    // Signed-out is a settled answer; retrying it just delays the redirect.
    retry: false,
    staleTime: 30_000,
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RegisterBody) => api.post<MeResponse>("/auth/register", body),
    onSuccess: (me) => {
      queryClient.setQueryData(meKey, me);
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginBody) => api.post<MeResponse>("/auth/login", body),
    onSuccess: (me) => {
      queryClient.setQueryData(meKey, me);
      void queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/auth/logout"),
    onSuccess: () => {
      // Everything cached belonged to the session that just ended.
      queryClient.clear();
      queryClient.setQueryData(meKey, null);
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.del<void>("/auth/me", { password }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(meKey, null);
    },
  });
}
