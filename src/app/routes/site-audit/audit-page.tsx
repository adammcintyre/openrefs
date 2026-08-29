/**
 * Site Audit.
 *
 * The screen has two shapes, like Rank Tracking: with no project selected it
 * *is* the project picker, and with one selected it is that project's audits.
 * Project resolution (`?project=`, then last-used, then nothing) reuses
 * components/projects/project-selection.ts rather than reimplementing it.
 *
 * **Which audit.** `?audit=` when it names one this project actually has, and
 * the most recent otherwise. Selecting from the history writes the parameter,
 * so a particular audit is a shareable URL.
 *
 * **Waiting is a first-class state.** A crawl takes one to three minutes and
 * produces nothing until it ends, so "running" is a designed screen with a
 * progress bar, not a spinner over an empty layout. The detail query polls
 * every 10s while the audit is in flight and stops the moment it is not.
 *
 * **Credentials and the spend cap are states, not errors.** Both are conditions
 * with a next step and a link, so they render as notices (via ApiErrorNotice's
 * mapping) rather than as red failures, and the Run button goes with them.
 */
import { Gauge, KeyRound, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { AuditCategoryResult, AuditListItem } from "../../../shared/audits";
import type { Project } from "../../../shared/projects";
import { AuditProgressCard } from "../../components/audit/audit-progress";
import {
  estimateAuditCostUsd,
  formatCostCeiling,
} from "../../components/audit/cost";
import { CoreWebVitalsStrip } from "../../components/audit/cwv-strip";
import {
  formatAuditTime,
  isInFlight,
  pluralPages,
} from "../../components/audit/format";
import { HealthScore } from "../../components/audit/health-score";
import { AuditHistory } from "../../components/audit/history-list";
import { IssuesTable } from "../../components/audit/issues-table";
import {
  useAudit,
  useAudits,
  useDeleteAudit,
  useLighthouseGrace,
} from "../../components/audit/queries";
import { RunAuditDialog } from "../../components/audit/run-audit-dialog";
import { ApiErrorNotice } from "../../components/domains/api-error-notice";
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
import {
  Button,
  Card,
  ConfirmDialog,
  PageHeader,
  Skeleton,
  useToast,
} from "../../components/ui";
import { useActiveWorkspace } from "../../lib/workspaces";

/** Which audit is on screen. Lives in the URL so it can be linked. */
export const AUDIT_PARAM = "audit";

/** The default crawl size, and so the figure the "from" hint quotes. */
const DEFAULT_CRAWL_PAGES = 25;

export function SiteAuditPage() {
  const {
    activeWorkspace,
    activeWorkspaceId,
    isPending: workspacePending,
  } = useActiveWorkspace();
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
   * Switching project drops `?audit=` as well as setting `?project=`: an audit
   * id belongs to one project, and carrying it across would ask for another
   * tenant's audit and get a 404 for the trouble.
   */
  const selectProject = useCallback(
    (next: Project) => {
      writeLastProjectId(activeWorkspaceId, next.id);
      setSearchParams(
        (current) => {
          const params = projectSearchParams(current, next.id);
          params.delete(AUDIT_PARAM);
          return params;
        },
        { replace: true },
      );
    },
    [activeWorkspaceId, setSearchParams],
  );

  // Heal a `?project=` naming a project that no longer exists — see the same
  // effect in rank-tracking/tracking-page.tsx.
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
          title="Site Audit"
          description="Crawl a site you own for the technical issues that hold rankings back."
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
    <ProjectAudit
      key={project.id}
      workspaceId={activeWorkspaceId}
      project={project}
      onSelectProject={selectProject}
      credentialsConfigured={activeWorkspace?.credentials.configured ?? true}
    />
  );
}

/* ------------------------------ the real screen ---------------------------- */

function ProjectAudit({
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
  const [searchParams, setSearchParams] = useSearchParams();
  const canAdminister = useCanCreateProject();

  const listQuery = useAudits(workspaceId, project.id);
  const deleteAudit = useDeleteAudit(workspaceId, project.id);

  const [running, setRunning] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<AuditListItem | null>(
    null,
  );
  /**
   * A "you need to fix something in Settings" rejection from the run dialog —
   * no credentials, or the spend cap. Held here so it renders as a notice with
   * its link rather than as a toast that takes the link away with it.
   */
  const [blocked, setBlocked] = useState<unknown>(null);

  /*
   * Newest first, sorted here rather than trusted from the response. The list
   * endpoint already orders it, but "the most recent audit" is what this screen
   * shows by default and a silent change of order upstream would silently
   * change which audit that is.
   */
  const audits = useMemo(() => {
    const rows = listQuery.data?.audits ?? [];
    return [...rows].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }, [listQuery.data]);

  const auditParam = searchParams.get(AUDIT_PARAM);
  const selectedId =
    audits.find((audit) => audit.id === auditParam)?.id ??
    audits[0]?.id ??
    null;

  const selectAudit = useCallback(
    (auditId: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          params.set(AUDIT_PARAM, auditId);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // A stale `?audit=` (deleted, or from another project) is dropped so a
  // reload cannot land back on it.
  useEffect(() => {
    if (auditParam === null || listQuery.isPending) return;
    if (audits.some((audit) => audit.id === auditParam)) return;
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete(AUDIT_PARAM);
        return params;
      },
      { replace: true },
    );
  }, [auditParam, audits, listQuery.isPending, setSearchParams]);

  const detailQuery = useAudit(workspaceId, selectedId);
  const detail = detailQuery.data ?? null;
  const summary = detail?.summary ?? null;

  /*
   * Lighthouse lands a little after the crawl, so `lighthouse: null` on a
   * freshly finished audit is normal. One more look before we call it
   * unavailable — see useLighthouseGrace.
   */
  const awaitingLighthouse = useLighthouseGrace(
    detail?.id ?? null,
    detail !== null &&
      detail.status === "done" &&
      summary !== null &&
      summary.lighthouse === null,
    detailQuery.refetch,
  );

  const estimate = estimateAuditCostUsd(DEFAULT_CRAWL_PAGES, false);
  const canRun = canAdminister && credentialsConfigured;

  async function confirmDeletion() {
    const target = pendingDeletion;
    if (target === null) return;
    try {
      await deleteAudit.mutateAsync(target.id);
      setPendingDeletion(null);
      if (target.id === selectedId) {
        setSearchParams(
          (current) => {
            const params = new URLSearchParams(current);
            params.delete(AUDIT_PARAM);
            return params;
          },
          { replace: true },
        );
      }
      toast({
        title: "Audit deleted",
        description: `The audit from ${formatAuditTime(target.createdAt)} and its stored crawl data are gone.`,
        tone: "success",
      });
    } catch (caught) {
      setPendingDeletion(null);
      toast({
        title: "Could not delete that audit",
        description:
          caught instanceof Error ? caught.message : "Something went wrong.",
        tone: "error",
      });
    }
  }

  const hrefFor = useCallback(
    (category: AuditCategoryResult) =>
      `/app/site-audit/${detail?.id ?? ""}/${category.category}?${PROJECT_PARAM}=${encodeURIComponent(
        project.id,
      )}`,
    [detail?.id, project.id],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{project.domain}</span>
            <span aria-hidden="true">·</span>
            <span>
              {audits.length === 0
                ? "No audits yet"
                : `${audits.length} audit${audits.length === 1 ? "" : "s"}`}
            </span>
          </span>
        }
        actions={
          <>
            <ProjectSelect
              workspaceId={workspaceId}
              selectedId={project.id}
              onSelect={onSelectProject}
            />
            {audits.length > 0 ? (
              <Button
                onClick={() => setRunning(true)}
                disabled={!canRun}
                title={runButtonTitle(canAdminister, credentialsConfigured)}
              >
                <Play className="size-4" aria-hidden="true" />
                {`Run audit — from ${formatCostCeiling(estimate)}`}
              </Button>
            ) : null}
          </>
        }
      />

      {credentialsConfigured ? null : <NoCredentialsNotice />}

      {blocked === null ? null : (
        <ApiErrorNotice
          error={blocked}
          fallback="That audit could not be started."
        />
      )}

      {listQuery.isError ? (
        <ApiErrorNotice
          error={listQuery.error}
          onRetry={() => void listQuery.refetch()}
          fallback="Could not load this project's audits."
        />
      ) : listQuery.isPending ? (
        <ContentSkeleton />
      ) : audits.length === 0 ? (
        <NoAuditsExplainer
          domain={project.domain}
          estimate={estimate}
          canRun={canRun}
          canAdminister={canAdminister}
          credentialsConfigured={credentialsConfigured}
          onRun={() => setRunning(true)}
        />
      ) : (
        <>
          {detailQuery.isError ? (
            <ApiErrorNotice
              error={detailQuery.error}
              onRetry={() => void detailQuery.refetch()}
              fallback="Could not load this audit."
            />
          ) : detailQuery.isPending || detail === null ? (
            <ContentSkeleton />
          ) : detail.status === "failed" ? (
            <FailedNotice error={detail.error} />
          ) : isInFlight(detail.status) || summary === null ? (
            <AuditProgressCard
              progress={detail.progress}
              pagesLimit={
                audits.find((audit) => audit.id === detail.id)?.pagesLimit ??
                DEFAULT_CRAWL_PAGES
              }
              domain={detail.domain}
            />
          ) : (
            <>
              <p className="-mb-2 text-xs text-muted-foreground">
                {`Crawled ${formatAuditTime(detail.createdAt)} · ${pluralPages(
                  summary.pagesCrawled,
                )} of a ${summary.pagesLimit.toLocaleString("en")}-page limit${
                  summary.renderJs ? " · JavaScript rendered" : ""
                }`}
              </p>
              <HealthScore summary={summary} previous={detail.previous} />
              <CoreWebVitalsStrip
                summary={summary}
                awaitingLighthouse={awaitingLighthouse}
              />
              <IssuesTable
                categories={summary.categories}
                previous={detail.previous}
                hrefFor={hrefFor}
              />
            </>
          )}

          <AuditHistory
            audits={audits}
            selectedId={selectedId}
            onSelect={selectAudit}
            onDelete={setPendingDeletion}
            canDelete={canAdminister}
            deletingId={deleteAudit.isPending ? pendingDeletion?.id ?? null : null}
          />
        </>
      )}

      <RunAuditDialog
        open={running}
        onClose={() => setRunning(false)}
        workspaceId={workspaceId}
        projectId={project.id}
        domain={project.domain}
        onStarted={(auditId) => {
          setBlocked(null);
          selectAudit(auditId);
        }}
        onBlocked={setBlocked}
      />

      <ConfirmDialog
        open={pendingDeletion !== null}
        onClose={() => setPendingDeletion(null)}
        onConfirm={() => void confirmDeletion()}
        loading={deleteAudit.isPending}
        title={
          pendingDeletion === null
            ? "Delete this audit?"
            : `Delete the audit from ${formatAuditTime(pendingDeletion.createdAt)}?`
        }
        description="The crawl data behind it is deleted too, so this audit can no longer be compared against or drilled into. Re-running costs another crawl."
        confirmLabel="Delete audit"
      />
    </div>
  );
}

/* --------------------------------- pieces ---------------------------------- */

function runButtonTitle(
  canAdminister: boolean,
  credentialsConfigured: boolean,
): string | undefined {
  if (!credentialsConfigured) {
    return "This workspace has no DataForSEO credentials yet.";
  }
  if (!canAdminister) return "Only workspace admins can start an audit.";
  return undefined;
}

/**
 * The first-run state.
 *
 * It explains what an audit *is* before offering to buy one — this is the only
 * module where the first click spends money on a crawl whose size the user has
 * to choose, and "Run first audit" with no context is asking them to guess.
 */
function NoAuditsExplainer({
  domain,
  estimate,
  canRun,
  canAdminister,
  credentialsConfigured,
  onRun,
}: {
  domain: string;
  estimate: number;
  canRun: boolean;
  canAdminister: boolean;
  credentialsConfigured: boolean;
  onRun: () => void;
}) {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <span className="flex size-10 items-center justify-center rounded-full bg-tint">
        <Gauge className="size-5 text-primary" aria-hidden="true" />
      </span>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          No audits yet
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {`An audit crawls ${domain} the way a search engine would and reports what it finds: slow and heavy pages, missing or duplicated titles and descriptions, broken links and images, redirect chains, pages that cannot be indexed, and Core Web Vitals for the homepage.`}
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {`The crawl runs on your own DataForSEO key. A 25-page audit costs ${formatCostCeiling(
            estimate,
          )} — and less if the site has fewer than 25 pages, because you are charged for the pages actually crawled. Results usually land within one to three minutes.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onRun}
          disabled={!canRun}
          title={runButtonTitle(canAdminister, credentialsConfigured)}
        >
          <Play className="size-4" aria-hidden="true" />
          Run first audit
        </Button>
        {canRun ? null : (
          <p className="text-xs text-muted-foreground">
            {credentialsConfigured
              ? "Only workspace admins can start an audit."
              : "Add DataForSEO credentials to this workspace to run one."}
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * A crawl that came back failed.
 *
 * The upstream message is shown verbatim: DataForSEO's reasons are specific and
 * actionable ("target domain is not reachable", "robots.txt disallows the
 * crawl") and paraphrasing them would lose the only useful part.
 */
function FailedNotice({ error }: { error: string | null }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-app border border-danger-subtle bg-danger-subtle p-4 text-danger-on-subtle"
    >
      <p className="text-sm font-semibold">This audit failed</p>
      <p className="text-sm leading-relaxed">
        {error ?? "DataForSEO did not say why the crawl could not complete."}
      </p>
      <p className="text-sm leading-relaxed">
        Nothing was ingested for it. Running a new audit is safe — you are only
        charged for pages that are actually crawled.
      </p>
    </div>
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
          Audits crawl your site with your own DataForSEO key. Existing audits
          still open, but no new crawl can start until this workspace has
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
      <ContentSkeleton />
    </div>
  );
}

function ContentSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-32 w-full rounded-app" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 w-full rounded-app" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-app" />
    </div>
  );
}
