/**
 * "Which site are we talking about" — the entry point to every PROJECTS-group
 * module.
 *
 * Three exports, all over the same project list:
 *
 * - `ProjectPicker` — the full panel a module renders when nothing is
 *   selected. Choosing a project *is* the empty state's call to action, which
 *   is why the list is the panel rather than a control inside one.
 * - `ProjectSelect` — the compact switcher for a module header, once a project
 *   is chosen.
 * - `NewProjectDialog` — the inline create form both of the above open.
 *
 * Creating a project needs the `admin` role. Members see a short note naming
 * what they would need instead of a form that the API would reject on submit:
 * a disabled button they cannot explain is worse than a sentence that explains
 * it, and letting them fill the form in first would be worse still.
 */
import { FolderPlus, Plus, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";

import type { Project } from "../../../shared/projects";
import { PROJECT_NAME_MAX_LENGTH } from "../../../shared/projects";
import { errorMessage } from "../../lib/api";
import { useActiveWorkspace } from "../../lib/workspaces";
import { ApiErrorNotice } from "../domains/api-error-notice";
import { isLikelyDomain, normalizeDomainInput } from "../domains/format";
import { MarketSelects } from "../domains/market-select";
import type { Market } from "../../routes/domain-overview/url-state";
import { DEFAULT_MARKET } from "../../routes/domain-overview/url-state";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  cn,
  useToast,
} from "../ui";
import { useCreateProject, useProjects } from "./queries";

/** True when this workspace's role may create a project. */
export function useCanCreateProject(): boolean {
  const { activeWorkspace } = useActiveWorkspace();
  const role = activeWorkspace?.role;
  return role === "owner" || role === "admin";
}

/* ---------------------------- new project dialog --------------------------- */

export function NewProjectDialog({
  workspaceId,
  open,
  onClose,
  onCreated,
}: {
  workspaceId: string | null;
  open: boolean;
  onClose: () => void;
  /** Called with the new project so the caller can select it immediately. */
  onCreated?: (project: Project) => void;
}) {
  const { toast } = useToast();
  const createProject = useCreateProject(workspaceId);

  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET);
  const [error, setError] = useState<string | null>(null);

  // Reset per opening: a form that reopens holding the last attempt's values
  // is a reliable way to create a project against the wrong domain.
  useEffect(() => {
    if (!open) return;
    setName("");
    setDomain("");
    setMarket(DEFAULT_MARKET);
    setError(null);
  }, [open]);

  const normalized = normalizeDomainInput(domain);
  const domainLooksWrong = normalized !== "" && !isLikelyDomain(normalized);
  const canSubmit = name.trim() !== "" && normalized !== "" && !domainLooksWrong;
  const busy = createProject.isPending;

  async function submit() {
    if (!canSubmit || busy) return;
    setError(null);

    try {
      const { project } = await createProject.mutateAsync({
        name: name.trim(),
        domain: normalized,
        locationCode: market.location,
        languageCode: market.language,
      });
      toast({
        title: `Created "${project.name}"`,
        description: `Tracking ${project.domain}. Add keywords to start checking positions.`,
        tone: "success",
      });
      onCreated?.(project);
      onClose();
    } catch (caught) {
      // Kept in the dialog: the user is still here and the fix (a different
      // name, a corrected domain) is in front of them.
      setError(errorMessage(caught, "Could not create the project."));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New project"
      description="A project is a site you own. Its domain is what rank checks look for, and its market sets the defaults for keywords you track."
      size="md"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!canSubmit}
          >
            Create project
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Name"
          required
          hint={`What you'll call it in OpenRefs. Up to ${PROJECT_NAME_MAX_LENGTH} characters.`}
        >
          {(props) => (
            <Input
              {...props}
              value={name}
              maxLength={PROJECT_NAME_MAX_LENGTH}
              placeholder="e.g. BrandPacks"
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Domain"
          required
          error={domainLooksWrong ? "That doesn't look like a domain." : undefined}
          hint={
            normalized === "" || domainLooksWrong
              ? "The bare hostname. A scheme, www. or a path will be trimmed."
              : `Rank checks will look for ${normalized} and its subdomains.`
          }
        >
          {(props) => (
            <Input
              {...props}
              value={domain}
              placeholder="e.g. brandpacks.com"
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setDomain(event.target.value)}
            />
          )}
        </Field>

        <MarketSelects
          workspaceId={workspaceId}
          value={market}
          onChange={setMarket}
          disabled={busy}
          className="grid gap-4 sm:grid-cols-2"
        />

        {error === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------ create affordance -------------------------- */

/**
 * The create button, or the reason there isn't one. Shared by the panel and
 * the select so the member-role wording is written once.
 */
function CreateAffordance({
  canCreate,
  onOpen,
  size = "md",
}: {
  canCreate: boolean;
  onOpen: () => void;
  size?: "sm" | "md";
}) {
  if (!canCreate) {
    return (
      <p className="text-sm text-muted-foreground">
        Only workspace admins can create projects. Ask an admin to add one, and
        it will appear here.
      </p>
    );
  }
  return (
    <Button size={size} onClick={onOpen}>
      <Plus className="size-4" aria-hidden="true" />
      New project
    </Button>
  );
}

/* --------------------------------- picker ---------------------------------- */

/**
 * `card` stands alone as a module's empty state; `bare` drops the surface for
 * a picker that is already inside one — a dialog, most often.
 *
 * A variant rather than a `className` override, because `cn` is deliberately
 * not tailwind-merge (see components/ui/cn.ts): passing `border-0 p-0` would
 * leave both it and the Card's own `border p-6` on the element, and which one
 * won would depend on their order in Tailwind's generated stylesheet.
 */
export type ProjectPickerVariant = "card" | "bare";

export function ProjectPicker({
  workspaceId,
  selectedId,
  onSelect,
  title = "Choose a project",
  description = "Rank Tracking follows the keywords for a site you own. Pick a project to see its positions.",
  variant = "card",
  className = "",
}: {
  workspaceId: string | null;
  selectedId?: string | null;
  onSelect: (project: Project) => void;
  title?: string;
  description?: string;
  variant?: ProjectPickerVariant;
  className?: string;
}) {
  const query = useProjects(workspaceId);
  const canCreate = useCanCreateProject();
  const [creating, setCreating] = useState(false);

  const projects = query.data?.projects ?? [];
  const Frame = variant === "card" ? Card : "div";

  return (
    <Frame className={cn(variant === "card" && "p-6", className)}>
      <div className="flex flex-col gap-1.5">
        <h2
          className={cn(
            "font-semibold tracking-tight text-foreground",
            variant === "card" ? "text-base" : "text-sm",
          )}
        >
          {title}
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>

      <div
        className={cn(
          "flex flex-col gap-4",
          variant === "card" ? "mt-5" : "mt-3",
        )}
      >
        {query.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full rounded-app" />
            <Skeleton className="h-14 w-full rounded-app" />
          </div>
        ) : query.isError ? (
          <ApiErrorNotice
            error={query.error}
            onRetry={() => void query.refetch()}
            fallback="Could not load this workspace's projects."
          />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title="No projects yet"
            description={
              canCreate
                ? "Create one for a site you own — its domain is what rank checks look for."
                : "Nothing has been set up in this workspace yet."
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectRow
                  project={project}
                  selected={project.id === selectedId}
                  onSelect={() => onSelect(project)}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center">
          <CreateAffordance canCreate={canCreate} onOpen={() => setCreating(true)} />
        </div>
      </div>

      <NewProjectDialog
        workspaceId={workspaceId}
        open={creating}
        onClose={() => setCreating(false)}
        // Selecting the new project immediately is the whole point of creating
        // one from here — otherwise the user lands back on the same picker.
        onCreated={onSelect}
      />
    </Frame>
  );
}

function ProjectRow({
  project,
  selected,
  onSelect,
}: {
  project: Project;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-app border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-tint"
          : "border-border bg-surface hover:bg-surface-muted",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-app bg-surface-muted">
        <TrendingUp className="size-4 text-muted-foreground" aria-hidden="true" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-sm font-medium",
            selected ? "text-tint-foreground" : "text-foreground",
          )}
        >
          {project.name}
        </span>
        <span
          className={cn(
            "truncate text-xs",
            selected ? "text-tint-foreground/80" : "text-muted-foreground",
          )}
        >
          {project.domain}
        </span>
      </span>

      <Badge variant={selected ? "brand" : "neutral"} className="shrink-0">
        {`${project.keywordCount.toLocaleString("en")} tracked`}
      </Badge>
    </button>
  );
}

/* --------------------------------- select ---------------------------------- */

/**
 * The compact switcher for a module header.
 *
 * A native `<select>` plus a separate create button, rather than a combobox
 * with a "New project…" option: an option that is an action rather than a
 * value is a well-known way to create a project by arrowing past it with the
 * keyboard.
 */
export function ProjectSelect({
  workspaceId,
  selectedId,
  onSelect,
  className = "",
}: {
  workspaceId: string | null;
  selectedId: string | null;
  onSelect: (project: Project) => void;
  className?: string;
}) {
  const query = useProjects(workspaceId);
  const canCreate = useCanCreateProject();
  const [creating, setCreating] = useState(false);

  const projects = query.data?.projects ?? [];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label className="sr-only" htmlFor="rank-tracking-project">
        Project
      </label>
      <Select
        id="rank-tracking-project"
        value={selectedId ?? ""}
        disabled={query.isPending || projects.length === 0}
        className="min-w-48"
        onChange={(event) => {
          const next = projects.find(
            (project) => project.id === event.target.value,
          );
          if (next !== undefined) onSelect(next);
        }}
      >
        {selectedId === null ? <option value="">Select a project…</option> : null}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {`${project.name} — ${project.domain}`}
          </option>
        ))}
      </Select>

      {canCreate ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setCreating(true)}
          aria-label="New project"
          title="New project"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
      ) : null}

      <NewProjectDialog
        workspaceId={workspaceId}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={onSelect}
      />
    </div>
  );
}
