/**
 * Turning Search Console rows into the module's four reports: the date window,
 * the KV cache, and the shaping.
 *
 * The cache is keyed on **the pull, not the report**, which is what lets
 * `/queries` and `/opportunities` share one Google call: both want the same
 * `dimensions: ["query"]` rows for the same window, and opening the
 * Opportunities tab after the Queries tab should cost nothing.
 */
import type {
  GscDailyPoint,
  GscDateRange,
  GscMetrics,
  GscPageRow,
  GscQueryRow,
} from "../../shared/gsc";
import {
  GSC_DATA_LAG_DAYS,
  GSC_DEFAULT_RANGE_DAYS,
  GSC_ROW_LIMIT,
} from "../../shared/gsc";
import { ApiException } from "../http";
import { sha256Hex } from "../lib/crypto";
import type { SearchAnalyticsRow } from "./api";
import { searchAnalyticsQuery } from "./api";
import type { GscQueryPageRow } from "./opportunities";

/** 24 hours. Search Console data for a finalised day does not change. */
export const GSC_CACHE_TTL_SECONDS = 24 * 60 * 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pacific Time's *maximum* offset from UTC, in hours.
 *
 * Search Console dates are documented as Pacific Time, not UTC. Assuming the
 * winter offset (UTC−8) year-round means the date computed here is either
 * correct or one day behind the real Pacific date — never ahead. Behind is the
 * safe direction: it can only make the window end a day earlier than it had to,
 * whereas being ahead would ask Google for a day it has not finalised and
 * silently return a short window. Not worth a timezone library for a value
 * that is then moved back two more days anyway.
 */
const PACIFIC_MAX_OFFSET_HOURS = 8;

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` from a Date's UTC parts. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses `YYYY-MM-DD` as UTC midnight. Throws on anything else. */
export function fromIsoDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiException("validation_failed", `Not a date: ${value}`);
  }
  return parsed;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Today, as Search Console reckons it. See `PACIFIC_MAX_OFFSET_HOURS`. */
export function pacificToday(now: Date): Date {
  return fromIsoDate(
    toIsoDate(new Date(now.getTime() - PACIFIC_MAX_OFFSET_HOURS * 60 * 60 * 1000)),
  );
}

/** The last day this module will claim to have complete data for. */
export function freshTo(now: Date): string {
  return toIsoDate(addDays(pacificToday(now), -GSC_DATA_LAG_DAYS));
}

export interface RangeInput {
  from?: string;
  to?: string;
}

/**
 * The window a report will actually cover.
 *
 * Defaults to the last `GSC_DEFAULT_RANGE_DAYS` complete days. A caller-supplied
 * `to` is **clamped** to `freshTo` rather than rejected: asking for "up to
 * today" is a reasonable thing for a date picker to do, and silently trimming
 * it to the last complete day is more useful than a validation error about a
 * lag the user did not know existed. `from` after `to` is a real mistake,
 * though, and says so.
 */
export function resolveRange(input: RangeInput, now: Date): GscDateRange {
  const fresh = freshTo(now);
  const freshDate = fromIsoDate(fresh);

  const requestedTo = input.to === undefined ? freshDate : fromIsoDate(input.to);
  const to = requestedTo.getTime() > freshDate.getTime() ? freshDate : requestedTo;

  // Inclusive of both ends, so 28 days is `to - 27`.
  const from =
    input.from === undefined
      ? addDays(to, -(GSC_DEFAULT_RANGE_DAYS - 1))
      : fromIsoDate(input.from);

  if (from.getTime() > to.getTime()) {
    throw new ApiException(
      "validation_failed",
      "The start of the date range is after its end.",
    );
  }

  return { from: toIsoDate(from), to: toIsoDate(to), freshTo: fresh };
}

/* -------------------------------------------------------------------------- */
/* Cached pulls                                                                */
/* -------------------------------------------------------------------------- */

/** The dimension sets this module asks Google for. */
export type PullDimensions = "date" | "query" | "page" | "query,page";

/**
 * `ws:<workspaceId>:gsc:<projectId>:<propertyHash>:<dimensions>:<from>:<to>`
 *
 * Workspace-prefixed so deletion sweeps it (CLAUDE.md hard rule #6). The
 * property is included as a hash rather than in the clear for two reasons: it
 * contains `:` and `/`, which would make the key ambiguous to read, and
 * hashing means re-pointing a project at a different property cannot serve the
 * old property's numbers — no cache purge needed on `PATCH /gsc/connection`,
 * because the old entries are simply unreachable and expire on their own.
 */
export async function pullCacheKey(
  workspaceId: string,
  projectId: string,
  property: string,
  dimensions: PullDimensions,
  range: { from: string; to: string },
): Promise<string> {
  const propertyHash = (await sha256Hex(property)).slice(0, 16);
  return `ws:${workspaceId}:gsc:${projectId}:${propertyHash}:${dimensions}:${range.from}:${range.to}`;
}

/** What goes into KV. Versioned so the shape can change without stale reads. */
interface PullCacheEntry {
  v: 1;
  rows: SearchAnalyticsRow[];
  cachedAt: number;
}

const PULL_CACHE_VERSION = 1;

export interface PullContext {
  kv: KVNamespace;
  accessToken: string;
  workspaceId: string;
  projectId: string;
  property: string;
  range: GscDateRange;
}

export interface PullResult {
  rows: SearchAnalyticsRow[];
  cached: boolean;
}

/**
 * One `searchanalytics.query`, cached for 24 hours.
 *
 * Unlike the DataForSEO client there is no `fresh` bypass, because there is
 * nothing to bypass *for*: every day in the window is already finalised, so a
 * re-fetch would return byte-identical rows. The only thing that changes a
 * report is asking for a different window, and that is a different key.
 */
export async function cachedPull(
  ctx: PullContext,
  dimensions: PullDimensions,
): Promise<PullResult> {
  const key = await pullCacheKey(
    ctx.workspaceId,
    ctx.projectId,
    ctx.property,
    dimensions,
    ctx.range,
  );

  const hit = await ctx.kv.get<PullCacheEntry>(key, "json");
  if (hit && hit.v === PULL_CACHE_VERSION) {
    return { rows: hit.rows, cached: true };
  }

  const rows = await searchAnalyticsQuery(ctx.accessToken, {
    siteUrl: ctx.property,
    startDate: ctx.range.from,
    endDate: ctx.range.to,
    dimensions: dimensions.split(","),
    rowLimit: GSC_ROW_LIMIT,
  });

  const entry: PullCacheEntry = {
    v: PULL_CACHE_VERSION,
    rows,
    cachedAt: Date.now(),
  };
  await ctx.kv.put(key, JSON.stringify(entry), {
    expirationTtl: GSC_CACHE_TTL_SECONDS,
  });

  return { rows, cached: false };
}

/* -------------------------------------------------------------------------- */
/* Shaping                                                                     */
/* -------------------------------------------------------------------------- */

function metricsOf(row: SearchAnalyticsRow): GscMetrics {
  return {
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
}

/** `dimensions: ["date"]` → a daily series, oldest first. */
export function toDaily(rows: readonly SearchAnalyticsRow[]): GscDailyPoint[] {
  return rows
    .filter((row) => row.keys[0] !== undefined)
    .map((row) => ({ date: row.keys[0] as string, ...metricsOf(row) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** `dimensions: ["query"]` → query rows, most clicks first. */
export function toQueryRows(rows: readonly SearchAnalyticsRow[]): GscQueryRow[] {
  return rows
    .filter((row) => row.keys[0] !== undefined)
    .map((row) => ({ query: row.keys[0] as string, ...metricsOf(row) }))
    .sort(byClicksThenImpressions);
}

/** `dimensions: ["page"]` → page rows, most clicks first. */
export function toPageRows(rows: readonly SearchAnalyticsRow[]): GscPageRow[] {
  return rows
    .filter((row) => row.keys[0] !== undefined)
    .map((row) => ({ page: row.keys[0] as string, ...metricsOf(row) }))
    .sort(byClicksThenImpressions);
}

/** `dimensions: ["query", "page"]` → pairs, in the order requested. */
export function toQueryPageRows(
  rows: readonly SearchAnalyticsRow[],
): GscQueryPageRow[] {
  return rows
    .filter((row) => row.keys[0] !== undefined && row.keys[1] !== undefined)
    .map((row) => ({
      query: row.keys[0] as string,
      page: row.keys[1] as string,
      ...metricsOf(row),
    }));
}

function byClicksThenImpressions(
  a: GscMetrics,
  b: GscMetrics,
): number {
  return b.clicks - a.clicks || b.impressions - a.impressions;
}

/**
 * Period totals, reconstructed from the daily series rather than bought with a
 * second, dimensionless Google call.
 *
 * Exact, not an approximation. Clicks and impressions are sums. CTR is
 * clicks/impressions, which is Search Console's own definition. Average
 * position is the impression-weighted mean of the daily averages — and a
 * weighted mean of impression-weighted means over disjoint days *is* the
 * overall impression-weighted mean, so this reproduces what Google would have
 * returned. Skipping the extra call halves the requests for the overview.
 *
 * An empty series is all zeroes, including position: there is no "average
 * position" over nothing, and 0 is outside the 1-based scale, so the UI can
 * tell it apart from a real value.
 */
export function totalsFromDaily(daily: readonly GscDailyPoint[]): GscMetrics {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;

  for (const point of daily) {
    clicks += point.clicks;
    impressions += point.impressions;
    weightedPosition += point.position * point.impressions;
  }

  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPosition / impressions : 0,
  };
}

/** The window `limit`/`offset` describe, plus the size of the set behind it. */
export function paginate<T>(
  rows: readonly T[],
  limit: number,
  offset: number,
): { rows: T[]; total: number } {
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}
