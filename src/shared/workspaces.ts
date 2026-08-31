/**
 * Contract for `/api/v1/workspaces`.
 *
 * One rule shapes every response type here: stored DataForSEO credentials never
 * leave the Worker. The only thing a client learns is whether a workspace is
 * configured and a masked hint of the login — see `WorkspaceCredentials`.
 */
import { z } from "zod";

import { emailSchema } from "./auth";

/**
 * Mirrors `WORKSPACE_ROLES` in src/db/schema.ts. Re-declared rather than
 * imported so the SPA never pulls the Drizzle schema into the client bundle.
 */
export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);

export const workspaceNameSchema = z.string().trim().min(1).max(80);

export const createWorkspaceSchema = z.object({ name: workspaceNameSchema });
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: workspaceNameSchema.optional(),
    /** USD per calendar month. 0 blocks every paid DataForSEO call. */
    spendCapUsd: z.number().min(0).max(1_000_000).optional(),
  })
  .refine((body) => body.name !== undefined || body.spendCapUsd !== undefined, {
    message: "Provide at least one of name or spendCapUsd.",
  });
export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceSchema>;

export const credentialsSchema = z.object({
  login: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(512),
});
export type CredentialsBody = z.infer<typeof credentialsSchema>;

export const updateMemberSchema = z.object({ role: workspaceRoleSchema });
export type UpdateMemberBody = z.infer<typeof updateMemberSchema>;

export const createInviteSchema = z.object({
  email: emailSchema,
  role: workspaceRoleSchema.default("member"),
});
export type CreateInviteBody = z.infer<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().trim().min(1).max(200),
});
export type AcceptInviteBody = z.infer<typeof acceptInviteSchema>;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;

export const deleteWorkspaceSchema = z.object({
  /** Must equal the workspace's current name — a typed confirmation, not a checkbox. */
  confirmName: z.string().min(1).max(80),
});
export type DeleteWorkspaceBody = z.infer<typeof deleteWorkspaceSchema>;

/* ------------------------------ responses --------------------------------- */

/**
 * What the client is allowed to know about stored credentials. There is no
 * variant of this type that carries the password, encrypted or otherwise.
 */
export interface WorkspaceCredentials {
  configured: boolean;
  /** e.g. "te***@brandpacks.com". Null when nothing is stored. */
  login: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  role: WorkspaceRole;
  spendCapUsd: number;
  credentials: WorkspaceCredentials;
  createdAt: number;
}

export interface WorkspaceMember {
  userId: string;
  email: string;
  role: WorkspaceRole;
  createdAt: number;
}

export interface WorkspaceInvite {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: number;
  createdAt: number;
}

/** The plaintext token is in `inviteUrl` and is never recoverable afterwards. */
export interface CreatedInvite extends WorkspaceInvite {
  inviteUrl: string;
  /**
   * Whether the link was also emailed to the invitee (Phase 8c).
   *
   * False on a deployment with no mail provider configured, and false when a
   * configured provider refused — copying `inviteUrl` is still the primary
   * flow and always works, so this is a "we also did this" flag rather than a
   * success condition. Optional and additive: absent and `false` mean the same
   * thing, so every response predating the field stays valid.
   */
  emailSent?: boolean;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** `key` is returned exactly once, by the create call. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}
