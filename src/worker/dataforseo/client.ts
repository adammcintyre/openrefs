/**
 * The single door to DataForSEO. CLAUDE.md hard rule #4: nothing else in this
 * codebase may call their API directly, because everything that makes the call
 * safe lives behind this interface — auth, per-workspace cache isolation, cost
 * metering and the spend cap.
 *
 * This file is a typed stub. It is owned by the DataForSEO agent, which
 * replaces `createDataForSeoClient` with a real implementation. Endpoint
 * wrappers per API family (keywords_data, dataforseo_labs, backlinks, on_page,
 * serp, ai_optimization) become sibling files that consume this interface —
 * they never re-implement fetching.
 */

export const DFS_BASE_URL = "https://api.dataforseo.com/v3/";
/** Free dummy data. Tests and CI point `DFS_BASE_URL` here. */
export const DFS_SANDBOX_BASE_URL = "https://sandbox.dataforseo.com/v3/";

/**
 * Cache lifetimes from docs/ARCHITECTURE.md, in seconds, passed to KV as
 * `expirationTtl`. Keys are `ws:<workspaceId>:dfs:<endpoint-hash>` — the
 * workspace prefix is what keeps one tenant's paid results out of another's,
 * and what makes workspace deletion a prefix sweep.
 */
export const CACHE_TTL_SECONDS = {
  /** Search volume, keyword ideas, historical/timeseries endpoints. */
  long: 30 * 24 * 60 * 60,
  /** Related keywords, suggestions. */
  medium: 14 * 24 * 60 * 60,
  /** Labs SERPs, ranked keywords, domain overviews, backlink summaries. */
  short: 7 * 24 * 60 * 60,
  /** Live SERP refreshes. */
  live: 24 * 60 * 60,
  /** Balance / user_data. Never cached. */
  none: 0,
} as const;

export type CacheTtl = keyof typeof CACHE_TTL_SECONDS;

export interface DataForSeoCredentials {
  login: string;
  password: string;
}

export interface DataForSeoRequest<TPayload = unknown> {
  /** Path below the base URL, e.g. "keywords_data/google_ads/search_volume/live". */
  endpoint: string;
  /** DataForSEO takes an array of task objects; pass the tasks, not the array. */
  payload: TPayload[];
  /** Which TTL bucket this endpoint falls into. */
  ttl: CacheTtl;
  /** Bypass a cache hit but still write the fresh response back. */
  fresh?: boolean;
}

export interface DataForSeoResponse<TResult = unknown> {
  /** Parsed `tasks[].result`, flattened. */
  results: TResult[];
  /** USD reported by the API. Zero when served from cache. */
  costUsd: number;
  cached: boolean;
  /** DataForSEO's own status for the first task, kept for diagnostics. */
  statusCode: number;
  statusMessage: string;
}

export interface DataForSeoClient {
  /**
   * Runs one request end to end: cache lookup, spend-cap check, HTTP Basic
   * call, `api_usage` write, cache write. Throws ApiException with code
   * `spend_cap_exceeded` when the workspace is over its cap, and
   * `upstream_error` when DataForSEO returns a non-20000 status.
   */
  request<TResult = unknown, TPayload = unknown>(
    req: DataForSeoRequest<TPayload>,
  ): Promise<DataForSeoResponse<TResult>>;

  /** Account balance passthrough (`appendix/user_data`). Never cached. */
  balance(): Promise<{ balanceUsd: number }>;
}

export interface CreateClientOptions {
  env: Env;
  /** Scopes cache keys and `api_usage` rows. Required — there is no global cache. */
  workspaceId: string;
  /**
   * Resolved per workspace: decrypted from `workspaces.dfs_*_enc`, falling
   * back to DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD from .dev.vars in dev.
   */
  credentials: DataForSeoCredentials;
  /** Defaults to DFS_BASE_URL; tests pass DFS_SANDBOX_BASE_URL. */
  baseUrl?: string;
}

export function createDataForSeoClient(
  _options: CreateClientOptions,
): DataForSeoClient {
  // TODO(dataforseo): implement. Order of operations matters —
  //   1. build the cache key from workspaceId + endpoint + a hash of payload
  //   2. unless `fresh`, return a KV hit as { costUsd: 0, cached: true }
  //   3. sum api_usage for the current period and refuse if over spend cap
  //   4. fetch with `Authorization: Basic base64(login:password)`
  //   5. write api_usage (real cost, cached: false) even when the task errors
  //   6. write KV with CACHE_TTL_SECONDS[ttl], skipping ttl === "none"
  throw new Error("DataForSEO client is not implemented yet.");
}
