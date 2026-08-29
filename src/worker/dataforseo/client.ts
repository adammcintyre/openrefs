/**
 * The single door to DataForSEO. CLAUDE.md hard rule #4: nothing else in this
 * codebase may call their API directly, because everything that makes the call
 * safe lives behind this interface — auth, per-workspace cache isolation, cost
 * metering and the spend cap.
 *
 * Endpoint wrappers per API family (keywords_data, dataforseo_labs, backlinks,
 * on_page, serp, ai_optimization) are sibling files that consume this
 * interface — they never re-implement fetching.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "../../db";
import { apiUsage, getDb, workspaces } from "../../db";
import { ApiException } from "../http";
import { bytesToBase64 } from "../lib/crypto";
import { sha256Hex } from "../lib/crypto";
import { isOverCap, sumMonthCostUsd } from "./metering";

export const DFS_BASE_URL = "https://api.dataforseo.com/v3/";
/** Free dummy data. Tests and CI point `DFS_BASE_URL` here. */
export const DFS_SANDBOX_BASE_URL = "https://sandbox.dataforseo.com/v3/";

/** DataForSEO's "Ok", at both the envelope and the task level. */
export const DFS_OK_STATUS = 20000;

/**
 * Hard ceiling on one upstream call. Live Labs endpoints routinely take tens
 * of seconds; anything past a minute is a hung connection, not slow work. The
 * Workers CPU limit is unaffected — this is wall-clock on a network wait.
 */
export const REQUEST_TIMEOUT_MS = 60_000;

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

/**
 * Where a cached response may be read from and written to.
 *
 * `"workspace"` (the default, and the rule) keys under `ws:<id>:` so one
 * tenant never sees results another tenant paid for.
 *
 * `"global"` is the single documented exception from docs/specs/PHASE1.md:
 * DataForSEO's locations/languages *lists* cost $0 and are not tenant data —
 * they are the same public reference table for everyone — so caching them once
 * for the whole deployment saves every workspace re-fetching a 50k-row list.
 * Permitted only for `GLOBAL_CACHE_ENDPOINTS`; anything else throws.
 */
export type CacheScope = "workspace" | "global";

/**
 * The complete allowlist for `cacheScope: "global"`. Every entry must be a
 * zero-cost, non-tenant, read-only reference list — that is the whole
 * justification for stepping outside per-workspace isolation, so an endpoint
 * that bills, or that varies by who is asking, can never be added.
 *
 * Enforced by `assertGlobalCacheAllowed` at request time and pinned by
 * client.test.ts, which is the guard against this set quietly growing.
 */
export const GLOBAL_CACHE_ENDPOINTS: ReadonlySet<string> = new Set([
  "dataforseo_labs/locations_and_languages",
  "serp/google/locations",
  "serp/google/languages",
  "keywords_data/google_ads/locations",
  "keywords_data/google_ads/languages",
]);

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
  /**
   * DataForSEO's task endpoints are POST; the appendix/list endpoints are GET
   * with no body. Defaults to POST — the overwhelming majority.
   */
  method?: "GET" | "POST";
  /**
   * Defaults to `"workspace"`. See `CacheScope`; `"global"` is rejected for
   * any endpoint outside `GLOBAL_CACHE_ENDPOINTS`.
   */
  cacheScope?: CacheScope;
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
  /** Reuse a request-scoped Drizzle instance instead of building another. */
  db?: Db;
}

/* -------------------------------------------------------------------------- */
/* Cache keys                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * JSON with object keys sorted at every depth, so two payloads that differ
 * only in key order hash identically and share a cache entry.
 *
 * Array order is preserved: `[a, b]` and `[b, a]` are genuinely different
 * requests to DataForSEO (results come back in the order asked for), so they
 * must not collide. Callers that want order-insensitive keyword lists should
 * sort before calling — the wrappers do.
 *
 * The round-trip through `JSON.stringify`/`parse` first is what makes this
 * total: it applies `toJSON`, drops `undefined` object values and turns
 * `undefined` array holes into `null` exactly as the wire format will.
 */
export function canonicalJson(value: unknown): string {
  const plain: unknown = JSON.parse(JSON.stringify(value ?? null));
  return JSON.stringify(sortDeep(plain)) ?? "null";
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = sortDeep(source[key]);
    }
    return out;
  }
  return value;
}

/**
 * `ws:<workspaceId>:dfs:<endpoint>:<sha256 of the canonical payload>`.
 *
 * The workspace id is the first segment for two reasons that both matter:
 * results paid for by one tenant are never served to another, and deleting a
 * workspace is a `CACHE.list({ prefix: "ws:<id>:" })` sweep. The endpoint sits
 * in the key in the clear so a human reading KV can tell what a key is.
 */
export async function computeCacheKey(
  workspaceId: string,
  endpoint: string,
  payload: unknown,
): Promise<string> {
  const hash = await sha256Hex(canonicalJson(payload));
  return `ws:${workspaceId}:dfs:${endpoint}:${hash}`;
}

/**
 * `meta:dfs:<endpoint>:<sha256 of the canonical payload>` — the deployment-wide
 * key for allowlisted zero-cost reference lists.
 *
 * The `meta:` prefix is doing real work: it is deliberately *not* `ws:`, so the
 * workspace-deletion prefix sweep cannot touch it (nothing here belongs to a
 * tenant) and, conversely, a bug that routed tenant data here would be visible
 * as a key outside every workspace's namespace rather than hiding inside one.
 */
export async function computeGlobalCacheKey(
  endpoint: string,
  payload: unknown,
): Promise<string> {
  const hash = await sha256Hex(canonicalJson(payload));
  return `meta:dfs:${endpoint}:${hash}`;
}

/**
 * The gate on the exception. Called before any global-scope read or write, so
 * an endpoint that is not on the list cannot reach a shared cache key even if a
 * caller asks for one.
 *
 * @throws ApiException `internal_error` — reaching here is a programming
 *         mistake in a wrapper, not something a request can provoke.
 */
export function assertGlobalCacheAllowed(endpoint: string): void {
  if (GLOBAL_CACHE_ENDPOINTS.has(endpoint)) return;
  throw new ApiException(
    "internal_error",
    `Refusing to cache ${endpoint} globally: only zero-cost reference lists may leave the per-workspace cache namespace.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                 */
/* -------------------------------------------------------------------------- */

interface DfsTask<TResult> {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  result_count?: number;
  path?: string[];
  result?: TResult[] | null;
}

interface DfsEnvelope<TResult> {
  version?: string;
  status_code?: number;
  status_message?: string;
  /** Total charged for the whole request; the per-task `cost` sums to it. */
  cost?: number;
  tasks_count?: number;
  tasks_error?: number;
  tasks?: DfsTask<TResult>[] | null;
}

/** What we keep in KV. Versioned so the shape can change without stale reads. */
interface CacheEntry<TResult> {
  v: 1;
  results: TResult[];
  statusCode: number;
  statusMessage: string;
  cachedAt: number;
}

const CACHE_ENTRY_VERSION = 1;

/** `appendix/user_data` — only the field we actually consume. */
const userDataResultSchema = z.object({
  money: z
    .object({
      balance: z.number().optional(),
    })
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export function createDataForSeoClient(
  options: CreateClientOptions,
): DataForSeoClient {
  const { env, workspaceId, credentials } = options;
  const baseUrl = options.baseUrl ?? DFS_BASE_URL;
  const db = options.db ?? getDb(env.DB);

  // Built once per client. Basic auth is `base64(login:password)` over UTF-8 —
  // `btoa` alone would throw on a non-Latin-1 password.
  const authHeader = `Basic ${bytesToBase64(new TextEncoder().encode(`${credentials.login}:${credentials.password}`))}`;

  /**
   * One HTTP round trip. Everything above this line is policy; everything
   * inside it is the only place in OpenRefs that talks to DataForSEO.
   */
  async function call<TResult>(
    endpoint: string,
    method: "GET" | "POST",
    payload?: unknown,
  ): Promise<DfsEnvelope<TResult>> {
    const url = new URL(endpoint, baseUrl).toString();

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: method === "POST" ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ApiException(
          "upstream_timeout",
          `DataForSEO did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${endpoint}).`,
        );
      }
      // The underlying message is not forwarded — it can carry the request URL
      // and, on some runtimes, request headers.
      throw new ApiException(
        "upstream_error",
        `Could not reach DataForSEO (${endpoint}).`,
      );
    }

    let envelope: DfsEnvelope<TResult>;
    try {
      envelope = (await res.json()) as DfsEnvelope<TResult>;
    } catch {
      throw new ApiException(
        "upstream_error",
        `DataForSEO returned a non-JSON response (HTTP ${res.status}) for ${endpoint}.`,
      );
    }
    return envelope;
  }

  /** Every call, cached or not, leaves a row. Cache hits are recorded at 0. */
  async function meter(
    endpoint: string,
    costUsd: number,
    cached: boolean,
  ): Promise<void> {
    await db.insert(apiUsage).values({ workspaceId, endpoint, costUsd, cached });
  }

  /**
   * Step 3 of the order of operations: refuse before spending, never after.
   * Only reached on a cache miss — cached reads cost nothing and are always
   * allowed, including at a $0 cap.
   */
  async function assertWithinSpendCap(): Promise<void> {
    const rows = await db
      .select({ capUsd: workspaces.spendCapUsd })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new ApiException("not_found", "Workspace not found.");
    }

    const capUsd = row.capUsd;
    const spentUsd = await sumMonthCostUsd(db, workspaceId, new Date());
    if (!isOverCap(spentUsd, capUsd)) return;

    throw new ApiException(
      "spend_cap_exceeded",
      capUsd <= 0
        ? "This workspace's DataForSEO spend cap is $0, so paid requests are disabled. Raise the cap in workspace settings."
        : `Monthly DataForSEO spend cap reached: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)} used this month. Raise the cap in workspace settings.`,
      { spentUsd, capUsd },
    );
  }

  /**
   * Turns DataForSEO's own failure into ours. Their `status_message` is
   * included because it is the only actionable part ("Invalid Field:
   * location_code"); credentials never appear in it, and nothing from the
   * request is echoed back.
   */
  function upstreamError(
    endpoint: string,
    statusCode: number,
    statusMessage: string | undefined,
  ): ApiException {
    return new ApiException(
      "upstream_error",
      `DataForSEO ${endpoint} failed (${statusCode}): ${statusMessage ?? "no message"}`,
      { statusCode, endpoint },
    );
  }

  /** Throws unless the envelope and every task in it reported 20000. */
  function assertOk<TResult>(
    endpoint: string,
    envelope: DfsEnvelope<TResult>,
  ): void {
    const topStatus = envelope.status_code ?? 0;
    if (topStatus !== DFS_OK_STATUS) {
      throw upstreamError(endpoint, topStatus, envelope.status_message);
    }
    for (const task of envelope.tasks ?? []) {
      const taskStatus = task.status_code ?? 0;
      if (taskStatus !== DFS_OK_STATUS) {
        throw upstreamError(endpoint, taskStatus, task.status_message);
      }
    }
  }

  function flatten<TResult>(envelope: DfsEnvelope<TResult>): TResult[] {
    return (envelope.tasks ?? []).flatMap((task) => task.result ?? []);
  }

  return {
    async request<TResult = unknown, TPayload = unknown>(
      req: DataForSeoRequest<TPayload>,
    ): Promise<DataForSeoResponse<TResult>> {
      const {
        endpoint,
        payload,
        ttl,
        fresh = false,
        method = "POST",
        cacheScope = "workspace",
      } = req;
      const cacheable = ttl !== "none";
      const global = cacheScope === "global";

      // 0. The exception is checked before anything else touches a key, so an
      //    endpoint off the allowlist cannot read or write a shared entry.
      if (global) assertGlobalCacheAllowed(endpoint);

      // 1. Key from workspace + endpoint + canonical payload hash — or, for an
      //    allowlisted reference list, from endpoint + payload alone.
      const cacheKey = global
        ? await computeGlobalCacheKey(endpoint, payload)
        : await computeCacheKey(workspaceId, endpoint, payload);

      // 2. A hit costs nothing and skips the cap entirely.
      if (cacheable && !fresh) {
        const hit = await env.CACHE.get<CacheEntry<TResult>>(cacheKey, "json");
        if (hit && hit.v === CACHE_ENTRY_VERSION) {
          await meter(endpoint, 0, true);
          return {
            results: hit.results,
            costUsd: 0,
            cached: true,
            statusCode: hit.statusCode,
            statusMessage: hit.statusMessage,
          };
        }
      }

      // 3. Refuse before spending. Skipped for the allowlisted reference
      //    lists: DataForSEO bills them at $0, and a workspace sitting at its
      //    cap still has to be able to render a location picker. Same reasoning
      //    as `balance()` below, and equally narrow — the allowlist is the
      //    thing keeping it honest.
      if (!global) await assertWithinSpendCap();

      // 4. The call.
      const envelope = await call<TResult>(
        endpoint,
        method,
        method === "POST" ? payload : undefined,
      );

      // 5. Meter the real cost *before* interpreting the status: a task that
      //    errors is still billed, and an unrecorded spend is how a cap leaks.
      const costUsd = toFiniteNumber(envelope.cost);
      await meter(endpoint, costUsd, false);

      assertOk(endpoint, envelope);

      const results = flatten<TResult>(envelope);
      const first = (envelope.tasks ?? [])[0];
      const statusCode = first?.status_code ?? envelope.status_code ?? 0;
      const statusMessage =
        first?.status_message ?? envelope.status_message ?? "";

      // 6. Cache, unless this endpoint is in the "none" bucket.
      if (cacheable) {
        const entry: CacheEntry<TResult> = {
          v: CACHE_ENTRY_VERSION,
          results,
          statusCode,
          statusMessage,
          cachedAt: Date.now(),
        };
        await env.CACHE.put(cacheKey, JSON.stringify(entry), {
          expirationTtl: CACHE_TTL_SECONDS[ttl],
        });
      }

      return { results, costUsd, cached: false, statusCode, statusMessage };
    },

    async balance(): Promise<{ balanceUsd: number }> {
      const endpoint = "appendix/user_data";
      // Deliberately not spend-capped: DataForSEO bills this at $0, and a
      // capped workspace is exactly when someone needs to see their balance.
      // Still metered, so the usage report stays a complete record of calls.
      const envelope = await call<unknown>(endpoint, "GET");
      await meter(endpoint, toFiniteNumber(envelope.cost), false);
      assertOk(endpoint, envelope);

      const parsed = userDataResultSchema.safeParse(flatten(envelope)[0]);
      if (!parsed.success || parsed.data.money?.balance === undefined) {
        throw new ApiException(
          "upstream_error",
          "DataForSEO returned no account balance.",
        );
      }
      return { balanceUsd: parsed.data.money.balance };
    },
  };
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
