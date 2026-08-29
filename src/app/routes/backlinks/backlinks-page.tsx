/**
 * Backlinks — the screen.
 *
 * The URL owns the report (`?target=&tab=&mode=&range=`), so this component is
 * mostly a translator: query string in, three tabs out. The only state it holds
 * locally is the filter set, which stays out of the URL on purpose — those
 * filters are applied by DataForSEO, so a shared link carrying them would spend
 * the recipient's credits on someone else's narrowing before they had seen the
 * unfiltered profile.
 *
 * There is no market anywhere on this screen. A link profile is a property of
 * the web rather than of a search market, and the Backlinks API has no location
 * parameter to offer one.
 */
import { Link2, SearchX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import type { BacklinksListMode } from "../../../shared/backlinks";
import { targetKind } from "../../components/backlinks/target";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
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
import type { HistoryRange } from "./history-range";
import type { LinkFilters } from "./link-filters";
import { EMPTY_LINK_FILTERS } from "./link-filters";
import { BacklinksMetrics } from "./metrics";
import { useBacklinksSummary } from "./queries";
import { BacklinksSearchForm } from "./search-form";
import { AnchorsTab } from "./tab-anchors";
import { BacklinksTab } from "./tab-backlinks";
import { ReferringDomainsTab } from "./tab-referring-domains";
import type { BacklinkTabId } from "./url-state";
import {
  backlinksSearchParams,
  isSearchable,
  readBacklinksSearch,
} from "./url-state";

/**
 * Errors that make the whole report impossible rather than one tab's worth of
 * it. Both have a next step that is a link, and neither gets better by asking
 * the other four endpoints the same question, so the tabs stay unmounted.
 */
function blockingError(error: unknown): ApiError | null {
  if (!(error instanceof ApiError)) return null;
  return error.code === "no_credentials" || error.code === "spend_cap_exceeded"
    ? error
    : null;
}

export function BacklinksPage() {
  const [params, setParams] = useSearchParams();
  const { activeWorkspaceId, isPending: workspacesPending } =
    useActiveWorkspace();
  const { toast } = useToast();

  const search = readBacklinksSearch(params);
  const ready = isSearchable(search);

  const [filters, setFilters] = useState<LinkFilters>(EMPTY_LINK_FILTERS);

  const summary = useBacklinksSummary(activeWorkspaceId, search.target, ready);
  const blocked = blockingError(summary.error);

  // Unexpected failures also get a toast: the inline notice may be below the
  // fold when the failure lands on a tab the user just switched away from.
  const toastedError = useRef<unknown>(null);
  useEffect(() => {
    const error = summary.error;
    if (error === null || error === toastedError.current) return;
    if (blockingError(error) !== null) return;
    toastedError.current = error;
    toast({
      tone: "error",
      title: "Backlinks lookup failed",
      description: errorMessage(error, "DataForSEO did not answer."),
    });
  }, [summary.error, toast]);

  const applyTarget = useCallback(
    (target: string) => {
      // A new target invalidates the old target's filters — "min Domain Score
      // 40" carried silently onto a different site is a filtered report that
      // looks like a small one.
      setFilters(EMPTY_LINK_FILTERS);
      setParams(backlinksSearchParams({ ...search, target }));
    },
    [search, setParams],
  );

  /**
   * Tab, mode and range flicks all `replace`: none of them is a navigation step
   * anyone wants to unwind one press at a time on the way back.
   */
  const patchSearch = useCallback(
    (patch: Partial<{ tab: BacklinkTabId; mode: BacklinksListMode; range: HistoryRange }>) => {
      setParams(backlinksSearchParams({ ...search, ...patch }), {
        replace: true,
      });
    },
    [search, setParams],
  );

  const analyzeDomain = useCallback(
    (domain: string) => {
      applyTarget(domain);
      // The header and metric cards above have just changed too; say so rather
      // than yanking the viewport up there.
      toast({ tone: "info", title: `Now analyzing ${domain}` });
    },
    [applyTarget, toast],
  );

  const tabs: TabItem[] = [
    {
      id: "backlinks",
      label: "Backlinks",
      content: (
        <BacklinksTab
          workspaceId={activeWorkspaceId}
          target={search.target}
          mode={search.mode}
          onModeChange={(mode) => patchSearch({ mode })}
          filters={filters}
          onFiltersChange={setFilters}
        />
      ),
    },
    {
      id: "referring",
      label: "Referring domains",
      content: (
        <ReferringDomainsTab
          workspaceId={activeWorkspaceId}
          target={search.target}
          onAnalyze={analyzeDomain}
        />
      ),
    },
    {
      id: "anchors",
      label: "Anchors",
      content: (
        <AnchorsTab workspaceId={activeWorkspaceId} target={search.target} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={search.target === "" ? "Backlinks" : search.target}
        description="Any site's Domain Score, backlink profile, referring domains, anchors, and growth over time."
        actions={
          ready ? (
            <Badge variant="brand">
              {targetKind(search.target) === "url" ? "Single page" : "Whole domain"}
            </Badge>
          ) : undefined
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
          <BacklinksSearchForm
            value={search.target}
            onSubmit={applyTarget}
            busy={summary.isFetching}
          />

          {search.target === "" ? (
            <Card>
              <EmptyState
                icon={Link2}
                title="Analyze any link profile"
                description="Enter a domain to see its Domain Score, who links to it and with what anchor text — or paste a page URL to analyze links to that one page."
              />
            </Card>
          ) : !ready ? (
            <Card>
              <EmptyState
                icon={SearchX}
                title={`"${search.target}" isn't a domain or URL`}
                description="Enter a hostname like example.com, or a full address like https://example.com/page."
              />
            </Card>
          ) : blocked !== null ? (
            <ApiErrorNotice error={blocked} />
          ) : (
            <>
              <BacklinksMetrics
                workspaceId={activeWorkspaceId}
                target={search.target}
                range={search.range}
                onRangeChange={(range) => patchSearch({ range })}
              />
              <Tabs
                tabs={tabs}
                value={search.tab}
                onValueChange={(tab) => patchSearch({ tab: tab as BacklinkTabId })}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
