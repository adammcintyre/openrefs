/**
 * Domain Overview module root, mounted at /app/domain-overview/* so all of its
 * routing happens here rather than in the app-wide route table.
 *
 * The module is one screen today: its four views are tabs over a single
 * searched domain, not separate pages, because they share the search bar and
 * the market. The nested <Routes> exists so that stays this module's decision —
 * a later sub-screen adds a <Route> here and nothing outside changes.
 */
import { Navigate, Route, Routes, useLocation } from "react-router";

import { DomainOverviewPage } from "./overview-page";

/**
 * Anything below the module that is not a route we know goes back to the
 * index — keeping the query string, because that is where the search lives and
 * dropping it would turn a mistyped path into a lost report.
 */
function RedirectToIndex() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/domain-overview", search }} replace />;
}

export function DomainOverviewModule() {
  return (
    <Routes>
      <Route index element={<DomainOverviewPage />} />
      <Route path="*" element={<RedirectToIndex />} />
    </Routes>
  );
}
