import { NavLink, Outlet } from "react-router";

const TABS = [
  { to: "/app/settings", label: "General", end: true },
  { to: "/app/settings/data-provider", label: "Data Provider", end: false },
  { to: "/app/settings/members", label: "Members & Invites", end: false },
  { to: "/app/settings/api-keys", label: "API Keys", end: false },
  { to: "/app/settings/danger", label: "Danger Zone", end: false },
];

function tabClass({ isActive }: { isActive: boolean }): string {
  const base =
    "rounded-app px-3 py-1.5 text-sm transition-colors whitespace-nowrap";
  return isActive
    ? `${base} bg-tint font-medium text-tint-foreground`
    : `${base} text-muted-foreground hover:bg-surface-muted hover:text-foreground`;
}

export function SettingsLayout() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Workspace settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Members and roles, API keys, your DataForSEO credentials and the
          workspace spend cap.
        </p>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-border pb-2">
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
