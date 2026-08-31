/**
 * The open set of in-page research tabs, and the rules that move between them.
 *
 * Keyword research is a drill-down activity: you search a seed, spot a better
 * phrase in the results, and follow it — and until now that overwrote the
 * search you came from. A tab strip keeps the trail: the URL still owns the
 * *active* search (so a result stays a link), and this module owns the set of
 * searches that are open beside it.
 *
 * Three decisions are worth knowing about.
 *
 * 1. **A tab's id is its canonical search key.** Dedupe, "activate the tab this
 *    URL names" and "did the form land on a tab that is already open?" all
 *    become the same lookup, and nothing here needs a random id — which also
 *    makes the whole model testable without mocking a generator.
 * 2. **Display order is insertion order; recency only decides eviction.** Tabs
 *    that reshuffle themselves as you click are disorienting, but the cap has
 *    to drop *something*, and the least-recently-active tab is the one the user
 *    has most obviously finished with.
 * 3. **`cacheMode` rides on the tab, not on the query key.** A tab opened from
 *    the history trail asks the Worker for the cached copy however old it is
 *    (`stale=true`, $0); an ordinary tab asks normally. Keeping the mode out of
 *    the query key is deliberate — see the note on `KeywordCacheMode`.
 */
import type { MarketSelection } from "../../components/keywords/market";
import { isLanguageCode, isLocationCode } from "../../components/keywords/market";

/**
 * How a tab's next fetch should treat the server cache.
 *
 * `"auto"` is the normal path: the Worker serves its cached copy while it is
 * fresh and re-fetches (billing) once it is not. `"stale"` says "serve whatever
 * you still hold, however old" — the guarantee behind reopening a past search
 * for free.
 *
 * This is a property of the *tab*, never of the query key. If it were part of
 * the key, flipping a tab back to "auto" after a Refresh would mint a second
 * cache entry for the same search and TanStack would fetch it — turning a mode
 * change into a bill. It travels as a `queryFn` argument instead, so it only
 * affects fetches that were going to happen anyway.
 */
export type KeywordCacheMode = "auto" | "stale";

/** How many tabs stay open before the least-recently-active one is dropped. */
export const MAX_RESEARCH_TABS = 8;

/** One search: the seed and the market it runs in. */
export interface ResearchSearch extends MarketSelection {
  keyword: string;
}

export interface ResearchTab extends ResearchSearch {
  /** The canonical search key — see the note above. */
  id: string;
  cacheMode: KeywordCacheMode;
  /**
   * Logical clock, not a timestamp: higher means more recently active. A
   * counter rather than `Date.now()` so eviction is deterministic under test
   * and immune to two activations landing in the same millisecond.
   */
  lastActiveAt: number;
}

export interface ResearchTabsState {
  tabs: ResearchTab[];
  /** Null when the URL names no search — the module's landing state. */
  activeId: string | null;
}

export const EMPTY_RESEARCH_TABS: ResearchTabsState = { tabs: [], activeId: null };

/**
 * The identity of a search.
 *
 * Case- and whitespace-insensitive on both halves, because "SEO Tools" and
 * "seo tools" are the same paid query upstream and opening two tabs for them
 * would spend twice for one answer.
 */
export function researchTabId(search: ResearchSearch): string {
  return [
    search.keyword.trim().toLowerCase(),
    search.locationCode,
    search.languageCode.trim().toLowerCase(),
  ].join("|");
}

export function findTab(
  state: ResearchTabsState,
  id: string,
): ResearchTab | null {
  return state.tabs.find((tab) => tab.id === id) ?? null;
}

export function activeResearchTab(state: ResearchTabsState): ResearchTab | null {
  return state.activeId === null ? null : findTab(state, state.activeId);
}

function nextClock(tabs: ReadonlyArray<ResearchTab>): number {
  return tabs.reduce((highest, tab) => Math.max(highest, tab.lastActiveAt), 0) + 1;
}

function toSearch(search: ResearchSearch): ResearchSearch {
  return {
    keyword: search.keyword.trim(),
    locationCode: search.locationCode,
    languageCode: search.languageCode.trim(),
  };
}

/**
 * Opens a search as a tab and activates it.
 *
 * Already open? Activate it and leave it alone — in particular leave its
 * `cacheMode` alone. Re-clicking a history entry for a tab that is already on
 * screen must not quietly re-arm a stale fetch for data the client already
 * holds.
 */
export function openResearchTab(
  state: ResearchTabsState,
  search: ResearchSearch,
  cacheMode: KeywordCacheMode = "auto",
): ResearchTabsState {
  const normalized = toSearch(search);
  if (normalized.keyword === "") return state;

  const id = researchTabId(normalized);
  const clock = nextClock(state.tabs);

  if (findTab(state, id) !== null) {
    return {
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, lastActiveAt: clock } : tab,
      ),
      activeId: id,
    };
  }

  const opened: ResearchTab = { ...normalized, id, cacheMode, lastActiveAt: clock };

  // At the cap, the least-recently-active tab makes room. The active tab always
  // holds the highest clock, so it can never be the one evicted.
  const kept =
    state.tabs.length < MAX_RESEARCH_TABS
      ? state.tabs
      : dropLeastRecentlyActive(state.tabs);

  return { tabs: [...kept, opened], activeId: id };
}

function dropLeastRecentlyActive(
  tabs: ReadonlyArray<ResearchTab>,
): ResearchTab[] {
  let victim = tabs[0];
  for (const tab of tabs) {
    if (victim === undefined || tab.lastActiveAt < victim.lastActiveAt) {
      victim = tab;
    }
  }
  return tabs.filter((tab) => tab !== victim);
}

/** Brings an open tab to the front. Unknown ids are ignored, not invented. */
export function activateResearchTab(
  state: ResearchTabsState,
  id: string,
): ResearchTabsState {
  if (findTab(state, id) === null) return state;
  const clock = nextClock(state.tabs);
  return {
    tabs: state.tabs.map((tab) =>
      tab.id === id ? { ...tab, lastActiveAt: clock } : tab,
    ),
    activeId: id,
  };
}

/**
 * Re-points the active tab at a new search — what submitting the form does.
 *
 * Replacing in place rather than opening a tab is the point: typing a new seed
 * into the box is *continuing* in this tab, and every submit spawning another
 * one would hit the cap in eight searches. Three cases:
 *
 * - nothing active yet → this is just an open;
 * - the new search is already open in *another* tab → that tab wins and this
 *   one folds into it, because two tabs with one id is not a state this model
 *   can represent (or should want to);
 * - otherwise → the tab keeps its slot and its clock, and takes the new search.
 *
 * The mode returns to "auto" either way: an explicitly typed search is the user
 * asking for an answer, and is allowed to cost what it costs.
 */
export function updateActiveResearchTab(
  state: ResearchTabsState,
  search: ResearchSearch,
): ResearchTabsState {
  const normalized = toSearch(search);
  if (normalized.keyword === "") return state;

  const active = activeResearchTab(state);
  if (active === null) return openResearchTab(state, normalized);

  const id = researchTabId(normalized);
  if (id !== active.id && findTab(state, id) !== null) {
    const withoutActive = {
      tabs: state.tabs.filter((tab) => tab.id !== active.id),
      activeId: state.activeId,
    };
    return activateResearchTab(withoutActive, id);
  }

  const clock = nextClock(state.tabs);
  return {
    tabs: state.tabs.map((tab) =>
      tab.id === active.id
        ? { ...tab, ...normalized, id, cacheMode: "auto", lastActiveAt: clock }
        : tab,
    ),
    activeId: id,
  };
}

/**
 * Closes a tab. Closing the active one hands over to its right-hand neighbour,
 * or its left-hand one at the end of the strip; closing the last leaves nothing
 * active, which is the module's empty search state.
 */
export function closeResearchTab(
  state: ResearchTabsState,
  id: string,
): ResearchTabsState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return state;

  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeId !== id) return { tabs, activeId: state.activeId };

  const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
  return { tabs, activeId: neighbour?.id ?? null };
}

/** Sets the active tab's cache mode — Refresh puts it back to "auto". */
export function setActiveCacheMode(
  state: ResearchTabsState,
  cacheMode: KeywordCacheMode,
): ResearchTabsState {
  if (state.activeId === null) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === state.activeId ? { ...tab, cacheMode } : tab,
    ),
  };
}

/**
 * Reconciles the strip with the URL, which is the source of truth for the
 * active search.
 *
 * Back, forward, a pasted link and a sidebar click all arrive here. A URL
 * naming an open tab activates it; one naming a search we have never seen opens
 * it. A URL with no search deactivates everything without closing anything —
 * the strip stays on screen so the trail is one click away rather than lost to
 * the back button.
 *
 * Idempotent on purpose: every action in the view writes the tab state *and*
 * the URL, so this runs again on the very next render and must be a no-op when
 * the two already agree.
 */
export function syncResearchTabsWithUrl(
  state: ResearchTabsState,
  search: ResearchSearch | null,
): ResearchTabsState {
  if (search === null || search.keyword.trim() === "") {
    return state.activeId === null ? state : { ...state, activeId: null };
  }

  const id = researchTabId(search);
  if (state.activeId === id && findTab(state, id) !== null) return state;
  return openResearchTab(state, search);
}

/* ------------------------------- persistence ------------------------------- */

/**
 * Per workspace, and in sessionStorage rather than localStorage.
 *
 * Session scope matches what a tab strip *is*: this browser tab's working set,
 * which should survive a reload but must not follow you into a second window
 * where you are researching something else. Nothing here is server state — the
 * durable trail is the search history, which every member of the workspace
 * shares.
 */
export function researchTabsStorageKey(workspaceId: string): string {
  return `orf:kw-tabs:${workspaceId}`;
}

interface StoredShape {
  tabs: unknown;
  activeId: unknown;
}

/**
 * Rebuilds state from whatever storage handed back.
 *
 * Total, like the URL parser next door: anything unrecognisable degrades to an
 * empty strip rather than throwing. Ids are recomputed rather than trusted, so
 * a hand-edited entry cannot smuggle in a tab whose id disagrees with its
 * search — the invariant the whole model rests on.
 */
export function parseStoredResearchTabs(raw: unknown): ResearchTabsState {
  if (typeof raw !== "string") return EMPTY_RESEARCH_TABS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_RESEARCH_TABS;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY_RESEARCH_TABS;

  const { tabs: rawTabs, activeId: rawActiveId } = parsed as StoredShape;
  if (!Array.isArray(rawTabs)) return EMPTY_RESEARCH_TABS;

  const tabs: ResearchTab[] = [];
  const seen = new Set<string>();

  for (const entry of rawTabs) {
    const tab = parseStoredTab(entry);
    if (tab === null || seen.has(tab.id)) continue;
    seen.add(tab.id);
    tabs.push(tab);
    if (tabs.length === MAX_RESEARCH_TABS) break;
  }

  if (tabs.length === 0) return EMPTY_RESEARCH_TABS;

  const activeId =
    typeof rawActiveId === "string" && seen.has(rawActiveId) ? rawActiveId : null;

  return { tabs, activeId };
}

function parseStoredTab(entry: unknown): ResearchTab | null {
  if (typeof entry !== "object" || entry === null) return null;

  const { keyword, locationCode, languageCode, cacheMode, lastActiveAt } =
    entry as Partial<ResearchTab>;

  if (typeof keyword !== "string" || keyword.trim() === "") return null;
  if (!isLocationCode(locationCode) || !isLanguageCode(languageCode)) return null;

  const search: ResearchSearch = {
    keyword: keyword.trim(),
    locationCode,
    languageCode: languageCode.trim(),
  };

  return {
    ...search,
    id: researchTabId(search),
    cacheMode: cacheMode === "stale" ? "stale" : "auto",
    lastActiveAt:
      typeof lastActiveAt === "number" && Number.isFinite(lastActiveAt)
        ? lastActiveAt
        : 0,
  };
}

/** Restores the strip for a workspace. Storage itself may throw; that is fine. */
export function readStoredResearchTabs(
  workspaceId: string | null,
): ResearchTabsState {
  if (workspaceId === null) return EMPTY_RESEARCH_TABS;
  try {
    return parseStoredResearchTabs(
      globalThis.sessionStorage?.getItem(researchTabsStorageKey(workspaceId)),
    );
  } catch {
    return EMPTY_RESEARCH_TABS;
  }
}

/** Best-effort persist — losing the strip is not worth an error path. */
export function writeStoredResearchTabs(
  workspaceId: string | null,
  state: ResearchTabsState,
): void {
  if (workspaceId === null) return;
  try {
    globalThis.sessionStorage?.setItem(
      researchTabsStorageKey(workspaceId),
      JSON.stringify(state),
    );
  } catch {
    /* storage unavailable — the strip still works for this render tree */
  }
}
