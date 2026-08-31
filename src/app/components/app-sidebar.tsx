import { Link, NavLink } from "react-router";

import { DASHBOARD_ITEM, NAV_GROUPS, SETTINGS_ITEM } from "../routes/nav";
import type { NavItem } from "../routes/nav";
import { Logomark } from "./logomark";
import { cn } from "./ui/cn";
import { UsageWidget } from "./usage-widget";
import { Wordmark } from "./wordmark";

function itemPath(item: NavItem): string {
  return item.segment ? `/app/${item.segment}` : "/app";
}

function SidebarLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <NavLink
      to={itemPath(item)}
      end={item.segment === ""}
      onClick={onNavigate}
      // Native tooltip only when the text is hidden; otherwise it would just
      // duplicate the visible label on hover.
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded-app px-2.5 py-2 text-sm transition-colors",
          collapsed && "justify-center px-0",
          isActive
            ? "bg-tint font-medium text-tint-foreground"
            : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              "size-4 shrink-0",
              isActive ? "text-primary" : undefined,
            )}
            aria-hidden="true"
          />
          {/*
            Kept in the DOM and hidden visually when collapsed, so the link
            keeps its accessible name in icon-only mode.
          */}
          <span className={cn("truncate", collapsed && "sr-only")}>
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

/**
 * Sidebar contents, shared by the fixed desktop rail and the mobile drawer so
 * the two can never drift apart.
 */
export function AppSidebar({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  /** Called after any nav link is followed; the drawer uses it to close. */
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        {/* Inside the app the logo goes to the dashboard, not the marketing
            page — signed-in users clicking it want home base, not the pitch. */}
        <Link to="/app" aria-label="OpenRefs dashboard" className="flex items-center">
          {collapsed ? (
            <Logomark size={24} />
          ) : (
            <Wordmark className="text-base" />
          )}
        </Link>
      </div>

      <nav
        aria-label="Modules"
        className={cn(
          "flex-1 space-y-4 overflow-y-auto py-3",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <ul>
          <li>
            <SidebarLink
              item={DASHBOARD_ITEM}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </li>
        </ul>

        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {collapsed ? (
              // The group heading still exists for assistive tech; visually it
              // collapses to the rule that separates the icon clusters.
              <div className="mx-2 mb-2 border-t border-border pt-1">
                <span className="sr-only">{group.label}</span>
              </div>
            ) : (
              <p className="px-2.5 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.segment}>
                  <SidebarLink
                    item={item}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("shrink-0", collapsed ? "px-2 pb-2" : "px-3 pb-2")}>
        <SidebarLink
          item={SETTINGS_ITEM}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </div>

      <UsageWidget collapsed={collapsed} />
    </div>
  );
}
