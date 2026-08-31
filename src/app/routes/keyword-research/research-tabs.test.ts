import { afterEach, describe, expect, it } from "vitest";

import {
  EMPTY_RESEARCH_TABS,
  MAX_RESEARCH_TABS,
  activateResearchTab,
  activeResearchTab,
  closeResearchTab,
  openResearchTab,
  parseStoredResearchTabs,
  readStoredResearchTabs,
  researchTabId,
  researchTabsStorageKey,
  setActiveCacheMode,
  syncResearchTabsWithUrl,
  updateActiveResearchTab,
  writeStoredResearchTabs,
} from "./research-tabs";
import type { ResearchSearch, ResearchTabsState } from "./research-tabs";

const UK = { locationCode: 2826, languageCode: "en" };
const US = { locationCode: 2840, languageCode: "en" };

const search = (keyword: string, market = UK): ResearchSearch => ({
  keyword,
  ...market,
});

/** The strip as the user would read it: keywords, left to right. */
const labels = (state: ResearchTabsState) => state.tabs.map((tab) => tab.keyword);

const activeKeyword = (state: ResearchTabsState) =>
  activeResearchTab(state)?.keyword ?? null;

/** Opens a run of searches, each one activating as it lands. */
const openAll = (keywords: string[]): ResearchTabsState =>
  keywords.reduce(
    (state, keyword) => openResearchTab(state, search(keyword)),
    EMPTY_RESEARCH_TABS,
  );

describe("researchTabId", () => {
  it("is the search, case- and space-insensitively", () => {
    expect(researchTabId(search("  SEO Tools  "))).toBe(
      researchTabId(search("seo tools")),
    );
  });

  /*
   * The market is part of the identity: the same phrase in two countries is two
   * different paid queries with two different answers.
   */
  it("separates the same keyword in different markets", () => {
    expect(researchTabId(search("seo tools", UK))).not.toBe(
      researchTabId(search("seo tools", US)),
    );
  });
});

describe("opening", () => {
  it("appends and activates", () => {
    const state = openAll(["alpha", "beta"]);
    expect(labels(state)).toEqual(["alpha", "beta"]);
    expect(activeKeyword(state)).toBe("beta");
  });

  it("activates an open tab rather than opening a second one", () => {
    const state = openResearchTab(openAll(["alpha", "beta"]), search("ALPHA"));
    expect(labels(state)).toEqual(["alpha", "beta"]);
    expect(activeKeyword(state)).toBe("alpha");
  });

  /*
   * A history click arms `stale` on the tab it opens. Clicking the same entry
   * again when that tab is already on screen must not re-arm it: the client
   * cache already holds the answer, and re-arming would mean the next fetch
   * this tab makes asks for a deliberately old copy for no reason.
   */
  it("leaves an open tab's cache mode alone when it is re-opened", () => {
    const fromHistory = openResearchTab(
      EMPTY_RESEARCH_TABS,
      search("alpha"),
      "stale",
    );
    const again = openResearchTab(fromHistory, search("alpha"), "auto");
    expect(activeResearchTab(again)?.cacheMode).toBe("stale");
  });

  it("opens a drill-down in the market it was found in", () => {
    const state = openResearchTab(
      openAll(["alpha"]),
      search("beta", US),
    );
    expect(activeResearchTab(state)?.locationCode).toBe(2840);
  });

  it("ignores an empty keyword", () => {
    expect(openResearchTab(EMPTY_RESEARCH_TABS, search("   "))).toEqual(
      EMPTY_RESEARCH_TABS,
    );
  });
});

describe("the eight-tab cap", () => {
  const full = openAll(
    Array.from({ length: MAX_RESEARCH_TABS }, (_, i) => `kw-${i}`),
  );

  it("holds exactly eight", () => {
    expect(full.tabs).toHaveLength(8);
  });

  it("evicts the least recently active to make room for a ninth", () => {
    const ninth = openResearchTab(full, search("newcomer"));
    expect(ninth.tabs).toHaveLength(8);
    expect(labels(ninth)).toEqual([
      "kw-1", "kw-2", "kw-3", "kw-4", "kw-5", "kw-6", "kw-7", "newcomer",
    ]);
    expect(activeKeyword(ninth)).toBe("newcomer");
  });

  /*
   * "Least recently active", not "opened longest ago". Revisiting the oldest
   * tab is exactly how a user says they still want it.
   */
  it("spares a revisited tab and drops the next-oldest instead", () => {
    const revisited = activateResearchTab(full, researchTabId(search("kw-0")));
    const ninth = openResearchTab(revisited, search("newcomer"));
    expect(labels(ninth)).toContain("kw-0");
    expect(labels(ninth)).not.toContain("kw-1");
  });

  it("never evicts the tab the user is looking at", () => {
    const ninth = openResearchTab(full, search("newcomer"));
    const tenth = openResearchTab(ninth, search("another"));
    expect(labels(tenth)).toContain("newcomer");
  });
});

describe("submitting the form", () => {
  it("re-points the active tab instead of opening one", () => {
    const state = updateActiveResearchTab(openAll(["alpha", "beta"]), search("gamma"));
    expect(labels(state)).toEqual(["alpha", "gamma"]);
    expect(activeKeyword(state)).toBe("gamma");
  });

  it("returns the tab to normal cache handling", () => {
    const fromHistory = openResearchTab(
      EMPTY_RESEARCH_TABS,
      search("alpha"),
      "stale",
    );
    const searched = updateActiveResearchTab(fromHistory, search("beta"));
    expect(activeResearchTab(searched)?.cacheMode).toBe("auto");
  });

  /*
   * Two tabs cannot share an id, so typing a keyword that is already open folds
   * the current tab into that one rather than duplicating it.
   */
  it("folds into an existing tab when the typed search is already open", () => {
    const state = updateActiveResearchTab(openAll(["alpha", "beta"]), search("alpha"));
    expect(labels(state)).toEqual(["alpha"]);
    expect(activeKeyword(state)).toBe("alpha");
  });

  it("opens a tab when there is nothing active to re-point", () => {
    const state = updateActiveResearchTab(EMPTY_RESEARCH_TABS, search("alpha"));
    expect(labels(state)).toEqual(["alpha"]);
  });

  it("keeps the keyword as it was typed, not as it was keyed", () => {
    const state = updateActiveResearchTab(openAll(["alpha"]), search("SEO Tools"));
    expect(activeKeyword(state)).toBe("SEO Tools");
  });
});

describe("closing", () => {
  it("hands the active slot to the right-hand neighbour", () => {
    const state = activateResearchTab(
      openAll(["alpha", "beta", "gamma"]),
      researchTabId(search("beta")),
    );
    const closed = closeResearchTab(state, researchTabId(search("beta")));
    expect(labels(closed)).toEqual(["alpha", "gamma"]);
    expect(activeKeyword(closed)).toBe("gamma");
  });

  it("falls back to the left at the end of the strip", () => {
    const closed = closeResearchTab(
      openAll(["alpha", "beta"]),
      researchTabId(search("beta")),
    );
    expect(activeKeyword(closed)).toBe("alpha");
  });

  it("leaves the active tab alone when a different one closes", () => {
    const closed = closeResearchTab(
      openAll(["alpha", "beta"]),
      researchTabId(search("alpha")),
    );
    expect(activeKeyword(closed)).toBe("beta");
  });

  it("empties out when the last tab closes", () => {
    const closed = closeResearchTab(
      openAll(["alpha"]),
      researchTabId(search("alpha")),
    );
    expect(closed).toEqual(EMPTY_RESEARCH_TABS);
  });

  it("ignores an id that is not open", () => {
    const state = openAll(["alpha"]);
    expect(closeResearchTab(state, "nope|1|xx")).toBe(state);
  });
});

describe("syncing with the URL", () => {
  it("activates the tab a URL names", () => {
    const state = syncResearchTabsWithUrl(openAll(["alpha", "beta"]), search("alpha"));
    expect(activeKeyword(state)).toBe("alpha");
    expect(state.tabs).toHaveLength(2);
  });

  it("opens a deep link that names no open tab", () => {
    const state = syncResearchTabsWithUrl(openAll(["alpha"]), search("gamma"));
    expect(labels(state)).toEqual(["alpha", "gamma"]);
    expect(activeKeyword(state)).toBe("gamma");
  });

  /*
   * Every action in the view writes both the tab state and the URL, so this
   * runs again on the next render. It has to be a no-op by then, or the two
   * would push each other round forever.
   */
  it("is a no-op once the URL and the strip agree", () => {
    const state = openAll(["alpha"]);
    expect(syncResearchTabsWithUrl(state, search("alpha"))).toBe(state);
  });

  it("deactivates without closing anything when the URL names no search", () => {
    const state = syncResearchTabsWithUrl(openAll(["alpha", "beta"]), null);
    expect(state.tabs).toHaveLength(2);
    expect(state.activeId).toBeNull();
  });
});

describe("setActiveCacheMode", () => {
  it("moves only the active tab", () => {
    const state = setActiveCacheMode(
      openResearchTab(
        openResearchTab(EMPTY_RESEARCH_TABS, search("alpha"), "stale"),
        search("beta"),
        "stale",
      ),
      "auto",
    );
    expect(state.tabs.map((tab) => tab.cacheMode)).toEqual(["stale", "auto"]);
  });

  it("does nothing when no tab is active", () => {
    const state = syncResearchTabsWithUrl(openAll(["alpha"]), null);
    expect(setActiveCacheMode(state, "auto")).toBe(state);
  });
});

/* ------------------------------- persistence ------------------------------- */

describe("parseStoredResearchTabs", () => {
  const stored = (state: ResearchTabsState) => JSON.stringify(state);

  it("round-trips a strip", () => {
    const original = setActiveCacheMode(openAll(["alpha", "beta"]), "stale");
    const restored = parseStoredResearchTabs(stored(original));
    expect(labels(restored)).toEqual(["alpha", "beta"]);
    expect(activeKeyword(restored)).toBe("beta");
    expect(activeResearchTab(restored)?.cacheMode).toBe("stale");
  });

  /*
   * sessionStorage is user-writable and survives app versions, so every one of
   * these has to land on an empty strip rather than an error boundary.
   */
  it.each<[raw: unknown, why: string]>([
    [undefined, "nothing stored"],
    [null, "a null read"],
    ["", "an empty string"],
    ["{", "truncated JSON"],
    ["null", "JSON null"],
    ["[]", "an array at the top level"],
    ['{"tabs":"alpha"}', "tabs that are not an array"],
    ['{"tabs":[]}', "an empty tab list"],
    [42, "a number where a string was expected"],
  ])("tolerates %s (%s)", (raw) => {
    expect(parseStoredResearchTabs(raw)).toEqual(EMPTY_RESEARCH_TABS);
  });

  it("drops entries that could not be searched", () => {
    const restored = parseStoredResearchTabs(
      JSON.stringify({
        tabs: [
          { keyword: "", locationCode: 2826, languageCode: "en" },
          { keyword: "no market", locationCode: 0, languageCode: "en" },
          { keyword: "bad language", locationCode: 2826, languageCode: "en_GB" },
          { keyword: "fine", locationCode: 2826, languageCode: "en" },
          "not an object",
          null,
        ],
        activeId: null,
      }),
    );
    expect(labels(restored)).toEqual(["fine"]);
  });

  /*
   * The id is derived, never trusted: a hand-edited entry must not be able to
   * hold an id that disagrees with its own search, or dedupe and URL matching
   * would both quietly stop working.
   */
  it("recomputes ids rather than trusting them", () => {
    const restored = parseStoredResearchTabs(
      JSON.stringify({
        tabs: [
          { id: "lies", keyword: "alpha", locationCode: 2826, languageCode: "en" },
        ],
        activeId: "lies",
      }),
    );
    expect(restored.tabs[0]?.id).toBe(researchTabId(search("alpha")));
    expect(restored.activeId).toBeNull();
  });

  it("collapses duplicate searches", () => {
    const restored = parseStoredResearchTabs(
      JSON.stringify({
        tabs: [
          { keyword: "alpha", locationCode: 2826, languageCode: "en" },
          { keyword: "ALPHA", locationCode: 2826, languageCode: "en" },
        ],
        activeId: null,
      }),
    );
    expect(restored.tabs).toHaveLength(1);
  });

  it("enforces the cap on what it restores", () => {
    const restored = parseStoredResearchTabs(
      JSON.stringify({
        tabs: Array.from({ length: 20 }, (_, i) => ({
          keyword: `kw-${i}`,
          locationCode: 2826,
          languageCode: "en",
        })),
        activeId: null,
      }),
    );
    expect(restored.tabs).toHaveLength(MAX_RESEARCH_TABS);
  });

  it("normalises an unknown cache mode to auto", () => {
    const restored = parseStoredResearchTabs(
      JSON.stringify({
        tabs: [
          {
            keyword: "alpha",
            locationCode: 2826,
            languageCode: "en",
            cacheMode: "free-money-please",
            lastActiveAt: "soon",
          },
        ],
        activeId: null,
      }),
    );
    expect(restored.tabs[0]?.cacheMode).toBe("auto");
    expect(restored.tabs[0]?.lastActiveAt).toBe(0);
  });
});

describe("sessionStorage", () => {
  /** Enough of the Storage interface for the two calls under test. */
  function installStorage(): Map<string, string> {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => void entries.set(key, value),
      },
    });
    return entries;
  }

  function installThrowingStorage(): void {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("storage is disabled");
      },
    });
  }

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  it("is keyed per workspace", () => {
    expect(researchTabsStorageKey("ws-1")).toBe("orf:kw-tabs:ws-1");
  });

  it("round-trips through storage", () => {
    installStorage();
    const original = openAll(["alpha", "beta"]);
    writeStoredResearchTabs("ws-1", original);
    expect(labels(readStoredResearchTabs("ws-1"))).toEqual(["alpha", "beta"]);
  });

  it("keeps workspaces apart", () => {
    installStorage();
    writeStoredResearchTabs("ws-1", openAll(["alpha"]));
    expect(readStoredResearchTabs("ws-2")).toEqual(EMPTY_RESEARCH_TABS);
  });

  it("does nothing without a workspace", () => {
    const entries = installStorage();
    writeStoredResearchTabs(null, openAll(["alpha"]));
    expect(entries.size).toBe(0);
    expect(readStoredResearchTabs(null)).toEqual(EMPTY_RESEARCH_TABS);
  });

  // Safari private mode and hardened browser settings both throw on access.
  it("survives storage that throws", () => {
    installThrowingStorage();
    expect(readStoredResearchTabs("ws-1")).toEqual(EMPTY_RESEARCH_TABS);
    expect(() => writeStoredResearchTabs("ws-1", openAll(["alpha"]))).not.toThrow();
  });

  // Node has no sessionStorage at all; the optional chain has to carry that.
  it("survives storage that does not exist", () => {
    expect(readStoredResearchTabs("ws-1")).toEqual(EMPTY_RESEARCH_TABS);
    expect(() => writeStoredResearchTabs("ws-1", openAll(["alpha"]))).not.toThrow();
  });
});
