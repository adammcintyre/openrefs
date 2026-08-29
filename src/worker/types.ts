/**
 * The Hono generic every router in this Worker is parameterised by. Import
 * `AppEnv` rather than re-declaring bindings, so adding a binding to
 * wrangler.jsonc + `npm run types` propagates everywhere.
 */

/**
 * A signed-in human, resolved from the `orf_session` cookie by `loadSession`.
 */
export interface UserSessionContext {
  kind: "session";
  /** `sha256Hex(cookie token)` — the primary key of the `sessions` row. */
  sessionId: string;
  userId: string;
  /**
   * The workspace this request acts in. Handlers set it from the path; it is
   * never inferred from "the user's first workspace" (docs/ARCHITECTURE.md,
   * "Workspace scoping").
   */
  workspaceId: string | null;
}

/**
 * A machine caller, resolved from `Authorization: Bearer orf_...`.
 *
 * Keys are minted per workspace and carry the `member` role — see
 * `API_KEY_ROLE` in lib/authorization.ts. They can read a workspace but never
 * administer one, so a leaked key cannot rotate credentials or delete data.
 */
export interface ApiKeySessionContext {
  kind: "api_key";
  apiKeyId: string;
  /** Fixed at creation. An API key can never act outside this workspace. */
  workspaceId: string;
  /** A key acts as the workspace, not as a person. */
  userId: null;
}

/**
 * Set by `loadSession` once a cookie or bearer key has been verified.
 *
 * Both variants expose `userId` and `workspaceId`, so code that only needs
 * those can read them without narrowing; switch on `kind` for the rest.
 */
export type SessionContext = UserSessionContext | ApiKeySessionContext;

export interface AppVariables {
  /** Echoed as `x-request-id` and attached to every log line. */
  requestId: string;
  /** Null for anonymous requests. `requireSession` turns null into a 401. */
  session: SessionContext | null;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
