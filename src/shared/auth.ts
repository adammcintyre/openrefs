/**
 * Contract for `/api/v1/auth`. The Worker validates requests with these
 * schemas; the SPA imports the inferred types, so a field cannot drift between
 * the form and the handler.
 */
import { z } from "zod";

import type { WorkspaceRole } from "./workspaces";

/**
 * Normalise before validating: addresses are stored and looked up lowercase, so
 * "Ada@Example.com" and "ada@example.com" are the same account and cannot both
 * be registered.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());

/**
 * 10 characters is the floor from the brief. The ceiling is a denial-of-service
 * guard: PBKDF2 at 600k iterations is deliberately slow, so an unbounded input
 * is CPU the caller gets to spend for free.
 */
export const passwordSchema = z.string().min(10).max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterBody = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  /** Not `passwordSchema`: old accounts must stay able to sign in if the rules tighten. */
  password: z.string().min(1).max(200),
});
export type LoginBody = z.infer<typeof loginSchema>;

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
});
export type DeleteAccountBody = z.infer<typeof deleteAccountSchema>;

/** A workspace as it appears in `GET /auth/me`. */
export interface MeWorkspace {
  id: string;
  name: string;
  role: WorkspaceRole;
}

/** `GET /api/v1/auth/me` */
export interface MeResponse {
  user: { id: string; email: string };
  workspaces: MeWorkspace[];
}
