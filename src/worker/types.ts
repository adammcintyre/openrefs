/**
 * The Hono generic every router in this Worker is parameterised by. Import
 * `AppEnv` rather than re-declaring bindings, so adding a binding to
 * wrangler.jsonc + `npm run types` propagates everywhere.
 */

/** Set by the auth middleware once a session cookie has been verified. */
export interface SessionContext {
  sessionId: string;
  userId: string;
  /** The workspace the request is acting in, resolved from route or cookie. */
  workspaceId: string | null;
}

export interface AppVariables {
  /** Echoed as `x-request-id` and attached to every log line. */
  requestId: string;
  /** Null until the auth module lands; never assume it is populated. */
  session: SessionContext | null;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
