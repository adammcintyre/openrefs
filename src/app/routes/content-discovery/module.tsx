/**
 * Content Discovery module root, mounted at /app/content-discovery/* so all of
 * its routing happens here rather than in the app-wide route table.
 *
 * One screen today. The nested <Routes> exists so that stays this module's
 * decision — a later sub-screen (saved sweeps, a topic comparison) adds a
 * <Route> here and nothing outside changes.
 */
import { Navigate, Route, Routes, useLocation } from "react-router";

import { ContentDiscoveryPage } from "./discover-page";

/**
 * Anything below the module that is not a route we know goes back to the
 * index — keeping the query string, because that is where the search lives and
 * dropping it would turn a mistyped path into a lost report.
 */
function RedirectToIndex() {
  const { search } = useLocation();
  return (
    <Navigate to={{ pathname: "/app/content-discovery", search }} replace />
  );
}

export function ContentDiscoveryModule() {
  return (
    <Routes>
      <Route index element={<ContentDiscoveryPage />} />
      <Route path="*" element={<RedirectToIndex />} />
    </Routes>
  );
}
