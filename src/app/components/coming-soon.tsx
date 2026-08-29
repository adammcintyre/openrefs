import { LayoutDashboard } from "lucide-react";
import { useLocation } from "react-router";

import { Dashboard } from "../routes/dashboard";
import { NAV_ITEMS } from "../routes/nav";
import { ModulePlaceholder } from "./module-placeholder";

/**
 * Compatibility shim, and a temporary one.
 *
 * routes/index.tsx generates every /app route from NAV_ITEMS and points all of
 * them at this single component. That file belongs to the auth agent this
 * wave, so the dashboard cannot yet be wired to its own <Route>; instead this
 * dispatches on the pathname — /app renders the real Dashboard, everything
 * else renders the module placeholder.
 *
 * To remove: give the index route `element={<Dashboard />}` in routes/index.tsx
 * and render <ModulePlaceholder> directly for the rest. Nothing else imports
 * this component, so it can then be deleted outright.
 *
 * The props are unchanged from the Phase 0 scaffold so routes/index.tsx still
 * type-checks untouched.
 */
export function ComingSoon({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: number;
}) {
  const { pathname } = useLocation();
  const segment = pathname.replace(/^\/app\/?/, "").split("/")[0] ?? "";

  if (segment === "") return <Dashboard />;

  // The icon is not passed down by the route tree, so recover it from the nav
  // table rather than adding a prop routes/index.tsx would have to supply.
  const icon =
    NAV_ITEMS.find((item) => item.segment === segment)?.icon ??
    LayoutDashboard;

  return (
    <ModulePlaceholder
      icon={icon}
      title={title}
      description={description}
      phase={phase}
    />
  );
}
