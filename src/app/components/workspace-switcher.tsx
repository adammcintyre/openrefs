import { useEffect, useRef, useState, type FormEvent } from "react";

import { errorMessage } from "../lib/api";
import { useActiveWorkspace, useCreateWorkspace } from "../lib/workspaces";

/**
 * Workspace picker for the app header.
 *
 * The selection is persisted in localStorage by `useActiveWorkspace`, which
 * also discards a stored id that is no longer one of the caller's workspaces —
 * so signing in as someone else, or deleting the active workspace, cannot
 * leave the UI pointed at something it may not read.
 */
export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, setActiveWorkspaceId, isPending } =
    useActiveWorkspace();
  const createWorkspace = useCreateWorkspace();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — the usual expectations of a menu.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setCreating(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;

    createWorkspace.mutate(trimmed, {
      onSuccess: (workspace) => {
        setActiveWorkspaceId(workspace.id);
        setName("");
        setCreating(false);
        setOpen(false);
      },
    });
  };

  if (isPending) {
    return (
      <div className="h-8 w-40 animate-pulse rounded-app bg-surface-muted" aria-hidden />
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex max-w-56 items-center gap-2 rounded-app border border-border bg-surface px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-muted"
      >
        <span className="truncate font-medium">
          {activeWorkspace?.name ?? "No workspace"}
        </span>
        <span aria-hidden className="text-muted-foreground">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 w-64 rounded-app border border-border bg-surface p-1 shadow-lg"
        >
          <ul className="max-h-64 overflow-y-auto">
            {workspaces.map((workspace) => {
              const isActive = workspace.id === activeWorkspace?.id;
              return (
                <li key={workspace.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveWorkspaceId(workspace.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-app px-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-tint text-tint-foreground"
                        : "text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    <span className="truncate">{workspace.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {workspace.role}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-1 border-t border-border pt-1">
            {creating ? (
              <form onSubmit={onCreate} className="space-y-2 p-2">
                <label
                  htmlFor="new-workspace-name"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Workspace name
                </label>
                <input
                  id="new-workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  autoFocus
                  className="w-full rounded-app border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                />
                {createWorkspace.error !== null && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                    {errorMessage(createWorkspace.error, "Could not create it.")}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createWorkspace.isPending}
                    className="rounded-app bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                  >
                    {createWorkspace.isPending ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="rounded-app px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-muted"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => setCreating(true)}
                className="w-full rounded-app px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-surface-muted"
              >
                + Create workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
