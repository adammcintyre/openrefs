/**
 * The Keyword Research search screen.
 *
 * Search state lives in the URL, so a result is a link: shareable, reloadable,
 * and correct under the back button. The market selects and the keyword box
 * are a *form* — changing a select does not re-run the search on its own.
 * That is a cost decision as much as a UX one: every search is a billed
 * DataForSEO call, and a mis-click in a 250-entry country list should not cost
 * eleven cents.
 */
import { FolderOpen, Search } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { LinkButton } from "../../components/keywords/link-button";
import { MarketSelect } from "../../components/keywords/market-select";
import type { MarketSelection } from "../../components/keywords/market";
import {
  DEFAULT_MARKET,
  readStoredMarket,
  writeStoredMarket,
} from "../../components/keywords/market";
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
import {
  KEYWORD_TABS,
  buildSearchParams,
  parseSearchParams,
} from "./search-params";
import type { KeywordSearchState, KeywordTabId } from "./search-params";

const TAB_LABELS: Record<KeywordTabId, string> = {
  ideas: "Ideas",
  suggestions: "Suggestions",
  related: "Related",
};

export function KeywordSearchView() {
  const { activeWorkspaceId } = useActiveWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  const storedMarket: MarketSelection =
    activeWorkspaceId === null ? DEFAULT_MARKET : readStoredMarket(activeWorkspaceId);

  const state = parseSearchParams(searchParams, storedMarket);

  /*
   * Draft state for the form, re-synced whenever the committed search changes
   * identity. Adjusting state during render (rather than in an effect) is the
   * documented React pattern for this: it keeps the back button correct
   * without rendering one frame of stale input first.
   */
  const committed = `${state.keyword}|${state.locationCode}|${state.languageCode}`;
  const [syncedFrom, setSyncedFrom] = useState(committed);
  const [draftKeyword, setDraftKeyword] = useState(state.keyword);
  const [draftMarket, setDraftMarket] = useState<MarketSelection>({
    locationCode: state.locationCode,
    languageCode: state.languageCode,
  });

  if (syncedFrom !== committed) {
    setSyncedFrom(committed);
    setDraftKeyword(state.keyword);
    setDraftMarket({
      locationCode: state.locationCode,
      languageCode: state.languageCode,
    });
  }

  function commit(next: KeywordSearchState) {
    setSearchParams(buildSearchParams(next));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const keyword = draftKeyword.trim();
    if (keyword === "") return;

    if (activeWorkspaceId !== null) {
      writeStoredMarket(activeWorkspaceId, draftMarket);
    }
    commit({ keyword, ...draftMarket, tab: state.tab });
  }

  const market: MarketSelection = {
    locationCode: state.locationCode,
    languageCode: state.languageCode,
  };

  const tabs: TabItem[] = KEYWORD_TABS.map((tab) => ({
    id: tab,
    label: TAB_LABELS[tab],
    content: (
      <KeywordTabPanel
        workspaceId={activeWorkspaceId}
        tab={tab}
        keyword={state.keyword}
        market={market}
      />
    ),
  }));

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

          <Button type="submit" disabled={draftKeyword.trim() === ""}>
            <Search className="size-4" aria-hidden="true" />
            Search
          </Button>
        </form>
      </Card>

      {state.keyword === "" ? (
        <Card className="mt-6">
          <EmptyState
            icon={Search}
            title="Search a keyword to begin"
            description="You'll get search volume, difficulty, cost per click and intent, plus keyword ideas, suggestions and related terms for the market you choose."
          />
        </Card>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          <KeywordOverviewStrip
            workspaceId={activeWorkspaceId}
            keyword={state.keyword}
            market={market}
          />

          <section aria-label="Keyword lists">
            <Tabs
              tabs={tabs}
              value={state.tab}
              onValueChange={(tab) => {
                if (tab === state.tab) return;
                // `replace` so Back returns to the previous search rather than
                // walking back through every tab the user glanced at.
                setSearchParams(
                  buildSearchParams({ ...state, tab: tab as KeywordTabId }),
                  { replace: true },
                );
              }}
            />
          </section>
        </div>
      )}
    </div>
  );
}
