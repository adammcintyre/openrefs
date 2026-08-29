import { ChevronsUpDown, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";

import { ThemeToggle } from "./theme-toggle";
import { cn } from "./ui/cn";

/**
 * Stand-in for the real workspace switcher.
 *
 * Deliberately inert and visibly unfinished — a chip that looked functional
 * would invite clicks that do nothing. The auth agent replaces this wholesale
 * by passing `workspaceSwitcher` into AppLayout.
 */
function WorkspaceSwitcherPlaceholder() {
  return (
    <span
      className="hidden items-center gap-1.5 rounded-app border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground sm:inline-flex"
      title="Workspace switching arrives with authentication"
    >
      Workspace
      <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
    </span>
  );
}

export function AppHeader({
  title,
  workspaceSwitcher,
  accountMenu,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenDrawer,
}: {
  /** Current page name, mirroring the active sidebar entry. */
  title: string;
  /** Real switcher when the route tree provides one; placeholder otherwise. */
  workspaceSwitcher?: ReactNode;
  /** Session-aware account menu, slotted in by the route tree. */
  accountMenu?: ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
      {/* Drawer trigger, below lg only. */}
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open navigation"
        className="inline-flex size-9 items-center justify-center rounded-app text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground lg:hidden"
      >
        <Menu className="size-4" aria-hidden="true" />
      </button>

      {/* Collapse toggle, lg and up only. */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-pressed={sidebarCollapsed}
        className="hidden size-9 items-center justify-center rounded-app text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground lg:inline-flex"
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen className="size-4" aria-hidden="true" />
        ) : (
          <PanelLeftClose className="size-4" aria-hidden="true" />
        )}
      </button>

      {/*
        A single current-page label rather than a full breadcrumb trail: /app
        is one level deep everywhere, so a trail would read "OpenRefs /
        Backlinks" and add nothing. It becomes a real trail when modules grow
        detail views.
      */}
      <p
        className={cn(
          "min-w-0 flex-1 truncate text-sm font-medium text-foreground",
        )}
      >
        {title}
      </p>

      <div className="flex shrink-0 items-center gap-2">
        {workspaceSwitcher ?? <WorkspaceSwitcherPlaceholder />}
        <ThemeToggle />
        {accountMenu}
      </div>
    </header>
  );
}
