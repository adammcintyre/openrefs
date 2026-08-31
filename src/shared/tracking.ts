/**
 * Contract for `/api/v1/projects/:id/keywords` — rank tracking.
 *
 * The shape here is driven by what the tracking table renders in one pass:
 * where a keyword sits today, where it sat before, how it has moved, and a
 * 30-day sparkline. The Worker computes all of that from two grouped queries
 * (never one per keyword) and hands the UI finished numbers, so the table does
 * no date arithmetic of its own.
 *
 * Two conventions run through every type below and the UI must honour both:
 *
 *  1. **`position: null` means "not in the top 100"** — a real, measured
 *     result, and the reason position is nullable rather than 0. A keyword we
 *     have never checked has no snapshot at all (`latest === null`), which is a
 *     different and genuinely unknown state. Render the first as "—" and the
 *     second as "awaiting first check".
 *  2. **Change is positive when the ranking improved.** Position counts
 *     downward — 3 is better than 8 — so `change = older - newer`, i.e. moving
 *     from 8 to 3 is `+5`. Colour positive green.
 */
import { z } from "zod";

import { deviceSchema, type Device } from "./projects";

/** Most keywords one bulk add or remove may carry. */
export const TRACKED_KEYWORDS_BULK_MAX = 1000;

/** Days of history the sparkline series covers. */
export const RANK_SERIES_DAYS = 30;

/**
 * What one keyword's rank check costs, USD, for the "Check now" hint.
 *
 * DataForSEO SERP API, Google Organic, **standard queue** (`priority: 1`) at
 * `depth: 100` — one task per keyword. $0.0006 buys 10 results and depth
 * multiplies it, so a top-100 check is $0.0006 × 10.
 *
 * **This is 10× the figure in docs/specs/PHASE3.md.** That spec says
 * "≈ $0.0006/keyword", which was right until DataForSEO re-based SERP billing
 * on 2025-09-19: the base price used to cover ~100 results and now covers 10.
 * Verified against their current price list and their own worked example on
 * 2026-08-29 — see `RANK_TASK_PRICE_SOURCE` in src/worker/dataforseo/serp.ts.
 * The UI must show this constant, not the number in the spec.
 *
 * It is a hint, not a bill: the authoritative figure is what the client meters
 * into `api_usage` when the tasks are actually posted.
 */
export const RANK_CHECK_COST_PER_KEYWORD_USD = 0.006;

/* ------------------------------- requests --------------------------------- */

export const addTrackedKeywordsSchema = z.object({
  /**
   * One keyword per entry — the UI splits its textarea on newlines. Trimmed,
   * lowercased and de-duplicated by the route before it reaches D1.
   */
  keywords: z
    .array(z.string().trim().min(1).max(700))
    .min(1)
    .max(TRACKED_KEYWORDS_BULK_MAX),
  device: deviceSchema.optional(),
  /** Per-batch override; defaults to the project's market. */
  locationCode: z.number().int().positive().optional(),
  languageCode: z
    .string()
    .trim()
    .min(2)
    .max(8)
    .regex(/^[A-Za-z-]+$/)
    .optional(),
});
export type AddTrackedKeywordsBody = z.infer<typeof addTrackedKeywordsSchema>;

export const removeTrackedKeywordsSchema = z.object({
  /** Tracked-keyword ids, not keyword text — the same word can be tracked
   * twice under different devices or markets. */
  ids: z.array(z.string().trim().min(1)).min(1).max(TRACKED_KEYWORDS_BULK_MAX),
});
export type RemoveTrackedKeywordsBody = z.infer<
  typeof removeTrackedKeywordsSchema
>;

/* ------------------------------- responses -------------------------------- */

/**
 * One observation. Sparse by design: only days that were actually checked
 * appear, so the sparkline must tolerate gaps rather than assume 30 points.
 * Inventing a point for an unchecked day would be inventing a measurement.
 */
export interface RankPoint {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  /** Null means "checked, and not in the top 100". */
  position: number | null;
}

/** The newest observation, with the detail only the latest row carries. */
export interface RankSnapshot extends RankPoint {
  /** The ranking URL. Null when the domain did not rank. */
  url: string | null;
  /** SERP feature types present on the page, e.g. ["organic","people_also_ask"]. */
  serpFeatures: string[];
}

/** A row of the tracking table. */
export interface TrackedKeywordRow {
  id: string;
  keyword: string;
  device: Device;
  locationCode: number;
  languageCode: string;
  /** ISO 8601. */
  createdAt: string;

  /** Newest snapshot, or null when this keyword has never been checked. */
  latest: RankSnapshot | null;
  /** The one before it, however long ago that was. Null when there is only one. */
  previous: RankPoint | null;

  /**
   * Movement, positive = improved. Null when there is nothing to compare
   * against — no baseline observation that far back, or either end was out of
   * the top 100 (you cannot subtract "absent" from 7).
   */
  change1d: number | null;
  change7d: number | null;
  change30d: number | null;

  /** Best position ever recorded for this keyword. Null if never ranked. */
  bestPosition: number | null;

  /**
   * Google showed an AI Overview for this keyword at the last check.
   *
   * Free: it is read out of the SERP features the latest snapshot already
   * stores, so no extra request and no extra column. False also means "never
   * checked" — a keyword with no snapshot has no features to read — which the
   * UI can disambiguate from `latest === null`.
   *
   * **Required**, as of the Phase 6 UI wave. It landed optional so the
   * retrofit could be additive against fixtures that predated it; the route
   * has always sent it (routes/projects.ts computes it for every row), so the
   * optionality only ever described the test fixtures, not the wire. Those now
   * carry it and the type says what the response actually contains — no
   * `?? false` at the call sites, and a fixture that forgets it fails to
   * compile instead of silently testing a shape the API never sends.
   */
  aiOverview: boolean;

  /** Oldest first, last `RANK_SERIES_DAYS` days. Sparse — see `RankPoint`. */
  series: RankPoint[];
}

/** GET /api/v1/projects/:id/keywords?workspace=<id> */
export interface TrackedKeywordsResponse {
  projectId: string;
  /** The project's domain, so the table can render ranking URLs relative to it. */
  domain: string;
  keywords: TrackedKeywordRow[];
  /** Newest snapshot across the whole project. ISO 8601, or null. */
  lastCheckedAt: string | null;
  /**
   * True while a rank check for this project is queued or running, so the UI
   * can say "checking…" instead of "no data yet" right after Add keywords.
   */
  checkInProgress: boolean;
}

/**
 * POST /api/v1/projects/:id/keywords
 *
 * Idempotent against the (project, keyword, location, language, device) unique
 * index: re-adding a tracked keyword is a no-op, not an error, which is what
 * makes "select all → Track" safe to double-click. `added + skipped ===
 * submitted` always holds.
 */
export interface TrackedKeywordsAddedResponse {
  added: number;
  skipped: number;
  /** Distinct keywords in the request after trimming and de-duplication. */
  submitted: number;
  keywordCount: number;
  /**
   * True when a rank check was enqueued for the new keywords. False when
   * everything was a duplicate and there was nothing to check.
   */
  checkEnqueued: boolean;
}

/** DELETE /api/v1/projects/:id/keywords — snapshots cascade with the rows. */
export interface TrackedKeywordsRemovedResponse {
  removed: number;
  keywordCount: number;
}

/** POST /api/v1/projects/:id/keywords/check-now */
export interface RankCheckEnqueuedResponse {
  enqueued: true;
  /** Keywords the check covers. */
  keywordCount: number;
  /** What this check is expected to cost, USD. A hint — see the constant. */
  estimatedCostUsd: number;
  /** ISO 8601 — when another check-now becomes allowed for this project. */
  nextAllowedAt: string;
}

/* -------------------------------- helpers --------------------------------- */

/**
 * DataForSEO's element type for Google's AI Overview.
 *
 * Verified against https://docs.dataforseo.com/v3/serp/google/organic/
 * task_get/advanced/ (2026-08-29), whose `item_types` list ends
 * `…, "perspectives", "discussions_and_forums", "compare_sites", "ai_overview"`.
 * That list is exactly what `rank_snapshots.serp_features_json` holds, because
 * the snapshot writer stores `result[0].item_types` verbatim.
 */
export const AI_OVERVIEW_FEATURE = "ai_overview";

/**
 * The same feature as it appears *nested inside* a knowledge graph.
 *
 * DataForSEO also emits `knowledge_graph_ai_overview_item` for an AI Overview
 * rendered as part of the knowledge panel. That form does not normally reach
 * the top-level `item_types` list, so this is belt-and-braces: matching it
 * costs one comparison and stops a rendering variant from reading as "no AI
 * Overview", which would understate the thing the column exists to show.
 */
export const AI_OVERVIEW_KNOWLEDGE_GRAPH_FEATURE =
  "knowledge_graph_ai_overview_item";

/**
 * Whether a snapshot's SERP features include an AI Overview.
 *
 * Pure, and exported so the Worker and any client that re-derives the badge
 * agree. Case-insensitive because these strings arrive from a third party and
 * a capitalisation change upstream should not silently empty a column.
 */
export function hasAiOverview(serpFeatures: readonly string[]): boolean {
  return serpFeatures.some((feature) => {
    const normalized = feature.trim().toLowerCase();
    return (
      normalized === AI_OVERVIEW_FEATURE ||
      normalized === AI_OVERVIEW_KNOWLEDGE_GRAPH_FEATURE
    );
  });
}

/**
 * Movement over `days`, positive when the ranking improved.
 *
 * Anchored on the newest observation rather than on today's date, which
 * matters for a project that has not been checked recently: with the last
 * check three days old, "Δ1d" anchored on today would compare the newest row
 * against itself and report a confident zero. Anchoring on the newest
 * observation instead reports the change across the last day that was actually
 * measured, or null when there is no earlier observation to compare with.
 *
 * Exported (and unit-tested) so the Worker and any client that recomputes a
 * delta agree to the digit.
 */
export function positionChange(
  series: readonly RankPoint[],
  days: number,
): number | null {
  const latest = series.at(-1);
  if (latest === undefined || latest.position === null) return null;

  const cutoff = shiftIsoDate(latest.date, -days);
  if (cutoff === null) return null;

  // The most recent observation at or before the cutoff — the closest thing to
  // "where it was `days` ago" that was actually measured.
  let baseline: RankPoint | null = null;
  for (const point of series) {
    if (point.date > cutoff) break;
    baseline = point;
  }

  if (baseline === null || baseline === latest) return null;
  if (baseline.position === null) return null;

  return baseline.position - latest.position;
}

/**
 * `YYYY-MM-DD` shifted by whole days, staying in UTC.
 *
 * `Date.UTC` handles the month and year rollovers, and parsing with an
 * explicit `T00:00:00Z` avoids the runtime-dependent local-vs-UTC reading of a
 * bare date string.
 */
export function shiftIsoDate(date: string, days: number): string | null {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return toIsoDate(new Date(parsed + days * 86_400_000));
}

/** A `Date` as `YYYY-MM-DD`, UTC. The form `rank_snapshots.date` stores. */
export function toIsoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * One day of a project's `rank_snapshots`, rolled up for the overview chart.
 *
 * Derived entirely from D1 — no provider call and no ResultMeta — so the chart
 * over these is free to render on every visit.
 */
export interface RankSummaryPoint {
  /** `YYYY-MM-DD`, UTC — the form `rank_snapshots.date` stores. */
  date: string;
  /** Mean of the positions that ranked that day; null when none did. */
  avgPosition: number | null;
  /** Keywords at position ≤ 3 that day. */
  top3: number;
  /** Keywords at position ≤ 10 that day. */
  top10: number;
  /** Keywords at position ≤ 100 that day. */
  top100: number;
  /** Keywords with any snapshot that day — the denominator for the bands. */
  tracked: number;
}

/**
 * GET /api/v1/projects/:id/rank/summary?workspace=<id>&days=<n>
 *
 * Points are oldest first and **days can be missing** (a project first checked
 * on a Tuesday has no Monday row): plot by `date`, never by index.
 */
export interface RankSummaryResponse {
  /** The window actually applied — `days` clamped to what the API allows. */
  days: number;
  points: RankSummaryPoint[];
}
