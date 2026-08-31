/**
 * Search history — the workspace's research trail.
 *
 * Every successful Keyword Research, Domain Overview and Gap Analysis search is
 * recorded server-side (an upsert keyed on the canonical params), so the trail
 * is shared by the whole workspace and survives the browser. Re-opening an
 * entry serves the provider cache — deliberately stale if need be — so a click
 * here is always $0; the Refresh affordance is where spending happens.
 *
 * `params` is exactly what re-runs the search; `summary` is what makes the
 * list scannable without re-running anything.
 */

export const HISTORY_MODULES = ["keywords", "domains", "gap"] as const;
export type HistoryModule = (typeof HISTORY_MODULES)[number];

/** Rows kept per workspace + module; older rows are pruned on insert. */
export const HISTORY_KEEP = 100;
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 50;

/** A Keyword Research search: one seed keyword in one market. */
export interface KeywordHistoryParams {
  keyword: string;
  /** DataForSEO location code, e.g. 2826. */
  location: number;
  /** Language code, e.g. "en". */
  language: string;
}

/** A Domain Overview search: one target in one market. */
export interface DomainHistoryParams {
  /** Normalised hostname, as the module's URL state stores it. */
  target: string;
  location: number;
  language: string;
}

/**
 * A Gap Analysis comparison (keywords view). The mode is excluded on purpose —
 * it selects a view over rows the query already covers (see the module's
 * `gapSearchKey`), so switching modes is not a new search. The pages view is
 * not recorded: it is a different query with different inputs.
 */
export interface GapHistoryParams {
  target: string;
  /** Normalised competitor hostnames, in column order. */
  competitors: string[];
  location: number;
  language: string;
}

export interface KeywordHistorySummary {
  /** Monthly search volume. */
  volume: number | null;
  /** 0–100. */
  difficulty: number | null;
  cpc: number | null;
  intent: string | null;
}

export interface DomainHistorySummary {
  /** 0–100. */
  domainScore: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
}

export interface GapHistorySummary {
  /** Rows the comparison found, before mode filtering. */
  keywordCount: number | null;
  competitorCount: number;
}

/** Common half of one trail row. Timestamps are ISO 8601 UTC. */
export interface HistoryEntryBase {
  id: string;
  /** Times this exact search has been run (or reopened) in this workspace. */
  hitCount: number;
  firstSearchedAt: string;
  lastSearchedAt: string;
}

export interface KeywordHistoryEntry extends HistoryEntryBase {
  module: "keywords";
  params: KeywordHistoryParams;
  /** Null until a search returns metrics to snapshot. */
  summary: KeywordHistorySummary | null;
}

export interface DomainHistoryEntry extends HistoryEntryBase {
  module: "domains";
  params: DomainHistoryParams;
  summary: DomainHistorySummary | null;
}

export interface GapHistoryEntry extends HistoryEntryBase {
  module: "gap";
  params: GapHistoryParams;
  summary: GapHistorySummary | null;
}

export type HistoryEntry =
  | KeywordHistoryEntry
  | DomainHistoryEntry
  | GapHistoryEntry;

/** Lets a hook narrow `items` to the module it asked for. */
export interface HistoryEntryByModule {
  keywords: KeywordHistoryEntry;
  domains: DomainHistoryEntry;
  gap: GapHistoryEntry;
}

/** GET /api/v1/history?workspace=<id>&module=<m>&limit=<n> — newest first. */
export interface HistoryListResponse {
  items: HistoryEntry[];
  /** Rows stored for this module, which can exceed `items.length`. */
  total: number;
}

/**
 * DELETE /api/v1/history/:id?workspace=<id>            → `{ deleted: 1 }`
 * DELETE /api/v1/history?workspace=<id>&module=<m>     → `{ deleted: n }`
 */
export interface HistoryDeletedResponse {
  deleted: number;
}
