import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";

import { AccountMenu } from "../components/account-menu";
import { ComingSoon } from "../components/coming-soon";
import { WorkspaceSwitcher } from "../components/workspace-switcher";
import { useMe } from "../lib/session";
import { AppLayout } from "./app-layout";
import { InviteAccept } from "./invite";
import { Landing } from "./landing";
import { Login } from "./login";
import { NAV_ITEMS } from "./nav";
import { Register } from "./register";
import { ApiKeysSettings } from "./settings/api-keys";
import { DangerZoneSettings } from "./settings/danger-zone";
import { DataProviderSettings } from "./settings/data-provider";
import { GeneralSettings } from "./settings/general";
import { SettingsLayout } from "./settings/layout";
import { MembersSettings } from "./settings/members";

/** Settings has real screens now, so it opts out of the ComingSoon map. */
const SETTINGS_SEGMENT = "settings";

function FullPageMessage({ children }: { children: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * Route guard for /app. `GET /auth/me` is the only thing that can answer
 * whether the httpOnly session cookie is still valid, so the guard waits for
 * it rather than guessing from anything readable in the browser.
 */
function RequireSession() {
  const { data, isPending, isError } = useMe();
  const location = useLocation();

  if (isPending) return <FullPageMessage>Loading…</FullPageMessage>;

  if (isError) {
    return (
      <FullPageMessage>
        Could not reach OpenRefs. Check your connection and reload.
      </FullPageMessage>
    );
  }

  if (data === null) {
    // Remember where they were headed so signing in resumes it.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite/:token" element={<InviteAccept />} />

      <Route element={<RequireSession />}>
        <Route
          path="/app"
          element={
            <AppLayout
              workspaceSwitcher={<WorkspaceSwitcher />}
              accountMenu={<AccountMenu />}
            />
          }
        >
          {NAV_ITEMS.filter((item) => item.segment !== SETTINGS_SEGMENT).map(
            (item) => {
              const element = (
                <ComingSoon
                  title={item.label}
                  description={item.description}
                  phase={item.phase}
                />
              );
              return item.segment === "" ? (
                <Route key="index" index element={element} />
              ) : (
                <Route key={item.segment} path={item.segment} element={element} />
              );
            },
          )}

          <Route path={SETTINGS_SEGMENT} element={<SettingsLayout />}>
            <Route index element={<GeneralSettings />} />
            <Route path="data-provider" element={<DataProviderSettings />} />
            <Route path="members" element={<MembersSettings />} />
            <Route path="api-keys" element={<ApiKeysSettings />} />
            <Route path="danger" element={<DangerZoneSettings />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
