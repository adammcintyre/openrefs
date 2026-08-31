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
  /** Workspace is over its monthly DataForSEO spend cap. */
  spend_cap_exceeded: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  /** No DataForSEO credentials for this workspace, and no dev fallback. */
  no_credentials: 409,
  validation_failed: 422,
  rate_limited: 429,
  internal_error: 500,
  not_implemented: 501,
  upstream_error: 502,
  /** DataForSEO did not answer inside the client's timeout. */
  upstream_timeout: 504,

  /* Auth + workspaces (Phase 0). */
  /** Wrong password, or an email nobody has registered — deliberately one code. */
  invalid_credentials: 401,
  /** Registration hit the `users.email` unique constraint. */
  email_taken: 409,
  /** Login rate limit tripped for this email. */
  too_many_attempts: 429,
  /** Invite token is unknown, already redeemed, or past `expires_at`. */
  invite_invalid: 410,

  /* Password reset (Phase 8c). */
  /**
   * Reset token is unknown, already used, or past `expires_at` — deliberately
   * one code for all three, so a caller holding a dead link learns only that
   * it is dead. 410 rather than 404: the link was real, and its own page can
   * say "this link has expired" and offer a fresh one.
   */
  reset_invalid: 410,

  /* Search Console (Phase 5). */
  /**
   * No `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` on this deployment, so the
   * OAuth flow cannot start. A 409 rather than a 501: the feature exists and
   * the operator can enable it, which is exactly what the UI tells them.
   * `GET /gsc/status` answers `configured: false` instead of erroring, so the
   * SPA can render setup guidance without provoking this.
   */
  gsc_not_configured: 409,
  /** This project has no `gsc_connections` row — nobody has connected it yet. */
  gsc_not_connected: 409,
  /** Connected, but no Search Console property picked yet (property is ""). */
  gsc_no_property: 409,
  /**
   * Google refused our refresh token (`invalid_grant`): the user revoked
   * access, changed their password, or the grant expired. Not retryable and
   * not our bug — the only fix is reconnecting, so the UI shows that CTA.
   */
  gsc_reconnect_required: 409,
  /**
   * Google's API failed in a way that is neither a config problem nor a dead
   * grant. Their `error.message` is forwarded; nothing of ours is echoed back.
   */
  gsc_error: 502,
} as const;

export type ApiErrorCode = keyof typeof ERROR_STATUS;

/** GET /api/v1/health */
export interface HealthResponse {
  status: "ok";
  version: string;
}

/**
 * What a DataForSEO-backed response cost, attached to every such payload.
 *
 * The UI uses both halves: `cached` drives the "served from cache" affordance
 * and tells a user why a Refresh button exists, and `costUsd` is what the
 * spend hints on expensive actions reconcile against. Zero and `cached: true`
 * is the normal case for a repeated query.
 */
export interface ResultMeta {
  /** USD billed for this response. Always 0 when `cached` is true. */
  costUsd: number;
  cached: boolean;
  /**
   * True when this answer came from a cache entry that had already passed its
   * normal lifetime. Two paths set it: refreshing timed out upstream and the
   * old copy beat an error, or the caller asked for the old copy outright with
   * `stale=true` — the search-history flow, where reopening a past search must
   * cost $0. `cached` is true alongside it, so the pair reads as "from cache,
   * and older than we would normally serve". It is never set because a request
   * was merely slow, and never on a `fresh` request, which must fail rather
   * than quietly return the copy the caller paid to bypass.
   *
   * Optional and additive: absent and `false` mean the same thing, so every
   * response predating this field stays valid. Read it as `stale ?? false`.
   */
  stale?: boolean;
  /**
   * When the underlying DataForSEO payload was fetched from the wire, ISO 8601
   * UTC. On a cache hit this is the original fetch, not this request — it is
   * the date behind "Updated 3 days ago" next to a Refresh button. Nullable
   * because one endpoint (SERP) reports the provider's own crawl time, which
   * the provider can omit. Optional and additive like `stale`; endpoints not
   * yet threaded leave it absent.
   */
  fetchedAt?: string | null;
}

/** One DataForSEO endpoint's slice of a month's spend. */
export interface EndpointUsage {
  /** DataForSEO path, e.g. "keywords_data/google_ads/search_volume/live". */
  endpoint: string;
  requests: number;
  costUsd: number;
}

/** A workspace's DataForSEO spend over one UTC calendar month. */
export interface MonthlyUsage {
  totalUsd: number;
  requestCount: number;
  /** Share of requests served from cache, 0–1. Zero when there were none. */
  cacheHitRate: number;
  byEndpoint: EndpointUsage[];
}

/** GET /api/v1/usage?workspace=<id> */
export interface UsageResponse extends MonthlyUsage {
  /** ISO timestamp of the start of the reported month, in UTC. */
  periodStart: string;
}

/** GET /api/v1/usage/balance?workspace=<id> */
export interface BalanceResponse {
  /** Money left in the workspace's DataForSEO account. */
  balanceUsd: number;
  /** True when served from the 60-second micro-cache rather than the API. */
  cached: boolean;
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
