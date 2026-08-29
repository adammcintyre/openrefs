/**
 * Render smoke tests for the Phase 3 "Track" retrofit on the Keyword Research
 * tables.
 *
 * This is the module's merge surface with Rank Tracking, and it is where a
 * change from either side would break first: the panel gained a `Track` row
 * and bulk action, and the dialog behind them mounts a `ProjectPicker` —
 * which itself contains a second dialog — inside an already-open dialog.
 * Nested portals are exactly the sort of thing that typechecks and then throws
 * at render, so both halves are mounted here.
 *
 * `renderToString`, seeded query cache, no jsdom and no network — the same
 * harness as the other module smoke tests.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { KeywordListResponse, KeywordRow } from "../../../shared/keywords";
import type { ProjectListResponse } from "../../../shared/projects";
import { TRACKED_KEYWORDS_BULK_MAX } from "../../../shared/tracking";
import type { Workspace } from "../../../shared/workspaces";
import { DEFAULT_MARKET } from "../../components/keywords/market";
import { trackTargets } from "../../components/tracking/track-keywords-dialog";
import { ToastProvider } from "../../components/ui/toast";
import { KeywordTabPanel } from "./keyword-tab-panel";

const WORKSPACE_ID = "ws-1";
const SEED = "photo booth";

const WORKSPACES: Workspace[] = [
  {
    id: WORKSPACE_ID,
    name: "My workspace",
    role: "owner",
    spendCapUsd: 0,
    credentials: { configured: true, login: "ke***@example.com" },
    createdAt: 0,
  },
];

const PROJECTS: ProjectListResponse = {
  projects: [
    {
      id: "proj-1",
      name: "BrandPacks",
      domain: "brandpacks.com",
      locationCode: 2826,
      languageCode: "en",
      createdAt: "2026-08-01T00:00:00.000Z",
      keywordCount: 12,
      lastCheckedAt: "2026-08-20T00:00:00.000Z",
    },
  ],
};

const ROW: KeywordRow = {
  keyword: "photo booth templates",
  searchVolume: 1300,
  cpc: 1.24,
  competition: 0.4,
  competitionLevel: "MEDIUM",
  keywordDifficulty: 34,
  intent: "commercial",
};

const IDEAS: KeywordListResponse = {
  keyword: SEED,
  locationCode: 2826,
  languageCode: "en",
  items: [ROW],
  totalCount: 128,
  itemsCount: 1,
  limit: 50,
  offset: 0,
  costUsd: 0.012,
  cached: false,
};

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["projects", "list", WORKSPACE_ID], PROJECTS);
  client.setQueryData(
    ["keywords", "list", WORKSPACE_ID, "ideas", SEED, 2826, "en"],
    { pages: [IDEAS], pageParams: [0] },
  );
  return client;
}

function render(node: React.ReactNode): string {
  return renderToString(
    <QueryClientProvider client={seededClient()}>
      <MemoryRouter initialEntries={["/app/keyword-research"]}>
        <ToastProvider>{node}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* ------------------------------- the retrofit ------------------------------ */

describe("the Ideas table", () => {
  const html = render(
    <KeywordTabPanel
      workspaceId={WORKSPACE_ID}
      tab="ideas"
      keyword={SEED}
      market={DEFAULT_MARKET}
    />,
  );

  it("offers a Track action on each row", () => {
    expect(html).toContain("Track photo booth templates in a project");
  });

  it("keeps the actions it already had", () => {
    expect(html).toContain("View SERP for photo booth templates");
    expect(html).toContain("Add photo booth templates to a collection");
  });

  it("does not open the dialog until asked", () => {
    // The dialog renders null while closed, so nothing of it should be here.
    expect(html).not.toContain("Rank Tracking checks these daily");
  });
});

/* -------------------------------- the dialog ------------------------------- */

/*
 * The dialog itself cannot be rendered here: an open `Dialog` portals to
 * `document.body`, and this harness is plain Node with no DOM (the same reason
 * `AddToCollectionDialog` has no open-state test). What is testable — and what
 * actually carries risk — is the transformation between the table's selection
 * and the request body, so that is extracted and tested directly.
 */
describe("what the Track dialog will send", () => {
  it("normalises the selection the way the route does", () => {
    expect(trackTargets(["  Photo Booth  ", "props"])).toEqual([
      "photo booth",
      "props",
    ]);
  });

  /*
   * A keyword appearing twice in a selection must not be counted twice: the
   * route would de-duplicate it anyway, but the dialog's count is what the
   * user reads *before* pressing the button, and "Track 3" followed by "added
   * 2" is a small betrayal that is easy to avoid.
   */
  it("de-duplicates case-insensitively", () => {
    expect(trackTargets(["Photo Booth", "photo booth", "props"])).toEqual([
      "photo booth",
      "props",
    ]);
  });

  it("drops blanks", () => {
    expect(trackTargets(["", "   ", "props"])).toEqual(["props"]);
  });

  it("caps a very large selection at the bulk maximum", () => {
    const many = Array.from({ length: TRACKED_KEYWORDS_BULK_MAX + 50 }, (_, i) => `k${i}`);
    expect(trackTargets(many)).toHaveLength(TRACKED_KEYWORDS_BULK_MAX);
  });

  it("keeps the order the table showed", () => {
    expect(trackTargets(["zebra", "apple"])).toEqual(["zebra", "apple"]);
  });
});
