/**
 * Keyword Research — the module root.
 *
 * Mounted at `/app/keyword-research/*` by the app route tree, so every
 * sub-route lives here rather than in the shared router:
 *
 *   /app/keyword-research                    search + results
 *   /app/keyword-research/collections        saved keyword lists
 *   /app/keyword-research/collections/:id    one list
 *
 * The active workspace is resolved once, here, and passed down. Every endpoint
 * in this module is workspace-scoped (`?workspace=<id>`), and the Worker
 * verifies membership on each call — so the screens below never have to guess
 * which workspace they are in, and a screen rendered before the workspace list
 * has loaded holds its queries rather than firing them against an empty id.
 */
import { Navigate, Route, Routes } from "react-router";

import { Card, Skeleton } from "../../components/ui";
import { useActiveWorkspace } from "../../lib/workspaces";
import { CollectionDetail } from "./collection-detail";
import { CollectionsList } from "./collections-list";
import { KeywordSearchView } from "./search-view";

function ModuleSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading Keyword Research…</span>
      <Skeleton className="h-8 w-64 rounded-app" />
      <Card className="p-5">
        <Skeleton className="h-9 w-full rounded-app" />
      </Card>
      <Skeleton className="h-64 w-full rounded-app" />
    </div>
  );
}

export function KeywordResearchModule() {
  const { activeWorkspaceId, isPending } = useActiveWorkspace();

  if (isPending) return <ModuleSkeleton />;

  return (
    <Routes>
      <Route index element={<KeywordSearchView />} />
      <Route
        path="collections"
        element={<CollectionsList workspaceId={activeWorkspaceId} />}
      />
      <Route
        path="collections/:id"
        element={<CollectionDetail workspaceId={activeWorkspaceId} />}
      />
      {/* Anything else under this module goes back to the search screen. */}
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}
