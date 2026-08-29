/**
 * Domain Overview — the screen.
 *
 * The URL owns the search (`?target=&location=&language=&tab=`), so this
 * component is mostly a translator: query string in, four tabs out. What state
 * it does hold is the state that must *not* live in the URL, because putting it
 * there would let a stale link spend money on load — the country breakdown's
 * "yes, I accept the cost" flag most of all.
 */
import { Globe, SearchX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { marketLabel } from "../../components/domains/market-options";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import {
  readLastMarket,
  writeLastMarket,
} from "../../components/domains/market-storage";
import { useMetaLocations } from "../../components/domains/meta-queries";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  useToast,
} from "../../components/ui";
import type { TabItem } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api";
import { useActiveWorkspace } from "../../lib/workspaces";
import type { KeywordFilters } from "./keyword-filters";
import { EMPTY_FILTERS } from "./keyword-filters";
import { DomainMetrics } from "./metrics";
import { useDomainOverview } from "./queries";
import { DomainSearchForm } from "./search-form";
import { CompetitorsTab } from "./tab-competitors";
import { CountriesTab } from "./tab-countries";
import { KeywordsTab } from "./tab-keywords";
import { PagesTab } from "./tab-pages";
import type { DomainTabId, Market } from "./url-state";
import {
  DEFAULT_MARKET,
  domainSearchParams,
  isSearchable,
  readDomainSearch,
  searchKey,
} from "./url-state";

/**
 * Errors that make the whole report impossible rather than one tab's worth of
 * it. Both have a next step that is a link, and neither gets better by asking
 * the other five endpoints the same question, so the tabs stay unmounted.
 */
function blockingError(error: unknown): ApiError | null {
  if (!(error instanceof ApiError)) return null;
  return error.code === "no_credentials" || error.code === "spend_cap_exceeded"
    ? error
    : null;
}

export function DomainOverviewPage() {
  const [params, setParams] = useSearchParams();
  const { activeWorkspaceId, isPending: workspacesPending } =
    useActiveWorkspace();
  const { toast } = useToast();

  // The workspace's last market, so a bare /app/domain-overview opens where
  // this user works rather than resetting to the UK on every visit.
  const fallbackMarket = useMemo(
    () => readLastMarket(activeWorkspaceId) ?? DEFAULT_MARKET,
    [activeWorkspaceId],
  );

  const search = readDomainSearch(params, fallbackMarket);
  const ready = isSearchable(search);
  const key = searchKey(search);

  const [paid, setPaid] = useState(false);
  const [filters, setFilters] = useState<KeywordFilters>(EMPTY_FILTERS);
  /**
   * Which search the user has approved the ~$0.10 country breakdown for.
   * Storing the search key rather than a boolean means changing domain or
   * market cannot silently re-trigger ten calls under the old consent.
   */
  const [countriesFor, setCountriesFor] = useState<string | null>(null);

  const overview = useDomainOverview(activeWorkspaceId, search, ready);
  const locationsQuery = useMetaLocations(activeWorkspaceId);
  const blocked = blockingError(overview.error);

  // Unexpected failures also get a toast: the inline notice may be below the
  // fold when the failure lands on a tab the user just switched away from.
  const toastedError = useRef<unknown>(null);
  useEffect(() => {
    const error = overview.error;
    if (error === null || error === toastedError.current) return;
    if (blockingError(error) !== null) return;
    toastedError.current = error;
    toast({
      tone: "error",
      title: "Domain overview failed",
      description: errorMessage(error, "DataForSEO did not answer."),
    });
  }, [overview.error, toast]);

  const applySearch = useCallback(
    (next: { target: string } & Market) => {
      writeLastMarket(activeWorkspaceId, {
        location: next.location,
        language: next.language,
      });
      setParams(domainSearchParams({ ...next, tab: search.tab }));
    },
    [activeWorkspaceId, setParams, search.tab],
  );

  const selectTab = useCallback(
    (tab: string) => {
      // replace: a tab flick is not a navigation step anyone wants to unwind
      // one press at a time on the way back.
      setParams(domainSearchParams({ ...search, tab: tab as DomainTabId }), {
        replace: true,
      });
    },
    [search, setParams],
  );

  const analyzeCompetitor = useCallback(
    (domain: string) => {
      applySearch({
        target: domain,
        location: search.location,
        language: search.language,
      });
      // The header and metric cards above have just changed too; say so rather
      // than yanking the viewport up there.
      toast({ tone: "info", title: `Now analyzing ${domain}` });
    },
    [applySearch, search.location, search.language, toast],
  );

  const marketName = marketLabel(
    locationsQuery.data?.locations ?? [],
    search.location,
    search.language,
  );

  const tabs: TabItem[] = [
    {
      id: "keywords",
      label: "Top keywords",
      content: (
        <KeywordsTab
          workspaceId={activeWorkspaceId}
          search={search}
          paid={paid}
          onPaidChange={setPaid}
          filters={filters}
          onFiltersChange={setFilters}
        />
      ),
    },
    {
      id: "pages",
      label: "Top pages",
      content: <PagesTab workspaceId={activeWorkspaceId} search={search} />,
    },
    {
      id: "competitors",
      label: "Competitors",
      content: (
        <CompetitorsTab
          workspaceId={activeWorkspaceId}
          search={search}
          onAnalyze={analyzeCompetitor}
        />
      ),
    },
    {
      id: "countries",
      label: "Countries",
      content: (
        <CountriesTab
          workspaceId={activeWorkspaceId}
          search={search}
          requested={countriesFor === key}
          onRequest={() => setCountriesFor(key)}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={search.target === "" ? "Domain Overview" : search.target}
        description="Estimate any site's organic traffic, top keywords and pages, competitors, and country split."
        actions={
          ready ? <Badge variant="brand">{marketName}</Badge> : undefined
        }
      />

      {workspacesPending ? (
        <Skeleton className="h-28 w-full" />
      ) : activeWorkspaceId === null ? (
        <Card>
          <EmptyState
            title="No workspace"
            description="Create or join a workspace before running research."
          />
        </Card>
      ) : (
        <>
          <DomainSearchForm
            workspaceId={activeWorkspaceId}
            value={search}
            onSubmit={applySearch}
            busy={overview.isFetching}
          />

          {search.target === "" ? (
            <Card>
              <EmptyState
                icon={Globe}
                title="Analyze any domain"
                description="Enter a domain above to see its estimated traffic, the keywords and pages behind it, who it competes with, and how that splits by country."
              />
            </Card>
          ) : !ready ? (
            <Card>
              <EmptyState
                icon={SearchX}
                title={`"${search.target}" isn't a domain`}
                description="Enter a hostname like example.com — a full URL is fine too."
              />
            </Card>
          ) : blocked !== null ? (
            <ApiErrorNotice error={blocked} />
          ) : (
            <>
              <DomainMetrics workspaceId={activeWorkspaceId} search={search} />
              <Tabs tabs={tabs} value={search.tab} onValueChange={selectTab} />
            </>
          )}
        </>
      )}
    </div>
  );
}
