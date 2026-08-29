/**
 * AI Visibility.
 *
 * The screen has two shapes, like Rank Tracking. With no project selected it
 * *is* the project picker — choosing a site is the only useful thing to do.
 * With one selected it is a header, a "Run now" button and two tabbed areas:
 * the prompts you are tracking, and what the assistants said.
 *
 * **Which project.** `?project=` wins, then the last project used in this
 * workspace, then nothing. The precedence and the validation live in
 * `components/projects/project-selection.ts` and are unit-tested there; this
 * file only wires them to the URL and to localStorage.
 *
 * **Waiting is a first-class state.** A run buys live LLM answers, each
 * documented at up to two minutes, and a project's first run happens the
 * moment its first prompt is added. So `runInProgress` drives a quiet chip in
 * the header, the prompts query polls itself while it is true, and the results
 * are invalidated when it clears — the screen fills itself in rather than
 * needing a reload.
 */
import { KeyRound, Loader } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import type { Project } from "../../../shared/projects";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
import {
  useAiPrompts,
  useRefreshResultsWhenRunCompletes,
} from "../../components/ai/queries";
import { RunNowButton } from "../../components/ai/run-now-button";
import {
  ProjectPicker,
  ProjectSelect,
  useCanCreateProject,
} from "../../components/projects/project-picker";
import {
  PROJECT_PARAM,
  projectSearchParams,
  readLastProjectId,
  resolveProjectId,
  writeLastProjectId,
} from "../../components/projects/project-selection";
import { useProjects } from "../../components/projects/queries";
import { Badge, PageHeader, Skeleton, Tabs } from "../../components/ui";
import { useActiveWorkspace } from "../../lib/workspaces";
import { PromptsPanel } from "./prompts-panel";
import { ResultsPanel } from "./results-panel";

/** Which area is showing. In the URL so either is linkable. */
const VIEW_PARAM = "view";
type View = "prompts" | "results";

function readView(value: string | null): View {
  return value === "results" ? "results" : "prompts";
}

export function AiVisibilityPage() {
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
   * looking at, not navigating somewhere new.
   */
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
   * Heal a stale URL. `?project=` naming a project that no longer exists (or
   * belongs to another tenant) resolved to null above; leaving the parameter
   * would keep the page in a state a reload cannot escape.
   */
  const urlProjectId = searchParams.get(PROJECT_PARAM);
  useEffect(() => {
    if (urlProjectId === null || projectsQuery.isPending) return;
    if (projects.some((candidate) => candidate.id === urlProjectId)) return;
    setSearchParams((current) => projectSearchParams(current, null), {
      replace: true,
    });
  }, [urlProjectId, projects, projectsQuery.isPending, setSearchParams]);

  const view = readView(searchParams.get(VIEW_PARAM));
  const setView = useCallback(
    (next: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next === "prompts") params.delete(VIEW_PARAM);
          else params.set(VIEW_PARAM, next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  if (workspacePending || projectsQuery.isPending) {
    return <PageSkeleton />;
  }

  if (project === null) {
    return (
      <div className="flex flex-col">
        <PageHeader
          title="AI Visibility"
          description="Whether AI assistants mention and cite your site when people ask the questions your buyers ask."
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
    <ProjectAiVisibility
      key={project.id}
      workspaceId={activeWorkspaceId}
      project={project}
      onSelectProject={selectProject}
      credentialsConfigured={activeWorkspace?.credentials.configured ?? true}
      view={view}
      onViewChange={setView}
    />
  );
}

/* ------------------------------ the real screen ---------------------------- */

function ProjectAiVisibility({
  workspaceId,
  project,
  onSelectProject,
  credentialsConfigured,
  view,
  onViewChange,
}: {
  workspaceId: string | null;
  project: Project;
  onSelectProject: (project: Project) => void;
  credentialsConfigured: boolean;
  view: View;
  onViewChange: (view: string) => void;
}) {
  const promptsQuery = useAiPrompts(workspaceId, project.id);
  const canAdminister = useCanCreateProject();

  const prompts = useMemo(
    () => promptsQuery.data?.prompts ?? [],
    [promptsQuery.data],
  );
  const runInProgress = promptsQuery.data?.runInProgress ?? false;

  // The prompts query is the only thing polling; results piggyback on its
  // flag rather than running a second timer against a window that only
  // changes when a run lands.
  useRefreshResultsWhenRunCompletes(workspaceId, project.id, runInProgress);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{project.domain}</span>
            <span aria-hidden="true">·</span>
            <span>
              {prompts.length === 1 ? "1 prompt" : `${prompts.length} prompts`}
            </span>
            <span aria-hidden="true">·</span>
            <span>Runs weekly</span>
            {runInProgress ? <RunningChip /> : null}
          </span>
        }
        actions={
          <>
            <ProjectSelect
              workspaceId={workspaceId}
              selectedId={project.id}
              onSelect={onSelectProject}
            />
            <RunNowButton
              workspaceId={workspaceId}
              projectId={project.id}
              prompts={prompts}
              canRun={canAdminister}
              runInProgress={runInProgress}
            />
          </>
        }
      />

      {/*
        Like rank tracking, this module keeps spending after you close the tab:
        the weekly run happens whether or not anyone is looking. Without
        credentials it would keep failing quietly, so this says so once, up
        front, rather than leaving a project that never fills in.
      */}
      {credentialsConfigured ? null : <NoCredentialsNotice />}

      {promptsQuery.isError ? (
        <ApiErrorNotice
          error={promptsQuery.error}
          onRetry={() => void promptsQuery.refetch()}
          fallback="Could not load this project's prompts."
        />
      ) : (
        <Tabs
          value={view}
          onValueChange={onViewChange}
          tabs={[
            {
              id: "prompts",
              label: "Prompts",
              content: (
                <PromptsPanel
                  workspaceId={workspaceId}
                  project={project}
                  prompts={prompts}
                  loading={promptsQuery.isPending}
                  runInProgress={runInProgress}
                  canAdminister={canAdminister}
                />
              ),
            },
            {
              id: "results",
              label: "Results",
              content: (
                <ResultsPanel
                  workspaceId={workspaceId}
                  project={project}
                  hasPrompts={prompts.length > 0}
                  runInProgress={runInProgress}
                  onAddPrompts={() => onViewChange("prompts")}
                />
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

/* --------------------------------- pieces ---------------------------------- */

/**
 * The "running…" indicator.
 *
 * Deliberately quiet: a run takes minutes, so anything attention-seeking would
 * be attention-seeking for a long time. `aria-live="polite"` announces it once
 * when it appears rather than interrupting.
 */
function RunningChip() {
  return (
    <Badge variant="info" aria-live="polite">
      <Loader className="size-3 animate-spin" aria-hidden="true" />
      Running…
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
        <p className="text-sm font-semibold">Connect your DataForSEO account</p>
        <p className="text-sm leading-relaxed">
          AI answers are bought through your own DataForSEO key. Prompts can be
          written now, but nothing will run until this workspace has
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
      <Skeleton className="h-10 w-64 rounded-app" />
      <Skeleton className="h-96 w-full rounded-app" />
    </div>
  );
}
