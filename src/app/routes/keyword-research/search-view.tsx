/**
 * The Keyword Research search screen.
 *
 * Search state lives in the URL, so a result is a link: shareable, reloadable,
 * and correct under the back button. The market selects and the keyword box
 * are a *form* — changing a select does not re-run the search on its own.
 * That is a cost decision as much as a UX one: every search is a billed
 * DataForSEO call, and a mis-click in a 250-entry country list should not cost
 * eleven cents.
 *
 * Phase 9 layers two things over that without disturbing it:
 *
 * - **A tab strip.** The URL still owns the *active* search; the strip is the
 *   set of searches left open beside it (research-tabs.ts). Every action here
 *   writes both, and the reconcile that follows a URL change is idempotent, so
 *   back, forward, a pasted link and a click on a chip all land in one place.
 * - **A history trail.** Past searches reopen from the Worker's stored copy for
 *   nothing (`cacheMode: "stale"`), and Refresh is the one control on this
 *   screen that deliberately spends.
 */
import { FolderOpen, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import type { KeywordHistoryEntry } from "../../../shared/history";
import { useInvalidateHistory } from "../../components/history/queries";
import {
  HistoryDisclosure,
  RecentSearchesPanel,
} from "../../components/keywords/history-panel";
import { LinkButton } from "../../components/keywords/link-button";
import { MarketSelect } from "../../components/keywords/market-select";
import type { MarketSelection } from "../../components/keywords/market";
import {
  DEFAULT_MARKET,
  readStoredMarket,
  writeStoredMarket,
} from "../../components/keywords/market";
import { useKeywordOverview } from "../../components/keywords/queries";
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Tabs,
} from "../../components/ui";
import type { TabItem } from "../../components/ui";
import { useActiveWorkspace } from "../../lib/workspaces";
import { KeywordOverviewStrip } from "./overview-strip";
import { KeywordTabPanel } from "./keyword-tab-panel";
import { ResearchTabStrip } from "./research-tab-strip";
import {
  activateResearchTab,
  activeResearchTab,
  closeResearchTab,
  openResearchTab,
  readStoredResearchTabs,
  researchTabId,
  setActiveCacheMode,
  syncResearchTabsWithUrl,
  updateActiveResearchTab,
  writeStoredResearchTabs,
} from "./research-tabs";
import type { ResearchSearch, ResearchTabsState } from "./research-tabs";
import {
  KEYWORD_TABS,
  TAB_LABELS,
  buildSearchParams,
  parseSearchParams,
} from "./search-params";
import type { KeywordSearchState, KeywordTabId } from "./search-params";

export function KeywordSearchView() {
  const { activeWorkspaceId } = useActiveWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  const storedMarket: MarketSelection =
    activeWorkspaceId === null ? DEFAULT_MARKET : readStoredMarket(activeWorkspaceId);

  const state = parseSearchParams(searchParams, storedMarket);

  const urlMarket: MarketSelection = {
    locationCode: state.locationCode,
    languageCode: state.languageCode,
  };
  const urlSearch: ResearchSearch | null =
    state.keyword === "" ? null : { keyword: state.keyword, ...urlMarket };
  const urlKey = urlSearch === null ? "" : researchTabId(urlSearch);

  /*
   * Draft state for the form, re-synced whenever the committed search changes
   * identity. Adjusting state during render (rather than in an effect) is the
   * documented React pattern for this: it keeps the back button correct
   * without rendering one frame of stale input first.
   */
  const committed = `${state.keyword}|${state.locationCode}|${state.languageCode}`;
  const [syncedFrom, setSyncedFrom] = useState(committed);
  const [draftKeyword, setDraftKeyword] = useState(state.keyword);
  const [draftMarket, setDraftMarket] = useState<MarketSelection>(urlMarket);

  if (syncedFrom !== committed) {
    setSyncedFrom(committed);
    setDraftKeyword(state.keyword);
    setDraftMarket(urlMarket);
  }

  /*
   * The open searches, restored from this browser tab's session. Reconciled
   * with the URL by the same render-time adjustment: a URL naming an open tab
   * activates it, one naming anything else opens it, and no keyword at all
   * deactivates without closing — see syncResearchTabsWithUrl.
   */
  const [tabs, setTabs] = useState<ResearchTabsState>(() =>
    syncResearchTabsWithUrl(readStoredResearchTabs(activeWorkspaceId), urlSearch),
  );
  const [syncedWorkspaceId, setSyncedWorkspaceId] = useState(activeWorkspaceId);
  const [syncedUrlKey, setSyncedUrlKey] = useState(urlKey);

  if (syncedWorkspaceId !== activeWorkspaceId) {
    // A different workspace is a different session: re-read rather than carry
    // one workspace's open searches into another's screen.
    setSyncedWorkspaceId(activeWorkspaceId);
    setSyncedUrlKey(urlKey);
    setTabs(
      syncResearchTabsWithUrl(readStoredResearchTabs(activeWorkspaceId), urlSearch),
    );
  } else if (syncedUrlKey !== urlKey) {
    setSyncedUrlKey(urlKey);
    setTabs((current) => syncResearchTabsWithUrl(current, urlSearch));
  }

  useEffect(() => {
    writeStoredResearchTabs(activeWorkspaceId, tabs);
  }, [activeWorkspaceId, tabs]);

  const active = activeResearchTab(tabs);

  /*
   * What the results below are showing. The active tab is the authority once
   * there is one; the URL covers the single render between a URL change and
   * the reconcile above catching up.
   */
  const resultKeyword = active?.keyword ?? state.keyword;
  const resultMarket: MarketSelection = active
    ? { locationCode: active.locationCode, languageCode: active.languageCode }
    : urlMarket;
  const cacheMode = active?.cacheMode ?? "auto";

  /**
   * Moves the strip and the URL together.
   *
   * Both, always: the strip is what the user manipulates and the URL is what
   * makes the result a link, and letting them drift is how you end up with a
   * back button that lies. `syncedUrlKey` is pushed forward here so the
   * reconcile that follows this navigation is a no-op rather than a second
   * pass over the same state.
   */
  function commitTabs(next: ResearchTabsState) {
    setTabs(next);
    const nextActive = activeResearchTab(next);
    setSyncedUrlKey(nextActive?.id ?? "");

    const search: KeywordSearchState =
      nextActive === null
        ? { keyword: "", ...urlMarket, tab: state.tab }
        : {
            keyword: nextActive.keyword,
            locationCode: nextActive.locationCode,
            languageCode: nextActive.languageCode,
            tab: state.tab,
          };
    setSearchParams(buildSearchParams(search));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const keyword = draftKeyword.trim();
    if (keyword === "") return;

    if (activeWorkspaceId !== null) {
      writeStoredMarket(activeWorkspaceId, draftMarket);
    }
    // Submitting continues in the tab you are in rather than opening another;
    // drilling into a result is what opens tabs.
    commitTabs(updateActiveResearchTab(tabs, { keyword, ...draftMarket }));
  }

  /** A keyword clicked in a result table: a new tab, in the same market. */
  function onOpenKeyword(keyword: string) {
    commitTabs(openResearchTab(tabs, { keyword, ...resultMarket }));
  }

  /**
   * A row clicked in the trail. Opens in its own market — a past search is a
   * whole search, not a keyword to re-run wherever you happen to be — and in
   * "stale" mode, which is the promise that reopening one costs nothing.
   */
  function onOpenHistory(entry: KeywordHistoryEntry) {
    commitTabs(
      openResearchTab(
        tabs,
        {
          keyword: entry.params.keyword,
          locationCode: entry.params.location,
          languageCode: entry.params.language,
        },
        "stale",
      ),
    );
  }

  const invalidateHistory = useInvalidateHistory(activeWorkspaceId, "keywords");
  /*
   * The hook hands back a fresh closure on every render, so it is read through
   * a ref rather than listed as a dependency — otherwise the effect below would
   * re-run on every render instead of when a search actually lands.
   */
  const invalidateHistoryRef = useRef(invalidateHistory);
  invalidateHistoryRef.current = invalidateHistory;

  /*
   * The overview query, subscribed to a second time.
   *
   * The strip below renders it; this call watches it. Same key, so TanStack
   * serves both from one entry and nothing extra is fetched or billed — and it
   * keeps "a search landed, refresh the trail" here, next to the tab state that
   * knows whether this was a real search or a free reopen.
   */
  const overview = useKeywordOverview(
    activeWorkspaceId,
    resultKeyword,
    resultMarket,
    cacheMode,
  );
  const recordedSearches = useRef(new Set<string>());

  useEffect(() => {
    // Only a real search is recorded server-side, so only a real search can
    // have changed the trail. Reopening from history writes nothing new.
    if (!overview.isSuccess || cacheMode === "stale") return;

    const stamp = `${active?.id ?? ""}|${overview.dataUpdatedAt}`;
    if (recordedSearches.current.has(stamp)) return;
    recordedSearches.current.add(stamp);
    invalidateHistoryRef.current();
  }, [overview.isSuccess, overview.dataUpdatedAt, cacheMode, active?.id]);

  const tabItems: TabItem[] = KEYWORD_TABS.map((tab) => ({
    id: tab,
    label: TAB_LABELS[tab],
    content: (
      <KeywordTabPanel
        workspaceId={activeWorkspaceId}
        tab={tab}
        keyword={resultKeyword}
        market={resultMarket}
        cacheMode={cacheMode}
        onOpenKeyword={onOpenKeyword}
      />
    ),
  }));

  const hasSearch = state.keyword !== "";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Keyword Research"
        description="Search any keyword for volume, difficulty, intent and who ranks for it — then save the winners to a collection."
        actions={
          <LinkButton to="collections" variant="secondary">
            <FolderOpen className="size-4" aria-hidden="true" />
            Collections
          </LinkButton>
        }
      />

      <Card className="p-5">
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 lg:flex-row lg:items-end"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="keyword-search">Keyword</Label>
            <Input
              id="keyword-search"
              value={draftKeyword}
              onChange={(event) => setDraftKeyword(event.target.value)}
              placeholder="e.g. project management software"
              autoComplete="off"
              maxLength={700}
            />
          </div>

          <MarketSelect
            workspaceId={activeWorkspaceId}
            market={draftMarket}
            onChange={setDraftMarket}
          />

          {/* The trail is a lookup once results are on screen, so it collapses
              into a button here and opens in full on the landing screen. */}
          {hasSearch ? (
            <HistoryDisclosure
              workspaceId={activeWorkspaceId}
              onOpen={onOpenHistory}
            />
          ) : null}

          <Button type="submit" disabled={draftKeyword.trim() === ""}>
            <Search className="size-4" aria-hidden="true" />
            Search
          </Button>
        </form>
      </Card>

      {tabs.tabs.length > 0 ? (
        <div className="mt-4">
          <ResearchTabStrip
            tabs={tabs.tabs}
            activeId={tabs.activeId}
            onActivate={(id) => commitTabs(activateResearchTab(tabs, id))}
            onClose={(id) => commitTabs(closeResearchTab(tabs, id))}
          />
        </div>
      ) : null}

      {hasSearch ? (
        <div className="mt-6 flex flex-col gap-8">
          <KeywordOverviewStrip
            workspaceId={activeWorkspaceId}
            keyword={resultKeyword}
            market={resultMarket}
            tab={state.tab}
            cacheMode={cacheMode}
            onRefreshed={() => setTabs(setActiveCacheMode(tabs, "auto"))}
          />

          <section aria-label="Keyword lists">
            <Tabs
              tabs={tabItems}
              value={state.tab}
              onValueChange={(tab) => {
                if (tab === state.tab) return;
                // `replace` so Back returns to the previous search rather than
                // walking back through every tab the user glanced at.
                setSearchParams(
                  buildSearchParams({
                    ...state,
                    keyword: resultKeyword,
                    ...resultMarket,
                    tab: tab as KeywordTabId,
                  }),
                  { replace: true },
                );
              }}
            />
          </section>
        </div>
      ) : (
        <>
          <Card className="mt-6 p-4">
            <RecentSearchesPanel
              workspaceId={activeWorkspaceId}
              onOpen={onOpenHistory}
            />
          </Card>

          <Card className="mt-4">
            <EmptyState
              icon={Search}
              title="Search a keyword to begin"
              description="You'll get search volume, difficulty, cost per click and intent, plus keyword suggestions, related terms and broader ideas for the market you choose."
            />
          </Card>
        </>
      )}
    </div>
  );
}
