/**
 * Rank Tracking.
 *
 * The screen has two shapes. With no project selected it *is* the project
 * picker — choosing a site is the only useful thing to do, so it is the page
 * rather than a control on it. With one selected it is a header, four metric
 * cards, the movers panel and the table.
 *
 * **Which project.** `?project=` wins, then the last project used in this
 * workspace, then nothing (the picker). The precedence and the validation live
 * in `components/projects/project-selection.ts` and are unit-tested there; this
 * file only wires them to the URL and to localStorage. Selecting a project
 * writes both, so the URL is always shareable and the choice survives a reload.
 *
 * **Waiting is a first-class state.** A newly tracked keyword has no snapshot
 * for 5–20 minutes while the SERP task queue runs. That is the normal case
 * right after Add keywords, not an error and not "no data" — so the table says
 * "awaiting first check" per row, the header shows a quiet "checking…", and
 * the query polls itself until `checkInProgress` clears.
 */
import { Download, KeyRound, ListPlus, Loader, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { Project } from "../../../shared/projects";
import type { TrackedKeywordRow } from "../../../shared/tracking";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import { ProjectPicker, ProjectSelect, useCanCreateProject } from "../../components/projects/project-picker";
import {
  PROJECT_PARAM,
  projectSearchParams,
  readLastProjectId,
  resolveProjectId,
  writeLastProjectId,
} from "../../components/projects/project-selection";
import { AddKeywordsDialog } from "../../components/tracking/add-keywords-dialog";
import { CheckNowButton } from "../../components/tracking/check-now-button";
import {
  formatLastChecked,
  pluralKeywords,
} from "../../components/tracking/format";
import { TrackingMetrics } from "../../components/tracking/metric-cards";
import { MoversPanel } from "../../components/tracking/movers-panel";
import { RankOverviewChart } from "../../components/tracking/rank-overview-chart";
import {
  useRemoveTrackedKeywords,
  useTrackedKeywords,
} from "../../components/tracking/queries";
import { TrackingTable } from "../../components/tracking/tracking-table";
import { useProjects } from "../../components/projects/queries";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Skeleton,
  useToast,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { useActiveWorkspace } from "../../lib/workspaces";
import {
  TRACKING_CSV_HEADERS,
  trackingCsvFilename,
  trackingCsvRows,
} from "./csv-rows";

export function RankTrackingPage() {
  const { activeWorkspace, activeWorkspaceId, isPending: workspacePending } =
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

  /*
   * A selection made anywhere on the page lands in both the URL and storage.
   * `replace` rather than push: switching project is changing what you are
   * looking at, not navigating somewhere new, and stacking history entries
   * would make Back walk through every switch.
   */
  const selectProject = useCallback(
    (next: Project) => {
      writeLastProjectId(activeWorkspaceId, next.id);
      setSearchParams(
        (current) => projectSearchParams(current, next.id),
        { replace: true },
      );
    },
    [activeWorkspaceId, setSearchParams],
  );

  /*
   * Heal a stale URL. `?project=` naming a project that no longer exists (or
   * belongs to another tenant) resolved to null above; leaving the parameter
   * in place would keep the page in a state a reload cannot escape.
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
          title="Rank Tracking"
          description="Daily positions for the keywords that matter to a site you own."
        />
        <ProjectPicker
          workspaceId={activeWorkspaceId}
          selectedId={null}
          onSelect={selectProject}
        />
      </div>
    );
  }

  return (
    <ProjectTracking
      key={project.id}
      workspaceId={activeWorkspaceId}
      project={project}
      onSelectProject={selectProject}
      credentialsConfigured={
        activeWorkspace?.credentials.configured ?? true
      }
    />
  );
}

/* ------------------------------ the real screen ---------------------------- */

function ProjectTracking({
  workspaceId,
  project,
  onSelectProject,
  credentialsConfigured,
}: {
  workspaceId: string | null;
  project: Project;
  onSelectProject: (project: Project) => void;
  credentialsConfigured: boolean;
}) {
  const { toast } = useToast();
  const query = useTrackedKeywords(workspaceId, project.id);
  const removeKeywords = useRemoveTrackedKeywords(workspaceId, project.id);
  const canAdminister = useCanCreateProject();

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<TrackedKeywordRow[] | null>(
    null,
  );

  const rows = useMemo(() => query.data?.keywords ?? [], [query.data]);
  const checkInProgress = query.data?.checkInProgress ?? false;

  const onToggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onToggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
    },
    [rows],
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  async function confirmRemoval() {
    const targets = pendingRemoval;
    if (targets === null || targets.length === 0) return;

    try {
      const result = await removeKeywords.mutateAsync({
        ids: targets.map((row) => row.id),
      });
      setSelected(new Set());
      setPendingRemoval(null);
      toast({
        title: `Stopped tracking ${pluralKeywords(result.removed)}`,
        description: `${pluralKeywords(result.keywordCount)} left in "${project.name}".`,
        tone: "success",
      });
    } catch (caught) {
      setPendingRemoval(null);
      toast({
        title: "Could not remove those keywords",
        description:
          caught instanceof Error ? caught.message : "Something went wrong.",
        tone: "error",
      });
    }
  }

  function exportCsv() {
    downloadCsv(
      trackingCsvFilename(project.domain),
      [...TRACKING_CSV_HEADERS],
      trackingCsvRows(rows),
    );
  }

  const isLoading = query.isPending;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{project.domain}</span>
            <span aria-hidden="true">·</span>
            <span>{pluralKeywords(rows.length)}</span>
            <span aria-hidden="true">·</span>
            <span>{`Last checked: ${formatLastChecked(query.data?.lastCheckedAt ?? null)}`}</span>
            {checkInProgress ? <CheckingChip /> : null}
          </span>
        }
        actions={
          <>
            <ProjectSelect
              workspaceId={workspaceId}
              selectedId={project.id}
              onSelect={onSelectProject}
            />
            <CheckNowButton
              workspaceId={workspaceId}
              project={project}
              keywordCount={rows.length}
              canCheck={canAdminister}
              checkInProgress={checkInProgress}
            />
            <Button onClick={() => setAdding(true)}>
              <ListPlus className="size-4" aria-hidden="true" />
              Add keywords
            </Button>
          </>
        }
      />

      {/*
        Tracking is the one module that keeps spending after you close the tab:
        the daily sweep runs whether or not anyone is looking. Without
        credentials it will keep failing quietly, so this says so once, up
        front, rather than leaving a project that never fills in.
      */}
      {credentialsConfigured ? null : <NoCredentialsNotice />}

      {query.isError ? (
        <ApiErrorNotice
          error={query.error}
          onRetry={() => void query.refetch()}
          fallback="Could not load this project's tracked keywords."
        />
      ) : (
        <>
          {/*
            The overview chart, full width above everything else — the shape of
            the month before the numbers that make it up.

            Only once there is something to plot: a project with no tracked
            keywords has no snapshots by definition, and an empty chart above an
            empty table is two ways of saying the same nothing.
          */}
          {rows.length > 0 ? (
            <RankOverviewChart
              workspaceId={workspaceId}
              projectId={project.id}
            />
          ) : null}

          <TrackingMetrics rows={rows} loading={isLoading} />

          <MoversPanel rows={rows} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {checkInProgress
                ? "A check is running. New positions appear here as they land."
                : "Positions are checked once a day."}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={exportCsv}
              disabled={rows.length === 0}
            >
              <Download className="size-3.5" aria-hidden="true" />
              Export CSV
            </Button>
          </div>

          {selected.size > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-app border border-primary/40 bg-tint p-3">
              <p
                className="text-sm font-medium text-tint-foreground"
                aria-live="polite"
              >
                {`${pluralKeywords(selected.size)} selected`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setPendingRemoval(selectedRows)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Stop tracking
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(new Set())}
                >
                  <X className="size-3.5" aria-hidden="true" />
                  Clear
                </Button>
              </div>
            </div>
          ) : null}

          <TrackingTable
            rows={rows}
            loading={isLoading}
            caption={`Tracked keywords for ${project.domain}`}
            selected={selected}
            onToggle={onToggle}
            onToggleAll={onToggleAll}
            onRemove={setPendingRemoval}
            emptyState={
              <EmptyState
                icon={ListPlus}
                title="No keywords tracked yet"
                description={`Add the searches you want to follow for ${project.domain}. The first check usually completes within 5 to 20 minutes; after that, positions refresh daily.`}
                action={
                  <Button onClick={() => setAdding(true)}>
                    <ListPlus className="size-4" aria-hidden="true" />
                    Add keywords
                  </Button>
                }
              />
            }
          />
        </>
      )}

      <AddKeywordsDialog
        workspaceId={workspaceId}
        project={project}
        open={adding}
        onClose={() => setAdding(false)}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        onConfirm={() => void confirmRemoval()}
        loading={removeKeywords.isPending}
        title={
          pendingRemoval !== null && pendingRemoval.length === 1
            ? `Stop tracking "${pendingRemoval[0]?.keyword}"?`
            : `Stop tracking ${pluralKeywords(pendingRemoval?.length ?? 0)}?`
        }
        description="Their position history is deleted too, and re-adding them starts from scratch."
        confirmLabel="Stop tracking"
      />
    </div>
  );
}

/* --------------------------------- pieces ---------------------------------- */

/**
 * The "checking…" indicator.
 *
 * Deliberately quiet: a check takes minutes, so anything attention-seeking
 * would be attention-seeking for a long time. `aria-live="polite"` announces
 * it once when it appears rather than interrupting.
 */
function CheckingChip() {
  return (
    <Badge variant="info" aria-live="polite">
      <Loader className="size-3 animate-spin" aria-hidden="true" />
      Checking…
    </Badge>
  );
}

function NoCredentialsNotice() {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-app border border-info-subtle bg-info-subtle p-4 text-info-on-subtle sm:flex-row sm:items-start"
    >
      <KeyRound className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-semibold">
          Connect your DataForSEO account
        </p>
        <p className="text-sm leading-relaxed">
          Rank checks run on your own DataForSEO key. Keywords can be tracked
          now, but no positions will be collected until this workspace has
          credentials.
        </p>
      </div>
      <Link
        to="/app/settings/data-provider"
        className="inline-flex h-8 shrink-0 items-center rounded-app border border-current px-3 text-xs font-medium hover:underline"
      >
        Add credentials
      </Link>
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
      <Skeleton className="h-96 w-full rounded-app" />
    </div>
  );
}
