/**
 * Backlinks module root, mounted at /app/backlinks/* so all of its routing
 * happens here rather than in the app-wide route table.
 *
 * The module is one screen today: its three views are tabs over a single
 * searched target, not separate pages, because they share the search bar and
 * the summary above them. The nested <Routes> exists so that stays this
 * module's decision — a later sub-screen adds a <Route> here and nothing
 * outside changes.
 */
import { Navigate, Route, Routes, useLocation } from "react-router";

import { BacklinksPage } from "./backlinks-page";

/**
 * Anything below the module that is not a route we know goes back to the
 * index — keeping the query string, because that is where the search lives and
 * dropping it would turn a mistyped path into a lost report.
 */
function RedirectToIndex() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/backlinks", search }} replace />;
}

export function BacklinksModule() {
  return (
    <Routes>
      <Route index element={<BacklinksPage />} />
      <Route path="*" element={<RedirectToIndex />} />
    </Routes>
  );
}
