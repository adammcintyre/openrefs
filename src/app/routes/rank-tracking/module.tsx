/**
 * Rank Tracking module root, mounted at /app/rank-tracking/* so all of its
 * routing happens here rather than in the app-wide route table.
 *
 * One screen today. The nested <Routes> exists so that stays this module's
 * decision — a later sub-screen (a keyword's full SERP history, say) adds a
 * <Route> here and nothing outside changes.
 */
import { Navigate, Route, Routes, useLocation } from "react-router";

import { RankTrackingPage } from "./tracking-page";

/**
 * Anything below the module that is not a route we know goes back to the
 * index — keeping the query string, because `?project=` lives there and
 * dropping it would turn a mistyped path into the wrong project.
 */
function RedirectToIndex() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/rank-tracking", search }} replace />;
}

export function RankTrackingModule() {
  return (
    <Routes>
      <Route index element={<RankTrackingPage />} />
      <Route path="*" element={<RedirectToIndex />} />
    </Routes>
  );
}
