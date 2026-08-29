import { Link, NavLink, Outlet, useNavigate } from "react-router";

import { ThemeToggle } from "../components/theme-toggle";
import { WorkspaceSwitcher } from "../components/workspace-switcher";
import { Wordmark } from "../components/wordmark";
import { APP_VERSION } from "../../shared/version";
import { useLogout, useMe } from "../lib/session";
import { NAV_GROUPS } from "./nav";

function navLinkClass({ isActive }: { isActive: boolean }): string {
  const base =
    "block rounded-app px-3 py-1.5 text-sm transition-colors focus-visible:outline-2";
  return isActive
    ? `${base} bg-tint font-medium text-tint-foreground`
    : `${base} text-muted-foreground hover:bg-surface-muted hover:text-foreground`;
}

function AccountMenu() {
  const navigate = useNavigate();
  const logout = useLogout();
  const me = useMe();

  return (
    <div className="flex items-center gap-3">
      <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">
        {me.data?.user.email}
      </span>
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() =>
          logout.mutate(undefined, {
            onSuccess: () => void navigate("/login", { replace: true }),
          })
        }
        className="rounded-app border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-muted disabled:opacity-60"
      >
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

/**
 * Sidebar + header shell for everything under /app.
 *
 * Intentionally plain: no collapsible sidebar. The workspace switcher and the
 * account menu live in the header.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link to="/" className="text-base">
            <Wordmark />
          </Link>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.segment || "index"}>
                    <NavLink
                      to={item.segment ? `/app/${item.segment}` : "/app"}
                      end={item.segment === ""}
                      className={navLinkClass}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          v{APP_VERSION}
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-surface px-4">
          <Link to="/app" className="text-base md:hidden">
            <Wordmark />
          </Link>
          <WorkspaceSwitcher />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
