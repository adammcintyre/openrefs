import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";

import { AppHeader } from "../components/app-header";
import { AppSidebar } from "../components/app-sidebar";
import { cn } from "../components/ui/cn";
import { NAV_ITEMS } from "./nav";

const COLLAPSE_KEY = "openrefs-sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    // Private mode, or storage disabled by policy. Not worth failing over.
    return false;
  }
}

/** Page name for the header, resolved from the active route. */
function useCurrentTitle(): string {
  const { pathname } = useLocation();
  const segment = pathname.replace(/^\/app\/?/, "").split("/")[0] ?? "";
  return (
    NAV_ITEMS.find((item) => item.segment === segment)?.label ?? "Dashboard"
  );
}

/**
 * Sidebar + header shell for everything under /app.
 *
 * Two presentations of one sidebar: a rail that collapses to icons at lg and
 * up, and an overlay drawer below it. Both render <AppSidebar>, so a nav
 * change lands in both automatically. The workspace switcher and account menu
 * are slots — session-aware components stay out of the design layer.
 */
export function AppLayout({
  workspaceSwitcher,
  accountMenu,
}: {
  /** Rendered in the header; the route tree passes the real switcher. */
  workspaceSwitcher?: ReactNode;
  /** Rendered at the header's far end; the route tree passes the real menu. */
  accountMenu?: ReactNode;
}) {
  // Read synchronously on mount so the rail does not flash open then collapse.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const title = useCurrentTitle();
  const { pathname } = useLocation();

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Preference is cosmetic; losing it is survivable.
      }
      return next;
    });
  }, []);

  // A route change from anywhere — including browser back — should leave the
  // drawer closed rather than covering the page the user just navigated to.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only rounded-app bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[70]"
      >
        Skip to content
      </a>

      {/* Desktop rail. */}
      <aside
        className={cn(
          "hidden shrink-0 border-r border-border transition-[width] duration-150 lg:flex lg:flex-col",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <AppSidebar collapsed={collapsed} />
      </aside>

      {/* Mobile drawer. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-[#0b120e]/60"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 w-64 border-r border-border shadow-xl"
          >
            <AppSidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          title={title}
          workspaceSwitcher={workspaceSwitcher}
          accountMenu={accountMenu}
          sidebarCollapsed={collapsed}
          onToggleSidebar={toggleCollapsed}
          onOpenDrawer={() => setDrawerOpen(true)}
        />

        <main id="main-content" className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
