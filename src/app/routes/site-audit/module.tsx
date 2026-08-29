/**
 * Site Audit module root, mounted at /app/site-audit/* so all of its routing
 * happens here rather than in the app-wide route table.
 *
 * Two screens: the audit itself, and one category's affected pages. The
 * drill-down is a real route rather than a dialog because it is the thing a
 * user wants to send to a developer — "here are the 41 pages with a missing
 * title" is a URL, not a modal someone else has to reproduce.
 */
import { Navigate, Route, Routes, useLocation } from "react-router";

import { SiteAuditPage } from "./audit-page";
import { AuditCategoryPage } from "./category-page";

/**
 * Anything below the module that is not a route we know goes back to the
 * index — keeping the query string, because `?project=` and `?audit=` live
 * there and dropping them would turn a mistyped path into the wrong project.
 */
function RedirectToIndex() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/app/site-audit", search }} replace />;
}

export function SiteAuditModule() {
  return (
    <Routes>
      <Route index element={<SiteAuditPage />} />
      <Route path=":auditId/:category" element={<AuditCategoryPage />} />
      <Route path="*" element={<RedirectToIndex />} />
    </Routes>
  );
}
