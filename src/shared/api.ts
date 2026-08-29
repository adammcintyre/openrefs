/**
 * The contract between the Worker and the SPA. Both sides import from here so
 * a change to the error shape is a compile error, not a runtime surprise.
 */

/** Every non-2xx response from /api/v1 has exactly this body. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Present on validation failures; shape is the zod flattened error. */
    details?: unknown;
  };
}

/**
 * Canonical error codes and the HTTP status each maps to. Add codes here
 * rather than inventing strings at call sites — the SPA switches on them.
 */
export const ERROR_STATUS = {
  bad_request: 400,
  unauthorized: 401,
  payment_required: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  spend_cap_exceeded: 429,
  rate_limited: 429,
  internal_error: 500,
  not_implemented: 501,
  upstream_error: 502,

  /* Auth + workspaces (Phase 0). */
  /** Wrong password, or an email nobody has registered — deliberately one code. */
  invalid_credentials: 401,
  /** Registration hit the `users.email` unique constraint. */
  email_taken: 409,
  /** Login rate limit tripped for this email. */
  too_many_attempts: 429,
  /** Invite token is unknown, already redeemed, or past `expires_at`. */
  invite_invalid: 410,
} as const;

export type ApiErrorCode = keyof typeof ERROR_STATUS;

/** GET /api/v1/health */
export interface HealthResponse {
  status: "ok";
  version: string;
}

/** Narrow an unknown JSON body to the error shape. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const { error } = value as { error: unknown };
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error
  );
}
