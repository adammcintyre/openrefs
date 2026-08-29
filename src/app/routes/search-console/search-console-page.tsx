/**
 * Search Console.
 *
 * **The whole screen is a state machine driven by one call.**
 * `GET /gsc/status` is documented as the only request the UI needs to choose
 * between five outcomes, and it never fails for a configuration reason — it
 * *is* the configuration report. So the page asks it once and switches:
 *
 *   status pending          → skeleton
 *   configured: false       → operator setup card (a normal state, not an error)
 *   connected: false        → "Connect Google Search Console"
 *   broken: true            → reconnect
 *   property: null          → property picker
 *   otherwise               → the reports
 *
 * The order matters and is not arbitrary: each state is a precondition for the
 * next, so testing them in this sequence means every branch below can assume
 * everything above it holds. Reports are only *requested* in the final state,
 * which is what keeps "connected but no property yet" a calm screen with a
 * picker on it rather than four failed requests.
 *
 * **Which project** follows the same rules as Rank Tracking — `?project=` wins,
 * then the last project used in this workspace, then the picker — reusing
 * `components/projects/project-selection.ts` so the precedence is defined once.
 *
 * **The OAuth callback lands here**, because a browser coming back from Google
 * has to land on a page rather than an API response. `components/gsc/callback.ts`
 * classifies the query string; this file performs the effects and then cleans
 * the parameters out of the URL so a reload cannot re-announce a stale result.
 *
 * **Nothing on this screen costs money.** The one exception is the SERP panel
 * behind "View SERP", which is a DataForSEO call and carries its own cost chip.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Download, LineChart } from "lucide-react";

import type {
  GscOpportunitiesResponse,
  GscPagesResponse,
  GscQueriesResponse,
  GscStatusResponse,
} from "../../../shared/gsc";
import type { Project } from "../../../shared/projects";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import { GscConnectPanel } from "../../components/gsc/connect-panel";
import {
  GscConnectionMenu,
  GscPropertyBadge,
} from "../../components/gsc/connection-menu";
import { FreshnessChip, RangeCaption } from "../../components/gsc/fresh-chip";
import { formatGscProperty } from "../../components/gsc/format";
import { GscOpportunities } from "../../components/gsc/opportunities";
import {
  GscDailyChart,
  GscOverviewMetrics,
} from "../../components/gsc/overview";
import { GscPropertyPicker } from "../../components/gsc/property-picker";
import {
  useGscOpportunities,
  useGscOverview,
  useGscPages,
  useGscQueries,
  useGscStatus,
} from "../../components/gsc/queries";
import { GscRangePicker } from "../../components/gsc/range-picker";
import {
  DEFAULT_GSC_RANGE,
  readLastGscRange,
  writeLastGscRange,
} from "../../components/gsc/range";
import type { GscRangeId } from "../../components/gsc/range";
import {
  GscPagesTable,
  GscQueriesTable,
} from "../../components/gsc/report-tables";
import { GscSetupCard } from "../../components/gsc/setup-card";
import {
  ProjectPicker,
  ProjectSelect,
  useCanCreateProject,
} from "../../components/projects/project-picker";
import { useProjects } from "../../components/projects/queries";
import {
  PROJECT_PARAM,
  projectSearchParams,
  readLastProjectId,
  resolveProjectId,
  writeLastProjectId,
} from "../../components/projects/project-selection";
import { SerpPanel } from "../../components/serp-panel";
import {
  Button,
  PageHeader,
  Skeleton,
  Tabs,
  useToast,
} from "../../components/ui";
import type { TabItem } from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { useActiveWorkspace } from "../../lib/workspaces";
import { useGscCallback } from "./use-callback";
import {
  GSC_CANNIBALIZATION_CSV_HEADERS,
  GSC_LOW_CTR_CSV_HEADERS,
  GSC_PAGE_CSV_HEADERS,
  GSC_QUERY_CSV_HEADERS,
  GSC_STRIKING_CSV_HEADERS,
  gscCannibalizationCsvRows,
  gscCsvFilename,
  gscLowCtrCsvRows,
  gscPageCsvRows,
  gscQueryCsvRows,
  gscStrikingCsvRows,
} from "./csv-rows";

const TAB_PARAM = "tab";
const TAB_IDS = ["queries", "pages", "opportunities"] as const;
type TabId = (typeof TAB_IDS)[number];

function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as ReadonlyArray<string>).includes(value);
}

/* ------------------------------- the screen -------------------------------- */

export function SearchConsolePage() {
  const { activeWorkspaceId, isPending: workspacePending } =
    useActiveWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  const projectsQuery = useProjects(activeWorkspaceId);
  const projects = useMemo(
    () => projectsQuery.data?.projects ?? [],
    [projectsQuery.data],
  );

  const projectId = resolveProjectId(projects, {
    fromUrl: searchParams.get(PROJECT_PARAM),
    fromStorage: readLastProjectId(activeWorkspaceId),
  });
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;

  const selectProject = useCallback(
    (next: Project) => {
      writeLastProjectId(activeWorkspaceId, next.id);
      setSearchParams((current) => projectSearchParams(current, next.id), {
        replace: true,
      });
    },
    [activeWorkspaceId, setSearchParams],
  );

  /*
   * Consume `?connected=1` / `?error=` before anything else renders a decision
   * based on them. The hook owns the toast, the status refetch and the URL
   * clean-up; this page only shows whatever notice is left over.
   */
  const callbackNotice = useGscCallback({
    workspaceId: activeWorkspaceId,
    projectId,
  });

  /*
   * Heal a stale URL: `?project=` naming a project that no longer exists (or
   * belongs to another tenant) resolved to null above, and leaving it in place
   * would trap the page in a state a reload cannot escape.
   */
  const urlProjectId = searchParams.get(PROJECT_PARAM);
  useEffect(() => {
    if (urlProjectId === null || projectsQuery.isPending) return;
    if (projects.some((candidate) => candidate.id === urlProjectId)) return;
    setSearchParams((current) => projectSearchParams(current, null), {
      replace: true,
    });
  }, [urlProjectId, projects, projectsQuery.isPending, setSearchParams]);

  if (workspacePending || projectsQuery.isPending) {
    return <PageSkeleton />;
  }

  if (project === null) {
    return (
      <div className="flex flex-col">
        <PageHeader
          title="Search Console"
          description="Your own click and impression data, straight from Google — and the three lists that turn it into work."
        />
        {callbackNotice}
        <ProjectPicker
          workspaceId={activeWorkspaceId}
          selectedId={null}
          onSelect={selectProject}
          description="Search Console connects per project, because each one is a different site with its own Google property. Pick a project to connect or view."
        />
      </div>
    );
  }

  return (
    <ProjectSearchConsole
      key={project.id}
      workspaceId={activeWorkspaceId}
      project={project}
      onSelectProject={selectProject}
      notice={callbackNotice}
    />
  );
}

/* --------------------------- the connection states ------------------------- */

function ProjectSearchConsole({
  workspaceId,
  project,
  onSelectProject,
  notice,
}: {
  workspaceId: string | null;
  project: Project;
  onSelectProject: (project: Project) => void;
  notice: React.ReactNode;
}) {
  const status = useGscStatus(workspaceId, project.id);
  const canAdminister = useCanCreateProject();

  const header = (actions?: React.ReactNode) => (
    <PageHeader
      title={project.name}
      description={`Search Console · ${project.domain}`}
      actions={
        <>
          <ProjectSelect
            workspaceId={workspaceId}
            selectedId={project.id}
            onSelect={onSelectProject}
          />
          {actions}
        </>
      }
    />
  );

  if (status.isPending) {
    return (
      <div className="flex flex-col">
        {header()}
        {notice}
        <Skeleton className="h-72 w-full rounded-app" />
      </div>
    );
  }

  if (status.isError) {
    return (
      <div className="flex flex-col gap-4">
        {header()}
        {notice}
        <ApiErrorNotice
          error={status.error}
          onRetry={() => void status.refetch()}
          fallback="Could not check this project's Search Console connection."
        />
      </div>
    );
  }

  const state: GscStatusResponse = status.data;

  /* No Google OAuth client on this deployment. Normal, and not an error. */
  if (!state.configured) {
    return (
      <div className="flex flex-col gap-4">
        {header()}
        {notice}
        <GscSetupCard canAdminister={canAdminister} />
      </div>
    );
  }

  /* Configured, but this project has never been connected — or its grant died. */
  if (!state.connected || state.broken) {
    return (
      <div className="flex flex-col gap-4">
        {header()}
        {notice}
        <GscConnectPanel
          workspaceId={workspaceId}
          project={project}
          broken={state.broken}
          canAdminister={canAdminister}
        />
      </div>
    );
  }

  /* Connected, but nobody has said which property this project reads. */
  if (state.property === null) {
    return (
      <div className="flex flex-col gap-4">
        {header()}
        {notice}
        <GscPropertyPicker
          workspaceId={workspaceId}
          project={project}
          canAdminister={canAdminister}
        />
      </div>
    );
  }

  return (
    <GscReports
      workspaceId={workspaceId}
      project={project}
      property={state.property}
      canAdminister={canAdminister}
      onSelectProject={onSelectProject}
      notice={notice}
    />
  );
}

/* --------------------------------- reports --------------------------------- */

function GscReports({
  workspaceId,
  project,
  property,
  canAdminister,
  onSelectProject,
  notice,
}: {
  workspaceId: string | null;
  project: Project;
  property: string;
  canAdminister: boolean;
  onSelectProject: (project: Project) => void;
  notice: React.ReactNode;
}) {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  /*
   * The remembered window is read once, on mount. Reading it every render would
   * fight the user: after they pick 6 months, the next render would restore
   * whatever was in storage before the write landed.
   */
  const [range, setRange] = useState<GscRangeId>(
    () => readLastGscRange(project.id) ?? DEFAULT_GSC_RANGE,
  );

  const onRangeChange = useCallback(
    (next: GscRangeId) => {
      setRange(next);
      writeLastGscRange(project.id, next);
    },
    [project.id],
  );

  const urlTab = searchParams.get(TAB_PARAM);
  const tab: TabId = isTabId(urlTab) ? urlTab : "queries";
  const onTabChange = useCallback(
    (next: string) => {
      // `replace`: switching tabs is changing what you are looking at, not
      // navigating somewhere new, and stacking history would make Back walk
      // through every tab you touched.
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set(TAB_PARAM, next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const overview = useGscOverview(workspaceId, project.id, range, true);
  const queries = useGscQueries(workspaceId, project.id, range, true);
  const pages = useGscPages(workspaceId, project.id, range, true);
  const opportunities = useGscOpportunities(workspaceId, project.id, range, true);

  const [serpKeyword, setSerpKeyword] = useState<string | null>(null);

  const freshness = overview.data ?? queries.data ?? opportunities.data;

  function exportRows(
    report: string,
    headers: ReadonlyArray<string>,
    rows: ReturnType<typeof gscQueryCsvRows>,
  ) {
    if (rows.length === 0) return;
    downloadCsv(
      gscCsvFilename(property, report, freshness?.to ?? "latest"),
      [...headers],
      rows,
    );
    toast({
      title: "Export started",
      description: `${rows.length.toLocaleString("en")} rows — exactly the rows loaded here, not the whole set.`,
      tone: "success",
    });
  }

  const tabs: TabItem[] = [
    {
      id: "queries",
      label: "Queries",
      content: (
        <TabPanel
          error={queries.error}
          onRetry={() => void queries.refetch()}
          fallback="Could not load this property's queries."
          onExport={() =>
            exportRows(
              "queries",
              GSC_QUERY_CSV_HEADERS,
              gscQueryCsvRows(queries.data?.rows ?? []),
            )
          }
          exportDisabled={(queries.data?.rows.length ?? 0) === 0}
          note={truncatedNote(queries.data)}
        >
          <GscQueriesTable
            rows={queries.data?.rows ?? []}
            loading={queries.isPending}
            property={formatGscProperty(property)}
          />
        </TabPanel>
      ),
    },
    {
      id: "pages",
      label: "Pages",
      content: (
        <TabPanel
          error={pages.error}
          onRetry={() => void pages.refetch()}
          fallback="Could not load this property's pages."
          onExport={() =>
            exportRows(
              "pages",
              GSC_PAGE_CSV_HEADERS,
              gscPageCsvRows(pages.data?.rows ?? []),
            )
          }
          exportDisabled={(pages.data?.rows.length ?? 0) === 0}
          note={truncatedNote(pages.data)}
        >
          <GscPagesTable
            rows={pages.data?.rows ?? []}
            loading={pages.isPending}
            property={formatGscProperty(property)}
          />
        </TabPanel>
      ),
    },
    {
      id: "opportunities",
      label: "Opportunities",
      content: opportunities.isError ? (
        <ApiErrorNotice
          error={opportunities.error}
          onRetry={() => void opportunities.refetch()}
          fallback="Could not work out this property's opportunities."
        />
      ) : (
        <GscOpportunities
          data={opportunities.data}
          loading={opportunities.isPending}
          property={formatGscProperty(property)}
          onViewSerp={setSerpKeyword}
          onExport={(rule) => exportOpportunities(rule)}
        />
      ),
    },
  ];

  function exportOpportunities(
    rule: "striking" | "lowCtr" | "cannibalization",
  ): void {
    const data: GscOpportunitiesResponse | undefined = opportunities.data;
    if (data === undefined) return;
    if (rule === "striking") {
      exportRows(
        "striking-distance",
        GSC_STRIKING_CSV_HEADERS,
        gscStrikingCsvRows(data.strikingDistance.items),
      );
    } else if (rule === "lowCtr") {
      exportRows(
        "low-ctr",
        GSC_LOW_CTR_CSV_HEADERS,
        gscLowCtrCsvRows(data.lowCtr.items),
      );
    } else {
      exportRows(
        "cannibalization",
        GSC_CANNIBALIZATION_CSV_HEADERS,
        gscCannibalizationCsvRows(data.cannibalization.items),
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{project.domain}</span>
            <span aria-hidden="true">·</span>
            <GscPropertyBadge property={property} />
            <RangeCaption range={freshness} />
          </span>
        }
        actions={
          <>
            <ProjectSelect
              workspaceId={workspaceId}
              selectedId={project.id}
              onSelect={onSelectProject}
            />
            <GscRangePicker value={range} onChange={onRangeChange} />
            <GscConnectionMenu
              workspaceId={workspaceId}
              project={project}
              property={property}
              canAdminister={canAdminister}
            />
          </>
        }
      />

      {notice}

      {/*
        The slot every other module fills with a cost chip. Nothing here spends,
        so it reports how current the numbers are instead.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <FreshnessChip range={freshness} cached={freshness?.cached} />
      </div>

      {overview.isError ? (
        <ApiErrorNotice
          error={overview.error}
          onRetry={() => void overview.refetch()}
          fallback="Could not load this property's overview."
        />
      ) : (
        <>
          <GscOverviewMetrics
            data={overview.data}
            loading={overview.isPending}
          />
          <GscDailyChart data={overview.data} loading={overview.isPending} />
        </>
      )}

      <Tabs tabs={tabs} value={tab} onValueChange={onTabChange} />

      {/*
        The one billed thing on this screen, and only reachable from a
        striking-distance row. It carries its own cost chip.
      */}
      {workspaceId !== null && serpKeyword !== null ? (
        <SerpPanel
          workspaceId={workspaceId}
          keyword={serpKeyword}
          locationCode={project.locationCode}
          languageCode={project.languageCode}
          open
          onClose={() => setSerpKeyword(null)}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------- pieces ---------------------------------- */

/** "Showing the top 200 of 1,043", for the two plain report tables. */
function truncatedNote(
  data: GscQueriesResponse | GscPagesResponse | undefined,
): string | null {
  if (data === undefined) return null;
  const shown = data.rows.length;
  if (data.total <= shown) return null;
  return `Showing the top ${shown.toLocaleString("en")} of ${data.total.toLocaleString("en")} by clicks. The CSV exports these ${shown.toLocaleString("en")} rows.`;
}

function TabPanel({
  error,
  onRetry,
  fallback,
  onExport,
  exportDisabled,
  note,
  children,
}: {
  error: unknown;
  onRetry: () => void;
  fallback: string;
  onExport: () => void;
  exportDisabled: boolean;
  note: string | null;
  children: React.ReactNode;
}) {
  if (error !== null && error !== undefined) {
    return (
      <ApiErrorNotice error={error} onRetry={onRetry} fallback={fallback} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{note ?? ""}</p>
        <Button
          size="sm"
          variant="secondary"
          onClick={onExport}
          disabled={exportDisabled}
        >
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>
      {children}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 pb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 w-full rounded-app" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-app" />
      <span className="sr-only">
        <LineChart aria-hidden="true" /> Loading Search Console…
      </span>
    </div>
  );
}
