/**
 * AI Visibility module root, mounted at /app/ai-visibility/* so all of its
 * routing happens here rather than in the app-wide route table.
 *
 * One screen today, with its two areas — the prompts manager and the results —
 * as tabs rather than routes, because they share a project selection, a header
 * and a "Run now" button, and splitting them would mean resolving the project
 * twice. The tab is still in the URL (`?view=`), so a link to either area is
 * shareable; see `ai-visibility-page.tsx`.
 *
 * The nested <Routes> exists so a later sub-screen stays this module's
 * decision — adding a <Route> here changes nothing outside.
 */
import { Navigate, Route, Routes, useLocation } from "react-router";

import { AiVisibilityPage } from "./ai-visibility-page";

/**
 * Anything below the module that is not a route we know goes back to the
 * index — keeping the query string, because `?project=` lives there and
 * dropping it would turn a mistyped path into the wrong project.
 */
function RedirectToIndex() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/ai-visibility", search }} replace />;
}

export function AiVisibilityModule() {
  return (
    <Routes>
      <Route index element={<AiVisibilityPage />} />
      <Route path="*" element={<RedirectToIndex />} />
    </Routes>
  );
}
