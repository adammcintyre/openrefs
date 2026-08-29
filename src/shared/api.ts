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
} as const;

export type ApiErrorCode = keyof typeof ERROR_STATUS;

/** GET /api/v1/health */
export interface HealthResponse {
  status: "ok";
  version: string;
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
