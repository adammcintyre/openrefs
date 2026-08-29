/**
 * Search Console module root, mounted at /app/search-console/* so all of its
 * routing happens here rather than in the app-wide route table.
 *
 * One screen today. The nested <Routes> exists so that stays this module's
 * decision — a later sub-screen (a single query's history, say) adds a <Route>
 * here and nothing outside changes.
 *
 * **The OAuth callback lands on the index route**, carrying `?connected=1` or
 * `?error=<code>` plus `?project=`. That is why the catch-all below preserves
 * the query string: a redirect that dropped it would turn a completed
 * connection into a silent no-op on an unexplained blank page.
 */
import { Navigate, Route, Routes, useLocation } from "react-router";

import { SearchConsolePage } from "./search-console-page";

function RedirectToIndex() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/search-console", search }} replace />;
}

export function SearchConsoleModule() {
  return (
    <Routes>
      <Route index element={<SearchConsolePage />} />
      <Route path="*" element={<RedirectToIndex />} />
    </Routes>
  );
}
