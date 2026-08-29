/**
 * Render smoke tests for the module.
 *
 * `tsc` proves the props line up; it cannot prove the tree mounts. This module
 * renders a hand-written SVG per row, a context-fed table and three dialogs —
 * exactly the kind of thing that typechecks and then throws at render.
 *
 * `renderToString` is the whole harness: no jsdom, no testing-library, no new
 * dependency, matching domain-overview's and gap-analysis's smoke tests.
 * TanStack Query does not fetch during a server render, so every query is
 * seeded from the cache and these tests are hermetic and spend nothing.
 *
 * The fixtures encode the three states this screen must never confuse:
 * a keyword that has never been checked, one checked and not in the top 100,
 * and one that ranks — plus a sparse series with a gap in it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type { MetaLocationsResponse } from "../../../shared/keywords";
import type { ProjectListResponse } from "../../../shared/projects";
import type {
  TrackedKeywordRow,
  TrackedKeywordsResponse,
} from "../../../shared/tracking";
import type { Workspace } from "../../../shared/workspaces";
import { RANK_CHECK_COST_PER_KEYWORD_USD } from "../../../shared/tracking";
import { formatCostHint } from "../../components/tracking/format";
import { ToastProvider } from "../../components/ui/toast";
import { RankTrackingModule } from "./module";

const WORKSPACE_ID = "ws-1";
const PROJECT_ID = "proj-1";
const OTHER_PROJECT_ID = "proj-2";

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

const LOCATIONS: MetaLocationsResponse = {
  costUsd: 0,
  cached: true,
  locations: [
    {
      code: 2826,
      name: "United Kingdom",
      countryIsoCode: "GB",
      languages: [{ code: "en", name: "English" }],
    },
  ],
};

const PROJECTS: ProjectListResponse = {
  projects: [
    {
      id: PROJECT_ID,
      name: "BrandPacks",
      domain: "brandpacks.com",
      locationCode: 2826,
      languageCode: "en",
      createdAt: "2026-08-01T00:00:00.000Z",
      keywordCount: 3,
      lastCheckedAt: "2026-08-20T00:00:00.000Z",
    },
    {
      id: OTHER_PROJECT_ID,
      name: "HikeList",
      domain: "hikelist.com",
      locationCode: 2826,
      languageCode: "en",
      createdAt: "2026-07-01T00:00:00.000Z",
      keywordCount: 0,
      lastCheckedAt: null,
    },
  ],
};

function keyword(overrides: Partial<TrackedKeywordRow>): TrackedKeywordRow {
  return {
    id: "tk-0",
    keyword: "keyword",
    device: "desktop",
    locationCode: 2826,
    languageCode: "en",
    createdAt: "2026-08-01T00:00:00.000Z",
    latest: null,
    previous: null,
    change1d: null,
    change7d: null,
    change30d: null,
    bestPosition: null,
    aiOverview: false,
    series: [],
    ...overrides,
  };
}

/** Ranks, improved over the week, and has a gap in the middle of its series. */
const RANKED = keyword({
  id: "tk-1",
  keyword: "photo booth templates",
  latest: {
    date: "2026-08-20",
    position: 4,
    url: "https://brandpacks.com/templates/photo-booth",
    serpFeatures: ["organic", "people_also_ask"],
  },
  previous: { date: "2026-08-19", position: 6 },
  change1d: 2,
  change7d: 5,
  change30d: -3,
  bestPosition: 3,
  // Sparse on purpose: the 17th was never checked, and the 18th was checked
  // and found nothing. Both have to survive the sparkline.
  series: [
    { date: "2026-08-15", position: 9 },
    { date: "2026-08-16", position: 8 },
    { date: "2026-08-18", position: null },
    { date: "2026-08-19", position: 6 },
    { date: "2026-08-20", position: 4 },
  ],
});

/** Checked, and nowhere in the top 100. A measurement, not an absence. */
const UNRANKED = keyword({
  id: "tk-2",
  keyword: "booth props printable",
  device: "mobile",
  latest: { date: "2026-08-20", position: null, url: null, serpFeatures: [] },
  series: [{ date: "2026-08-20", position: null }],
});

/** Added minutes ago: no snapshot exists at all. */
const AWAITING = keyword({ id: "tk-3", keyword: "strip template" });

const TRACKED: TrackedKeywordsResponse = {
  projectId: PROJECT_ID,
  domain: "brandpacks.com",
  keywords: [RANKED, UNRANKED, AWAITING],
  lastCheckedAt: "2026-08-20T00:00:00.000Z",
  checkInProgress: false,
};

const EMPTY_PROJECT: TrackedKeywordsResponse = {
  projectId: OTHER_PROJECT_ID,
  domain: "hikelist.com",
  keywords: [],
  lastCheckedAt: null,
  checkInProgress: true,
};

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["meta", "locations", WORKSPACE_ID], LOCATIONS);
  client.setQueryData(["projects", "list", WORKSPACE_ID], PROJECTS);
  client.setQueryData(
    ["tracking", "keywords", WORKSPACE_ID, PROJECT_ID],
    TRACKED,
  );
  client.setQueryData(
    ["tracking", "keywords", WORKSPACE_ID, OTHER_PROJECT_ID],
    EMPTY_PROJECT,
  );
  return client;
}

function render(url: string): string {
  return renderToString(
    <QueryClientProvider client={seededClient()}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route path="/app/rank-tracking/*" element={<RankTrackingModule />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* -------------------------------- the picker ------------------------------- */

describe("with no project selected", () => {
  it("renders the picker as the empty state", () => {
    const html = render("/app/rank-tracking");
    expect(html).toContain("Choose a project");
    expect(html).toContain("BrandPacks");
    expect(html).toContain("brandpacks.com");
  });

  it("offers to create one for an admin", () => {
    expect(render("/app/rank-tracking")).toContain("New project");
  });

  it("does not guess a project on the user's behalf", () => {
    // Two projects exist; neither may be auto-selected, so the tracking
    // header must not appear.
    expect(render("/app/rank-tracking")).not.toContain("Last checked");
  });
});

/* ------------------------------- the table -------------------------------- */

describe("with ?project= selecting a project", () => {
  const html = render(`/app/rank-tracking?project=${PROJECT_ID}`);

  it("renders the header with domain, count and last-checked date", () => {
    expect(html).toContain("BrandPacks");
    expect(html).toContain("brandpacks.com");
    expect(html).toContain("3 keywords");
    // A date, never a clock time — the snapshot is day-grained.
    expect(html).toContain("20 Aug 2026");
    expect(html).not.toMatch(/00:00/);
  });

  it("renders every metric card", () => {
    expect(html).toContain("Tracked keywords");
    expect(html).toContain("Average position");
    expect(html).toContain("In the top 10");
    expect(html).toContain("Net movement (7d)");
  });

  /*
   * The distinction the whole screen rests on: one keyword has never been
   * checked and one was checked and did not rank. They must not read the same.
   */
  it("separates 'awaiting first check' from 'not in the top 100'", () => {
    expect(html).toContain("Awaiting first check");
    expect(html).toContain("photo booth templates");
    expect(html).toContain("booth props printable");
  });

  it("renders the ranking URL as a path, with the full URL on the link", () => {
    expect(html).toContain("/templates/photo-booth");
    expect(html).toContain("https://brandpacks.com/templates/photo-booth");
  });

  it("draws a sparkline that survives a gap in the series", () => {
    // Two <polyline>s, not one: the run before the unranked day and the run
    // after it. A single polyline would mean the gap had been drawn through.
    expect(html.match(/<polyline/g) ?? []).toHaveLength(2);
    // Four ranked points out of five observations — the null is not counted
    // as a check that found something.
    expect(html).toContain("4 checks in the last 30 days");
  });

  it("renders both devices", () => {
    expect(html).toContain("Desktop");
    expect(html).toContain("Mobile");
  });

  it("shows the movers panel with the week's gain", () => {
    expect(html).toContain("Biggest gains");
    expect(html).toContain("+5");
  });

  /*
   * The hint is derived from RANK_CHECK_COST_PER_KEYWORD_USD, never typed into
   * a component — the price already moved once (DataForSEO re-based SERP
   * billing in 2025-09, which is why docs/specs/PHASE3.md is stale). Computing
   * the expectation from the same constant is what makes this test notice a
   * hardcoded literal rather than agreeing with it.
   */
  it("offers Check now with a cost hint from the shared constant", () => {
    expect(html).toContain("Check now");
    expect(html).toContain(
      `≈ ${formatCostHint(3 * RANK_CHECK_COST_PER_KEYWORD_USD)}`,
    );
  });

  it("offers Add keywords and a CSV export", () => {
    expect(html).toContain("Add keywords");
    expect(html).toContain("Export CSV");
  });
});

/* ------------------------------- empty + busy ------------------------------ */

describe("a project with no keywords yet", () => {
  const html = render(`/app/rank-tracking?project=${OTHER_PROJECT_ID}`);

  it("points at Add keywords and sets expectations about timing", () => {
    expect(html).toContain("No keywords tracked yet");
    expect(html).toContain("5 to 20 minutes");
  });

  it("says a check is running rather than 'no data'", () => {
    expect(html).toContain("Checking…");
  });

  it("says it has never been checked", () => {
    expect(html).toContain("Not checked yet");
  });
});

/* -------------------------------- bad input -------------------------------- */

describe("a ?project= that does not resolve", () => {
  it("falls back to the picker rather than a broken screen", () => {
    const html = render("/app/rank-tracking?project=deleted-or-другой-tenant");
    expect(html).toContain("Choose a project");
    expect(html).not.toContain("Last checked");
  });
});

describe("an unknown sub-path", () => {
  /*
   * <Navigate> is a client-side effect: on a server render it emits nothing
   * and the redirect happens on hydration. So the assertion is that the route
   * renders the redirect rather than throwing or falling through to a blank
   * module — the destination itself is covered by the tests above.
   */
  it("renders a redirect rather than crashing", () => {
    expect(() =>
      render(`/app/rank-tracking/nonsense?project=${PROJECT_ID}`),
    ).not.toThrow();
    expect(render(`/app/rank-tracking/nonsense?project=${PROJECT_ID}`)).toBe("");
  });
});
