import { NavLink, Outlet } from "react-router";

import { PageHeader } from "../../components/ui";
import { cn } from "../../components/ui/cn";

const TABS = [
  { to: "/app/settings", label: "General", end: true },
  { to: "/app/settings/data-provider", label: "Data Provider", end: false },
  { to: "/app/settings/members", label: "Members & Invites", end: false },
  { to: "/app/settings/api-keys", label: "API Keys", end: false },
  { to: "/app/settings/danger", label: "Danger Zone", end: false },
];

/**
 * Each destination is a real route, not a client-side panel swap, so this
 * stays a NavLink strip rather than the `Tabs` primitive — `Tabs` renders its
 * own content in place and has no notion of an href.
 */
function tabClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "rounded-app px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
    isActive
      ? "bg-tint font-medium text-tint-foreground"
      : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
  );
}

export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Workspace settings"
        description="Members and roles, API keys, your DataForSEO credentials and the workspace spend cap."
      />

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-2">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={tabClass}>
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
