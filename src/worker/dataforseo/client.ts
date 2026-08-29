/**
 * The single door to DataForSEO. CLAUDE.md hard rule #4: nothing else in this
 * codebase may call their API directly, because everything that makes the call
 * safe lives behind this interface — auth, per-workspace cache isolation, cost
 * metering and the spend cap.
 *
 * Endpoint wrappers per API family (keywords_data, dataforseo_labs, backlinks,
 * on_page, serp, ai_optimization) are sibling files that consume this
 * interface — they never re-implement fetching.
 *
 * **Caching is stale-if-error.** Entries are written without a KV
 * `expirationTtl`; the TTL travels in the payload as `softExpiresAt`, so a
 * soft-expired entry is still on disk when DataForSEO stops answering and can
 * be served with `stale: true` rather than becoming an error page. See
 * `CACHE_MAX_AGE_MS` for what bounds stored lifetime in KV's place, and the
 * `catch` around the call for the single failure it may absorb.
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
 * "Task Created." — the per-task status a successful `task_post` returns.
 *
 * The envelope still says 20000; only `tasks[].status_code` is 20100. Verified
 * against https://docs.dataforseo.com/v3/appendix/errors/ (2026-08-29). Without
 * `okTaskStatusCodes` accepting this, `assertOk` rejects every task that was
 * created perfectly well — and, because metering happens first, after paying
 * for it.
 */
export const DFS_TASK_CREATED_STATUS = 20100;

/**
 * "Task Handed." / "Task In Queue." — a `task_get` for work that has not
 * finished yet. Not failures: the standard queue answers with these for the
 * few minutes between posting and completion, and the collector's whole job is
 * to come back later.
 */
export const DFS_TASK_HANDED_STATUS = 40601;
export const DFS_TASK_IN_QUEUE_STATUS = 40602;

/**
 * "Task Not Found." and "Results Expired." — the two `task_get` outcomes that
 * will never become a result no matter how long a collector waits, so callers
 * drop them rather than retrying.
 *
 * They live here, beside the other task-queue codes, because every family with
 * a task flow needs them: SERP rank collection and OnPage audits both do, and
 * defining them twice made `export *` from index.ts ambiguous.
 */
export const DFS_TASK_NOT_FOUND_STATUS = 40401;
export const DFS_RESULTS_EXPIRED_STATUS = 40403;

/**
 * Per-attempt ceilings on one upstream connection. Two distinct failure modes
 * observed in production (2026-08): a hung connection that a fresh attempt
 * beats in under a second (search_volume), and an endpoint that legitimately
 * computes for 30–60s on a cold target (backlinks/summary). A short first
 * attempt catches the former without burning a minute; a patient second
 * attempt accommodates the latter. Wall-clock on a network wait — the Workers
 * CPU limit is unaffected.
 */
export const ATTEMPT_TIMEOUTS_MS = [20_000, 60_000] as const;

/**
 * The ladder for an endpoint that is *expected* to take minutes and is billed
 * whether or not we are still listening: **one attempt, no retry**.
 *
 * DataForSEO's AI Optimization live endpoints are documented at "up to 120
 * seconds" — a language model is thinking and, with `web_search` on, fetching
 * pages first. Under the default ladder the first attempt would abort at 20s
 * and the second would re-ask; but unlike a hung `search_volume`, that first
 * request is *working*, and re-asking buys a second answer at full price. So
 * this ladder waits past their ceiling and gives up rather than retrying: a
 * missing answer is one empty cell in a chart, a duplicate one is real money.
 */
export const PATIENT_ATTEMPT_TIMEOUTS_MS = [130_000] as const;

/**
 * Cache lifetimes from docs/ARCHITECTURE.md, in seconds. Keys are
 * `ws:<workspaceId>:dfs:<endpoint-hash>` — the workspace prefix is what keeps
 * one tenant's paid results out of another's, and what makes workspace
 * deletion a prefix sweep.
 *
 * **These are SOFT lifetimes, carried in the payload as `softExpiresAt`, not
 * KV `expirationTtl`.** See `CACHE_MAX_AGE_MS` for why, and for what bounds
 * the stored lifetime instead.
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
 * The hard ceiling on how long a cache entry may sit in KV, enforced by
 * deleting it when a read finds it older than this.
 *
 * Entries are written **without** `expirationTtl`, which is what makes
 * stale-if-error possible at all: KV cannot hand back an entry it has already
 * evicted, so an expired-by-KV entry is simply gone at the moment we most want
 * it — when DataForSEO is not answering. Keeping the bytes and expiring them
 * *logically* (`softExpiresAt`) means a soft-expired entry is still there to
 * fall back on.
 *
 * The cost of that is unbounded storage, which this constant bounds: any entry
 * read after 90 days is deleted rather than served or refreshed in place. It is
 * opportunistic on purpose — an entry nobody ever reads again is not worth a
 * sweep, and workspace deletion clears the whole `ws:<id>:` prefix regardless.
 * 90 days is comfortably past the longest TTL bucket (30 days), so no entry is
 * ever dropped while it could still have been served fresh.
 */
export const CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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
  /**
   * Per-task status codes to accept besides 20000.
   *
   * The task queue speaks in codes that are not failures: `task_post` reports
   * 20100 "Task Created." on success, and `task_get` reports 40601/40602 while
   * the SERP is still being fetched. A wrapper that expects those passes them
   * here and classifies them itself; everything else still throws.
   */
  okTaskStatusCodes?: readonly number[];
  /**
   * Endpoint label to record in `api_usage`, when the real path is not one.
   *
   * `task_get` puts the task id in the URL, so metering the path verbatim
   * would write a distinct `endpoint` value per task — turning the usage
   * report's by-endpoint grouping into thousands of one-row groups and hiding
   * what was actually spent. The label is the family (`.../task_get/advanced`)
   * and the id stays in the URL where it belongs.
   */
  meterAs?: string;
  /**
   * Skip the spend-cap check for an endpoint DataForSEO bills at $0.
   *
   * The only sanctioned use is retrieving results that have **already been paid
   * for** — `tasks_ready` and `task_get`. A workspace that posts tasks and then
   * reaches its cap must still be able to collect them; blocking that would
   * throw away money already spent while protecting nothing, since these calls
   * cannot themselves spend. Same reasoning as `balance()`, and equally narrow.
   *
   * It does not skip metering: every call still writes an `api_usage` row with
   * whatever cost the API reported, so an endpoint that unexpectedly starts
   * billing shows up in the usage report rather than hiding here.
   */
  spendCapExempt?: boolean;
  /**
   * Per-attempt timeouts for this endpoint, overriding `ATTEMPT_TIMEOUTS_MS`.
   *
   * The array's length is the attempt count, so a single-element ladder is
   * also how a caller says "do not retry this" — which is the right answer for
   * anything slow and billed. See `PATIENT_ATTEMPT_TIMEOUTS_MS`.
   */
  timeoutsMs?: readonly number[];
  /**
   * The spend for this call was already metered when its task was POSTED —
   * any `cost` echoed on this response is informational, so it is recorded as
   * $0 to keep the meter equal to what DataForSEO actually bills. Their docs
   * state task retrieval is free, yet `task_get` echoes the task's original
   * price (observed live 2026-08-29: a $0.006 post echoed $0.006 again on
   * get, doubling recorded spend). Use ONLY on retrieval endpoints for
   * already-posted tasks; the usage row is still written.
   */
  resultsPrepaid?: boolean;
}

/**
 * One entry of `tasks[]`, kept because the task queue's identity lives here
 * and nowhere else: `task_post` returns `result: null` and puts the id — the
 * only handle on the SERP we just bought — on the task envelope. `flatten()`
 * would discard it.
 */
export interface DataForSeoTask {
  /**
   * DataForSEO's task id. UUID-*shaped* but not a UUID (the first segment
   * encodes MMDDHHMM), so it is an opaque string and must never be validated
   * as a UUID.
   */
  id: string | null;
  statusCode: number;
  statusMessage: string;
  costUsd: number;
  /**
   * The echo of what we sent, including `tag` — which is how a task id is
   * correlated back to the row that asked for it.
   */
  data: Record<string, unknown> | null;
}

export interface DataForSeoResponse<TResult = unknown> {
  /** Parsed `tasks[].result`, flattened. */
  results: TResult[];
  /**
   * The task envelopes, unflattened. Empty for a cache hit — nothing here is
   * persisted to KV, because a task id is a one-shot handle and re-serving a
   * stale one would be worse than useless. The task flows all use
   * `ttl: "none"`, so they never take that path.
   */
  tasks: DataForSeoTask[];
  /** USD reported by the API. Zero when served from cache. */
  costUsd: number;
  cached: boolean;
  /**
   * True only for a **soft-expired entry served because the refresh timed
   * out** — the stale-if-error path. `cached` is true alongside it; the pair
   * reads as "from cache, and older than we would normally serve".
   *
   * False for every ordinary cache hit, so a UI chip can say "cached · may be
   * outdated" exactly when that is true and not one request sooner.
   */
  stale: boolean;
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
  /** Echo of the posted task, `tag` included. Present on the task endpoints. */
  data?: Record<string, unknown> | null;
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

/**
 * What we keep in KV. Versioned so the shape can change without stale reads.
 *
 * v2 added `softExpiresAt` and dropped KV's own `expirationTtl` — see
 * `CACHE_MAX_AGE_MS`. v1 entries still in KV are read as fresh-until-KV-drops-
 * them, which is exactly what they are: they were written *with* an
 * `expirationTtl`, so KV is still enforcing their lifetime and nothing here
 * has to. They age out on their own and are never written again.
 */
interface CacheEntryV2<TResult> {
  v: 2;
  results: TResult[];
  statusCode: number;
  statusMessage: string;
  cachedAt: number;
  /** Epoch ms after which a read refreshes rather than serves this entry. */
  softExpiresAt: number;
}

interface CacheEntryV1<TResult> {
  v: 1;
  results: TResult[];
  statusCode: number;
  statusMessage: string;
  cachedAt: number;
}

type StoredCacheEntry<TResult> = CacheEntryV1<TResult> | CacheEntryV2<TResult>;

const CACHE_ENTRY_VERSION = 2;

/** A stored entry with its soft expiry resolved, whichever version it is. */
interface ReadCacheEntry<TResult> {
  results: TResult[];
  statusCode: number;
  statusMessage: string;
  cachedAt: number;
  softExpiresAt: number;
}

/**
 * Normalises whatever KV handed back, or null if it is not an entry we know.
 *
 * A v1 entry gets `softExpiresAt: Infinity`: KV is still enforcing its hard
 * TTL, so while it exists it is fresh. Anything else — a future version, a
 * hand-edited key, a partial write — reads as a miss rather than throwing on
 * a page view.
 */
export function readCacheEntry<TResult>(
  raw: unknown,
): ReadCacheEntry<TResult> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Partial<StoredCacheEntry<TResult>>;
  if (!Array.isArray(entry.results)) return null;
  if (typeof entry.cachedAt !== "number" || !Number.isFinite(entry.cachedAt)) {
    return null;
  }

  const base = {
    results: entry.results as TResult[],
    statusCode: typeof entry.statusCode === "number" ? entry.statusCode : 0,
    statusMessage:
      typeof entry.statusMessage === "string" ? entry.statusMessage : "",
    cachedAt: entry.cachedAt,
  };

  if (entry.v === 1) return { ...base, softExpiresAt: Number.POSITIVE_INFINITY };
  if (entry.v === 2) {
    const soft = (entry as CacheEntryV2<TResult>).softExpiresAt;
    if (typeof soft !== "number" || !Number.isFinite(soft)) return null;
    return { ...base, softExpiresAt: soft };
  }
  return null;
}

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
  /*
   * Egress relay (optional). DataForSEO throttles by source IP, and Cloudflare
   * Workers egress IPs are shared across many tenants — during someone else's
   * abuse window, every request from the Worker hangs while the same call is
   * instant from any other network (measured 2026-08-29). When DFS_PROXY_URL +
   * DFS_PROXY_TOKEN are configured, requests go to a tiny authenticated
   * forwarder on operator-controlled infrastructure with a clean IP instead of
   * directly to DataForSEO. The forwarder only accepts our token, only talks
   * to api.dataforseo.com/v3, and never stores credentials. Self-host default:
   * unset (direct). The relay carries the SAME Basic credentials in a header,
   * so trust in the relay host equals trust in the operator.
   */
  const proxyUrl = "DFS_PROXY_URL" in env ? (env as { DFS_PROXY_URL?: string }).DFS_PROXY_URL : undefined;
  const proxyToken = "DFS_PROXY_TOKEN" in env ? (env as { DFS_PROXY_TOKEN?: string }).DFS_PROXY_TOKEN : undefined;
  // Only relay traffic destined for the real API — sandbox/tests stay direct.
  const useProxy =
    typeof proxyUrl === "string" && proxyUrl !== "" &&
    typeof proxyToken === "string" && proxyToken !== "" &&
    baseUrl === DFS_BASE_URL;
  const basicCredentials = bytesToBase64(
    new TextEncoder().encode(`${credentials.login}:${credentials.password}`),
  );

  async function call<TResult>(
    endpoint: string,
    method: "GET" | "POST",
    payload?: unknown,
    timeouts: readonly number[] = ATTEMPT_TIMEOUTS_MS,
  ): Promise<DfsEnvelope<TResult>> {
    const url = useProxy
      ? (proxyUrl as string)
      : new URL(endpoint, baseUrl).toString();
    const requestHeaders: Record<string, string> = useProxy
      ? {
          "X-Relay-Token": proxyToken as string,
          "X-Dfs-Auth": basicCredentials,
          "X-Dfs-Path": `v3/${endpoint}`,
          "X-Dfs-Method": method,
          "Content-Type": "application/json",
        }
      : {
          Authorization: authHeader,
          "Content-Type": "application/json",
        };
    // The relay is always POSTed to (the upstream method rides in a header),
    // which also keeps intermediary caches out of the path.
    const wireMethod = useProxy ? "POST" : method;

    /*
     * Retrying is safe ONLY for attempts that produced no HTTP response: once
     * a response exists it may have been billed, so HTTP-level errors are
     * never retried. A hung-then-dropped attempt may still be billed upstream
     * without us seeing the cost — rare, fractions of a cent, and better than
     * a 60-second error page.
     */
    let res: Response | null = null;
    for (let attempt = 0; res === null; attempt++) {
      const attemptTimeout = timeouts[attempt];
      if (attemptTimeout === undefined) break;
      try {
        res = await fetch(url, {
          method: wireMethod,
          headers: requestHeaders,
          body: method === "POST" ? JSON.stringify(payload) : undefined,
          signal: AbortSignal.timeout(attemptTimeout),
        });
      } catch (err) {
        if (attempt < timeouts.length - 1) continue;
        const name = err instanceof Error ? err.name : "";
        if (name === "TimeoutError" || name === "AbortError") {
          const totalSeconds = timeouts.reduce((sum, ms) => sum + ms, 0) / 1000;
          throw new ApiException(
            "upstream_timeout",
            `DataForSEO didn't respond in time (${totalSeconds}s, ${timeouts.length} attempts). Their API occasionally slows for a few minutes for requests from cloud providers — it usually clears quickly, so try again shortly. Nothing was charged for this request.`,
            { endpoint },
          );
        }
        // The underlying message is not forwarded — it can carry the request
        // URL and, on some runtimes, request headers.
        throw new ApiException(
          "upstream_error",
          `Could not reach DataForSEO (${endpoint}).`,
        );
      }
    }
    if (res === null) {
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

  /**
   * Throws unless the envelope reported 20000 and every task reported 20000 or
   * one of the codes the caller declared expected (`okTaskStatusCodes`).
   */
  function assertOk<TResult>(
    endpoint: string,
    envelope: DfsEnvelope<TResult>,
    okTaskStatusCodes: readonly number[],
  ): void {
    const topStatus = envelope.status_code ?? 0;
    if (topStatus !== DFS_OK_STATUS) {
      throw upstreamError(endpoint, topStatus, envelope.status_message);
    }
    for (const task of envelope.tasks ?? []) {
      const taskStatus = task.status_code ?? 0;
      if (taskStatus === DFS_OK_STATUS) continue;
      if (okTaskStatusCodes.includes(taskStatus)) continue;
      throw upstreamError(endpoint, taskStatus, task.status_message);
    }
  }

  function flatten<TResult>(envelope: DfsEnvelope<TResult>): TResult[] {
    return (envelope.tasks ?? []).flatMap((task) => task.result ?? []);
  }

  /** The task envelopes, normalised. See `DataForSeoTask`. */
  function toTasks<TResult>(envelope: DfsEnvelope<TResult>): DataForSeoTask[] {
    return (envelope.tasks ?? []).map((task) => ({
      id: task.id ?? null,
      statusCode: task.status_code ?? 0,
      statusMessage: task.status_message ?? "",
      costUsd: toFiniteNumber(task.cost),
      data: task.data ?? null,
    }));
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
        okTaskStatusCodes = [],
        spendCapExempt = false,
        resultsPrepaid = false,
        timeoutsMs = ATTEMPT_TIMEOUTS_MS,
        meterAs,
      } = req;
      // The cache key still uses the real path — two task ids are two
      // different requests — but `api_usage` gets the stable family label.
      const meteredEndpoint = meterAs ?? endpoint;
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

      /*
       * 2. A hit costs nothing and skips the cap entirely.
       *
       * Three outcomes, not two, because entries outlive their TTL now:
       *   within the soft TTL  → serve it, done;
       *   past the soft TTL    → keep it as `stale` and refresh below, so a
       *                          refresh that times out still has something to
       *                          answer with;
       *   past CACHE_MAX_AGE_MS → delete it and treat the read as a miss.
       *
       * `fresh` skips this block entirely, which is what makes a Refresh
       * button honest: a fresh request that fails must fail, never quietly
       * hand back the copy the user just paid to bypass.
       */
      const readAt = Date.now();
      let stale: ReadCacheEntry<TResult> | null = null;
      if (cacheable && !fresh) {
        const hit = await env.CACHE.get<unknown>(cacheKey, "json");
        const entry = readCacheEntry<TResult>(hit);
        if (entry !== null) {
          if (readAt - entry.cachedAt > CACHE_MAX_AGE_MS) {
            // Best-effort: entries carry no expirationTtl, so this read is the
            // only thing that will ever remove it — but failing to tidy up is
            // not a reason to fail the request.
            await env.CACHE.delete(cacheKey).catch(() => undefined);
          } else if (readAt < entry.softExpiresAt) {
            await meter(meteredEndpoint, 0, true);
            return {
              results: entry.results,
              // Deliberately not cached: see `DataForSeoResponse.tasks`.
              tasks: [],
              costUsd: 0,
              cached: true,
              stale: false,
              statusCode: entry.statusCode,
              statusMessage: entry.statusMessage,
            };
          } else {
            stale = entry;
          }
        }
      }

      // 3. Refuse before spending. Skipped for the allowlisted reference
      //    lists: DataForSEO bills them at $0, and a workspace sitting at its
      //    cap still has to be able to render a location picker. Same reasoning
      //    as `balance()` below, and equally narrow — the allowlist is the
      //    thing keeping it honest. `spendCapExempt` extends it to collecting
      //    task results the workspace has already paid for.
      if (!global && !spendCapExempt) await assertWithinSpendCap();

      /*
       * 4. The call — and the one failure a stale entry may absorb.
       *
       * `upstream_timeout` ONLY. That code means the request never produced a
       * response, so nothing was charged and nothing about the workspace has
       * changed: yesterday's answer is strictly better than an error page.
       * Every other failure is a fact the caller must see —
       * `spend_cap_exceeded` (402) and `no_credentials` (409) are decisions
       * about this workspace that a cached row would hide, and an
       * `upstream_error` means DataForSEO answered and refused. Serving stale
       * on those would turn "you are over your cap" into "here is some data",
       * which is the wrong answer to a question about money.
       */
      let envelope: DfsEnvelope<TResult>;
      try {
        envelope = await call<TResult>(
          endpoint,
          method,
          method === "POST" ? payload : undefined,
          timeoutsMs,
        );
      } catch (err) {
        if (
          stale !== null &&
          err instanceof ApiException &&
          err.code === "upstream_timeout"
        ) {
          await meter(meteredEndpoint, 0, true);
          return {
            results: stale.results,
            tasks: [],
            costUsd: 0,
            cached: true,
            stale: true,
            statusCode: stale.statusCode,
            statusMessage: stale.statusMessage,
          };
        }
        throw err;
      }

      // 5. Meter the real cost *before* interpreting the status: a task that
      //    errors is still billed, and an unrecorded spend is how a cap leaks.
      //    Prepaid retrievals meter $0 — their cost was recorded at post time
      //    and the echoed figure would double-count (see `resultsPrepaid`).
      const costUsd = resultsPrepaid ? 0 : toFiniteNumber(envelope.cost);
      await meter(meteredEndpoint, costUsd, false);

      assertOk(endpoint, envelope, okTaskStatusCodes);

      const results = flatten<TResult>(envelope);
      const tasks = toTasks(envelope);
      const first = (envelope.tasks ?? [])[0];
      const statusCode = first?.status_code ?? envelope.status_code ?? 0;
      const statusMessage =
        first?.status_message ?? envelope.status_message ?? "";

      /*
       * 6. Cache, unless this endpoint is in the "none" bucket.
       *
       * **No `expirationTtl`.** The TTL travels inside the payload as
       * `softExpiresAt` instead, so a soft-expired entry is still on disk when
       * a refresh times out. `CACHE_MAX_AGE_MS`, checked on read, is what
       * bounds the stored lifetime in its place.
       */
      if (cacheable) {
        const writtenAt = Date.now();
        const entry: CacheEntryV2<TResult> = {
          v: CACHE_ENTRY_VERSION,
          results,
          statusCode,
          statusMessage,
          cachedAt: writtenAt,
          softExpiresAt: writtenAt + CACHE_TTL_SECONDS[ttl] * 1000,
        };
        await env.CACHE.put(cacheKey, JSON.stringify(entry));
      }

      return {
        results,
        tasks,
        costUsd,
        cached: false,
        stale: false,
        statusCode,
        statusMessage,
      };
    },

    async balance(): Promise<{ balanceUsd: number }> {
      const endpoint = "appendix/user_data";
      // Deliberately not spend-capped: DataForSEO bills this at $0, and a
      // capped workspace is exactly when someone needs to see their balance.
      // Still metered, so the usage report stays a complete record of calls.
      const envelope = await call<unknown>(endpoint, "GET");
      await meter(endpoint, toFiniteNumber(envelope.cost), false);
      assertOk(endpoint, envelope, []);

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
