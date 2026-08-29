/**
 * `serp/google/organic/live/advanced` — a real Google SERP, fetched now.
 *
 * Shapes verified against https://docs.dataforseo.com/v3/serp/google/organic/
 * live/advanced/ (2026-08-29). The things worth knowing before touching this:
 *
 *  - This is the most expensive endpoint in Phase 1 and the only one whose TTL
 *    is measured in hours. Billing is per 10 results, so `depth: 20` is two
 *    SERPs' worth of charge, not one.
 *  - `result[0]` is a wrapper, like the Labs endpoints, but with a different
 *    field set — `item_types` on it is the list of SERP features present,
 *    which is exactly the "SERP feature list" the UI wants and is far more
 *    reliable than inferring features from the items we kept.
 *  - `position` is the column ("left"/"right"), NOT the rank. Rank is
 *    `rank_group` / `rank_absolute`. Same trap as ranked_keywords.
 *  - The `is_featured_snippet` / `is_video` / `is_image` booleans are
 *    documented as no longer populated; the live signal is the `checks` array.
 *    Nothing here reads the deprecated booleans.
 */
import { z } from "zod";

import { ApiException } from "../http";
import type { DataForSeoClient, DataForSeoTask } from "./client";
import {
  DFS_TASK_CREATED_STATUS,
  DFS_TASK_HANDED_STATUS,
  DFS_TASK_IN_QUEUE_STATUS,
} from "./client";
import type { WrappedMeta } from "./schema";
import { nullableNumber, nullableString } from "./schema";

export const GOOGLE_ORGANIC_LIVE_ADVANCED = "serp/google/organic/live/advanced";

/** Documented ceiling on `depth`. Default is 10; billing is per 10 results. */
export const SERP_MAX_DEPTH = 200;

/** What the Phase 1 SERP panel shows. Two SERPs' worth of charge. */
export const SERP_DEFAULT_DEPTH = 20;

export const SERP_DEVICES = ["desktop", "mobile"] as const;
export type SerpDevice = (typeof SERP_DEVICES)[number];

const paramsSchema = z.object({
  keyword: z.string().trim().min(1).max(700),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  depth: z.number().int().min(1).max(SERP_MAX_DEPTH).optional(),
  device: z.enum(SERP_DEVICES).optional(),
  /** Bypass a cache hit and pay for a fresh SERP. The "Refresh" button. */
  fresh: z.boolean().optional(),
});

export type OrganicSerpParams = z.input<typeof paramsSchema>;

const serpItemSchema = z.object({
  type: nullableString,
  /** The rank among items of the same type. */
  rank_group: nullableNumber,
  /** The rank among every element on the page. */
  rank_absolute: nullableNumber,
  domain: nullableString,
  title: nullableString,
  url: nullableString,
  description: nullableString,
  breadcrumb: nullableString,
  website_name: nullableString,
  /** SERP page number this item appeared on. */
  page: nullableNumber,
});

const serpResultSchema = z.object({
  keyword: nullableString,
  check_url: nullableString,
  datetime: nullableString,
  /** Every SERP feature type present on the page. The feature-chip source. */
  item_types: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  se_results_count: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v) => (v === null || v === undefined ? null : Number(v))),
  items_count: nullableNumber,
  items: z
    .array(z.unknown())
    .nullish()
    .transform((v) => v ?? []),
});

export interface OrganicSerpItem {
  /** `rank_group` — the organic ranking. */
  position: number | null;
  /** `rank_absolute` — counting every SERP element, features included. */
  positionAbsolute: number | null;
  title: string | null;
  url: string | null;
  domain: string | null;
  description: string | null;
  breadcrumb: string | null;
  raw: unknown;
}

export interface OrganicSerpResult extends WrappedMeta {
  keyword: string | null;
  /** The Google URL this was read from — the "see it yourself" link. */
  checkUrl: string | null;
  /** When DataForSEO fetched the SERP. */
  fetchedAt: string | null;
  /** Every feature type on the page, e.g. ["organic","people_also_ask"]. */
  serpFeatures: string[];
  /**
   * Google's own "about N results". A string on the wire often enough to be
   * worth coercing rather than trusting.
   */
  totalResults: number | null;
  /** Organic rows only, in rank order. */
  items: OrganicSerpItem[];
}

/* -------------------------------------------------------------------------- */
/* Standard-queue task flow (rank tracking)                                    */
/* -------------------------------------------------------------------------- */

/*
 * Rank tracking does NOT use the live endpoint above. Checking 100 keywords a
 * day live would cost $2 a day per project; the standard task queue is the
 * same SERP for a tenth of that, at the price of asking for it now and
 * collecting it a few minutes later. Everything below implements that trade.
 *
 * Verified against https://docs.dataforseo.com/v3/serp/google/organic/
 * task_post/, .../tasks_ready/ and .../task_get/advanced/ (2026-08-29). Four
 * things here are counter-intuitive enough to be worth stating plainly:
 *
 *  1. A successful `task_post` reports **20100**, not 20000, on each task.
 *     Only the envelope says 20000.
 *  2. `task_post` returns `result: null` — the task **id** on the task
 *     envelope is the entire payload, which is why the client had to start
 *     exposing `tasks[]`.
 *  3. `task_get/**regular**` returns only `organic`, `paid` and
 *     `featured_snippet` item types, so its `item_types` is NOT the SERP
 *     feature list. Snapshots record SERP features, so this uses **advanced**.
 *     Both are free; the spec's "task_get/regular" predates that detail.
 *  4. Collecting is free ("you can get the results of the task within the next
 *     30 days for free") and so is `tasks_ready`. Only the post is billed,
 *     which is why the spend cap gates posting and must not gate collection.
 */

export const GOOGLE_ORGANIC_TASK_POST = "serp/google/organic/task_post";
export const GOOGLE_ORGANIC_TASKS_READY = "serp/google/organic/tasks_ready";

/**
 * The family label `task_get` calls are metered under.
 *
 * Without it every task id becomes its own `api_usage.endpoint` value and the
 * usage report's by-endpoint grouping degenerates into one row per SERP.
 */
export const GOOGLE_ORGANIC_TASK_GET = "serp/google/organic/task_get/advanced";

/** `task_get/advanced/<id>`. See note 3 above for why not `regular`. */
export function googleOrganicTaskGetEndpoint(taskId: string): string {
  return `${GOOGLE_ORGANIC_TASK_GET}/${encodeURIComponent(taskId)}`;
}

/**
 * Documented ceiling on one `task_post` call: "each POST call containing no
 * more than 100 tasks", enforced upstream as error 40006.
 */
export const SERP_TASK_POST_MAX_TASKS = 100;

/** Longest `tag` DataForSEO accepts. Ours is a tracked-keyword uuid (36). */
export const SERP_TAG_MAX_LENGTH = 255;

/**
 * Depth for a rank check: the top 100 organic results.
 *
 * This is the number that defines what a `null` position *means* in
 * `rank_snapshots` — "not in the top 100" — so changing it changes the data's
 * meaning, not just its price.
 */
export const RANK_TRACKING_DEPTH = 100;

/**
 * Base price of one standard-queue Google Organic SERP, USD, covering **10
 * results**. Depth multiplies it: "Multiply for each 10 search engine
 * results."
 */
export const SERP_TASK_PRICE_PER_10_RESULTS_USD = 0.0006;

/**
 * Where the price came from, so the next person can re-check it rather than
 * trust a constant.
 *
 * https://dataforseo.com/pricing/google-serp/google-organic-serp-api —
 * standard queue $0.0006/SERP, priority queue $0.0012, live $0.002, each
 * covering 10 results and multiplied per extra 10.
 *
 * **This changed on 2025-09-19.** The base price used to cover ~100 results;
 * it now covers 10, so depth 100 costs 10× the headline figure. DataForSEO's
 * older /apis/serp-api/pricing page still carries the pre-2025 wording and is
 * stale. Their own worked example for the current model:
 * "Standard method, Normal priority queue: $0.0006 х 10 = $0.006"
 * (https://dataforseo.com/help-center/serp-api-pricing-depth-update-faq).
 */
export const RANK_TASK_PRICE_SOURCE =
  "https://dataforseo.com/pricing/google-serp/google-organic-serp-api";

/** What one keyword's check costs at `RANK_TRACKING_DEPTH`. */
export const RANK_TASK_PRICE_USD =
  SERP_TASK_PRICE_PER_10_RESULTS_USD * (RANK_TRACKING_DEPTH / 10);

/**
 * "Task Not Found." and "Results Expired." — the two outcomes that will never
 * become a result no matter how long the collector waits, so they are dropped
 * rather than retried.
 */
export const DFS_TASK_NOT_FOUND_STATUS = 40401;
export const DFS_RESULTS_EXPIRED_STATUS = 40403;

const taskRequestSchema = z.object({
  keyword: z.string().trim().min(1).max(700),
  locationCode: z.number().int().positive(),
  languageCode: z.string().trim().min(2).max(8),
  device: z.enum(SERP_DEVICES).optional(),
  /** Our correlation handle. See `SERP_TAG_MAX_LENGTH`. */
  tag: z.string().trim().min(1).max(SERP_TAG_MAX_LENGTH),
});

export type OrganicTaskRequest = z.input<typeof taskRequestSchema>;

/** One task DataForSEO accepted and is now working on. */
export interface PostedTask {
  /** Opaque. UUID-shaped but not a UUID — never validate it as one. */
  id: string;
  /**
   * Position in the submitted batch. The fallback correlation handle for the
   * rare accepted task whose `tag` echo is missing — `tasks[]` comes back in
   * submission order, so the index still identifies the keyword.
   */
  index: number;
  /** Echoed from `data.tag`; null if the echo was missing. */
  tag: string | null;
  costUsd: number;
}

/** One task DataForSEO refused, kept so the caller can say which keyword. */
export interface RejectedTask {
  /** Position in the submitted batch — the only handle a refusal carries. */
  index: number;
  statusCode: number;
  statusMessage: string;
}

export interface TaskPostResult extends WrappedMeta {
  accepted: PostedTask[];
  rejected: RejectedTask[];
}

/** One entry of `tasks_ready`. */
export interface ReadyTask {
  id: string;
  tag: string | null;
  /** DataForSEO's `date_posted`, their format: "2019-11-08 13:54:43 +00:00". */
  datePosted: string | null;
}

export interface TasksReadyResult extends WrappedMeta {
  tasks: ReadyTask[];
}

/**
 * The three states a `task_get` can be in. Modelled explicitly because
 * "pending" is the normal case for the first few minutes and is emphatically
 * not an error.
 */
export type TaskGetOutcome =
  | { state: "ready"; tag: string | null; serp: OrganicSerpResult }
  | { state: "pending"; statusCode: number; statusMessage: string }
  | { state: "gone"; statusCode: number; statusMessage: string };

export interface SerpApi {
  googleOrganicLiveAdvanced(
    params: OrganicSerpParams,
  ): Promise<OrganicSerpResult>;
  /**
   * Posts up to `SERP_TASK_POST_MAX_TASKS` tasks in one billed call. Rejects
   * larger batches rather than silently truncating — losing keywords quietly
   * is how a rank chart grows a hole nobody notices.
   */
  googleOrganicTaskPost(
    tasks: readonly OrganicTaskRequest[],
  ): Promise<TaskPostResult>;
  /** Free. Which of this account's tasks have finished. */
  googleOrganicTasksReady(): Promise<TasksReadyResult>;
  /** Free. The finished SERP, or why it is not finished. */
  googleOrganicTaskGet(taskId: string): Promise<TaskGetOutcome>;
}

export function createSerpApi(client: DataForSeoClient): SerpApi {
  return {
    async googleOrganicLiveAdvanced(params) {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        throw new ApiException(
          "validation_failed",
          `Invalid SERP request (depth must be 1–${SERP_MAX_DEPTH}).`,
          z.flattenError(parsed.error),
        );
      }
      const { keyword, locationCode, languageCode, depth, device, fresh } =
        parsed.data;

      const response = await client.request<unknown>({
        endpoint: GOOGLE_ORGANIC_LIVE_ADVANCED,
        payload: [
          {
            keyword: keyword.toLowerCase(),
            location_code: locationCode,
            language_code: languageCode,
            depth: depth ?? SERP_DEFAULT_DEPTH,
            device: device ?? "desktop",
          },
        ],
        // A live SERP is a snapshot of a moving thing; ARCHITECTURE.md caps it
        // at 24h, and `fresh` is how the Refresh button pays to skip that.
        ttl: "live",
        fresh,
      });

      return toOrganicSerpResult(
        GOOGLE_ORGANIC_LIVE_ADVANCED,
        response.results[0],
        { costUsd: response.costUsd, cached: response.cached },
      );
    },

    async googleOrganicTaskPost(tasks) {
      if (tasks.length === 0 || tasks.length > SERP_TASK_POST_MAX_TASKS) {
        throw new ApiException(
          "validation_failed",
          `A SERP task_post carries 1–${SERP_TASK_POST_MAX_TASKS} tasks; got ${tasks.length}.`,
        );
      }

      const payload = tasks.map((task, index) => {
        const parsed = taskRequestSchema.safeParse(task);
        if (!parsed.success) {
          throw new ApiException(
            "validation_failed",
            `Invalid SERP task at index ${index}.`,
            z.flattenError(parsed.error),
          );
        }
        const { keyword, locationCode, languageCode, device, tag } = parsed.data;
        return {
          keyword: keyword.toLowerCase(),
          location_code: locationCode,
          language_code: languageCode,
          device: device ?? "desktop",
          depth: RANK_TRACKING_DEPTH,
          /*
           * Explicit rather than defaulted. `priority: 1` is the standard
           * queue — the whole reason this flow exists — and 2 costs exactly
           * double, so leaving it implicit puts a 2× price rise one upstream
           * default-change away.
           */
          priority: 1,
          tag,
        };
      });

      const response = await client.request<unknown>({
        endpoint: GOOGLE_ORGANIC_TASK_POST,
        payload,
        // Task results live in D1, not KV, and a task id is a one-shot handle:
        // re-serving a cached one would hand back a SERP we already collected.
        ttl: "none",
        // A created task reports 20100. Without this every success throws.
        okTaskStatusCodes: [DFS_TASK_CREATED_STATUS],
      });

      const accepted: PostedTask[] = [];
      const rejected: RejectedTask[] = [];

      response.tasks.forEach((task, index) => {
        if (task.id !== null && isCreated(task)) {
          accepted.push({
            id: task.id,
            index,
            tag: readTag(task),
            costUsd: task.costUsd,
          });
          return;
        }
        // A per-task refusal (a bad location code, say) does not fail the
        // batch: the other 99 keywords were posted and paid for.
        rejected.push({
          index,
          statusCode: task.statusCode,
          statusMessage: task.statusMessage,
        });
      });

      return {
        accepted,
        rejected,
        costUsd: response.costUsd,
        cached: response.cached,
      };
    },

    async googleOrganicTasksReady() {
      const response = await client.request<unknown>({
        endpoint: GOOGLE_ORGANIC_TASKS_READY,
        // GET, so nothing is sent.
        payload: [],
        method: "GET",
        ttl: "none",
        // Free, and exempt so a workspace at its cap can still collect SERPs
        // it has already paid for.
        spendCapExempt: true,
        resultsPrepaid: true,
      });

      const tasks: ReadyTask[] = [];
      for (const raw of response.results) {
        const parsed = readyTaskSchema.safeParse(raw);
        if (!parsed.success || parsed.data.id === null) continue;
        tasks.push({
          id: parsed.data.id,
          tag: parsed.data.tag,
          datePosted: parsed.data.date_posted,
        });
      }

      return { tasks, costUsd: response.costUsd, cached: response.cached };
    },

    async googleOrganicTaskGet(taskId) {
      const endpoint = googleOrganicTaskGetEndpoint(taskId);
      const response = await client.request<unknown>({
        endpoint,
        payload: [],
        method: "GET",
        ttl: "none",
        spendCapExempt: true,
        resultsPrepaid: true,
        // The id stays in the URL; the meter records the family.
        meterAs: GOOGLE_ORGANIC_TASK_GET,
        // "Task Handed" / "Task In Queue" are the normal answer while the
        // standard queue works; they must not raise.
        okTaskStatusCodes: [
          DFS_TASK_HANDED_STATUS,
          DFS_TASK_IN_QUEUE_STATUS,
          DFS_TASK_NOT_FOUND_STATUS,
          DFS_RESULTS_EXPIRED_STATUS,
        ],
      });

      const task = response.tasks[0];
      const statusCode = task?.statusCode ?? response.statusCode;
      const statusMessage = task?.statusMessage ?? response.statusMessage;

      if (
        statusCode === DFS_TASK_HANDED_STATUS ||
        statusCode === DFS_TASK_IN_QUEUE_STATUS
      ) {
        return { state: "pending", statusCode, statusMessage };
      }
      if (
        statusCode === DFS_TASK_NOT_FOUND_STATUS ||
        statusCode === DFS_RESULTS_EXPIRED_STATUS
      ) {
        // Nothing will ever come back for this id. Saying so lets the
        // collector drop it instead of polling a ghost for 24 hours.
        return { state: "gone", statusCode, statusMessage };
      }

      return {
        state: "ready",
        tag: task === undefined ? null : readTag(task),
        serp: toOrganicSerpResult(endpoint, response.results[0], {
          costUsd: response.costUsd,
          cached: response.cached,
        }),
      };
    },
  };
}

const readyTaskSchema = z.object({
  id: nullableString,
  tag: nullableString,
  date_posted: nullableString,
});

/** True for the one per-task status that means "accepted onto the queue". */
function isCreated(task: DataForSeoTask): boolean {
  return (
    task.statusCode === DFS_TASK_CREATED_STATUS || task.statusCode === 20000
  );
}

/** `data.tag`, when the echo is present and a string. */
function readTag(task: DataForSeoTask): string | null {
  const tag = task.data?.["tag"];
  return typeof tag === "string" ? tag : null;
}

/**
 * `result[0]` to our shape. Shared by the live endpoint and `task_get`: the
 * advanced task result is documented with the same result fields, which is
 * what lets one parser serve both and one snapshot writer trust either.
 */
function toOrganicSerpResult(
  endpoint: string,
  raw: unknown,
  meta: WrappedMeta,
): OrganicSerpResult {
  const result = serpResultSchema.safeParse(raw);
  if (!result.success) {
    throw new ApiException(
      "upstream_error",
      `DataForSEO ${endpoint} returned an unrecognised result shape.`,
    );
  }
  const data = result.data;

  return {
    keyword: data.keyword,
    checkUrl: data.check_url,
    fetchedAt: data.datetime,
    serpFeatures: data.item_types,
    totalResults: data.se_results_count,
    items: pickOrganic(data.items),
    costUsd: meta.costUsd,
    cached: meta.cached,
  };
}

/**
 * Organic rows, in rank order.
 *
 * The response interleaves features (people_also_ask, video carousels, ads)
 * with the organic results, so filtering by `type` is what makes "position 3"
 * mean the third organic result rather than the third thing on the page. The
 * full feature list is still reported separately as `serpFeatures`, so nothing
 * is lost by dropping the feature rows here.
 */
function pickOrganic(items: readonly unknown[]): OrganicSerpItem[] {
  const organic: OrganicSerpItem[] = [];
  for (const raw of items) {
    const parsed = serpItemSchema.safeParse(raw);
    // A malformed row is one missing result, not a failed (paid) request.
    if (!parsed.success) continue;
    const item = parsed.data;
    if (item.type !== "organic") continue;
    organic.push({
      position: item.rank_group,
      positionAbsolute: item.rank_absolute,
      title: item.title,
      url: item.url,
      domain: item.domain,
      description: item.description,
      breadcrumb: item.breadcrumb,
      raw,
    });
  }
  return organic.sort(byPosition);
}

function byPosition(a: OrganicSerpItem, b: OrganicSerpItem): number {
  // Nulls last: a row with no rank is not a rank-zero row.
  if (a.position === null) return b.position === null ? 0 : 1;
  if (b.position === null) return -1;
  return a.position - b.position;
}
