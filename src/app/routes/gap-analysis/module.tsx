/**
 * Gap Analysis module root, mounted at /app/gap-analysis/* so all of its
 * routing happens here rather than in the app-wide route table.
 *
 * One screen today: the four modes are tabs over a single comparison, not
 * separate pages, because they share the domains, the market and — for the
 * views whose upstream query is the same — the data that was already paid for.
 * The nested <Routes> exists so that stays this module's decision; a later
 * sub-screen (page-level gaps, say) adds a <Route> here and nothing outside
 * changes.
 */
import { Navigate, Route, Routes, useLocation } from "react-router";

import { GapAnalysisPage } from "./gap-page";

/**
 * Anything below the module that is not a route we know goes back to the
 * index — keeping the query string, because that is where the comparison lives
 * and dropping it would turn a mistyped path into a lost report.
 */
function RedirectToIndex() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/gap-analysis", search }} replace />;
}

export function GapAnalysisModule() {
  return (
    <Routes>
      <Route index element={<GapAnalysisPage />} />
      <Route path="*" element={<RedirectToIndex />} />
    </Routes>
  );
}
