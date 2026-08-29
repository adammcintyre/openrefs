/**
 * Render smoke tests for the Search Console module.
 *
 * **These stand in for a live connection.** Google is not configured in the
 * development environment, so `configured: false` is the only state a running
 * server can actually produce. Every state past it — connected, broken,
 * property-less, and the three report tabs — is proven here instead, against
 * fixtures built directly from the types in `src/shared/gsc.ts`. `tsc` proves
 * the fixtures match the contract; these tests prove the screen renders the
 * right thing from them.
 *
 * `renderToString` is the whole harness: no jsdom, no testing-library, no new
 * dependency, matching rank-tracking's and domain-overview's smoke tests.
 * TanStack Query does not fetch during a server render, so every query is
 * seeded from the cache and these tests are hermetic and spend nothing.
 *
 * Effects do not run under `renderToString`, so anything asserted here is
 * first-render output. That is deliberate for the callback notice — it is
 * seeded from the URL rather than only set in an effect, precisely so a failed
 * connection is explained in the first frame.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type {
  GscOpportunitiesResponse,
  GscOverviewResponse,
  GscPagesResponse,
  GscQueriesResponse,
  GscSitesResponse,
  GscStatusResponse,
} from "../../../shared/gsc";
import type { ProjectListResponse } from "../../../shared/projects";
import type { Workspace, WorkspaceRole } from "../../../shared/workspaces";
import { ToastProvider } from "../../components/ui/toast";
import { SearchConsoleModule } from "./module";

const WORKSPACE_ID = "ws-1";
const PROJECT_ID = "proj-1";

function workspaces(role: WorkspaceRole = "owner"): Workspace[] {
  return [
    {
      id: WORKSPACE_ID,
      name: "My workspace",
      role,
      spendCapUsd: 0,
      credentials: { configured: true, login: "ke***@example.com" },
      createdAt: 0,
    },
  ];
}

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
      lastCheckedAt: null,
    },
  ],
};

/* ------------------------------ status fixtures ---------------------------- */

/*
 * Verbatim the body a running dev server returns from
 * `GET /api/v1/gsc/status` with no GOOGLE_CLIENT_ID configured — the one state
 * that can be verified live, checked against the real response rather than
 * imagined. Every fixture below it is typed from the same contract.
 */
const UNCONFIGURED: GscStatusResponse = {
  configured: false,
  connected: false,
  property: null,
  broken: false,
};

const NOT_CONNECTED: GscStatusResponse = {
  configured: true,
  connected: false,
  property: null,
  broken: false,
};

const BROKEN: GscStatusResponse = {
  configured: true,
  connected: true,
  property: "sc-domain:brandpacks.com",
  broken: true,
};

const NO_PROPERTY: GscStatusResponse = {
  configured: true,
  connected: true,
  property: null,
  broken: false,
};

const CONNECTED: GscStatusResponse = {
  configured: true,
  connected: true,
  property: "sc-domain:brandpacks.com",
  broken: false,
};

const SITES: GscSitesResponse = {
  property: null,
  sites: [
    { siteUrl: "https://unrelated.example/", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:brandpacks.com", permissionLevel: "siteOwner" },
    { siteUrl: "sc-domain:oldsite.test", permissionLevel: "siteUnverifiedUser" },
  ],
};

/* ------------------------------ report fixtures ---------------------------- */

const RANGE = {
  from: "2026-07-31",
  to: "2026-08-27",
  freshTo: "2026-08-27",
  property: "sc-domain:brandpacks.com",
  cached: false,
} as const;

/*
 * The CTR here is the trap the formatting exists for: 0.0423 is 4.2%, and a
 * component that forgot the fraction would print "0.04%".
 */
const OVERVIEW: GscOverviewResponse = {
  ...RANGE,
  totals: { clicks: 1234, impressions: 29_180, ctr: 0.0423, position: 12.37 },
  daily: [
    { date: "2026-08-25", clicks: 40, impressions: 1000, ctr: 0.04, position: 12.1 },
    { date: "2026-08-26", clicks: 80, impressions: 900, ctr: 0.0889, position: 11.4 },
    { date: "2026-08-27", clicks: 20, impressions: 500, ctr: 0.04, position: 13.2 },
  ],
};

const QUERIES: GscQueriesResponse = {
  ...RANGE,
  total: 1043,
  limit: 200,
  offset: 0,
  rows: [
    { query: "photo booth templates", clicks: 300, impressions: 4000, ctr: 0.075, position: 6.2 },
    { query: "booth props printable", clicks: 120, impressions: 9000, ctr: 0.0133, position: 14.8 },
  ],
};

const PAGES: GscPagesResponse = {
  ...RANGE,
  total: 2,
  limit: 200,
  offset: 0,
  rows: [
    {
      page: "https://brandpacks.com/templates/photo-booth",
      clicks: 280,
      impressions: 3800,
      ctr: 0.0737,
      position: 6.4,
    },
    {
      page: "https://brandpacks.com/blog/booth-ideas",
      clicks: 60,
      impressions: 2100,
      ctr: 0.0286,
      position: 15.1,
    },
  ],
};

/*
 * `minImpressions` is the median of this property's own query set, so the
 * explainer must quote *this* number. Anything hardcoded would be wrong here.
 */
const OPPORTUNITIES: GscOpportunitiesResponse = {
  ...RANGE,
  thresholds: {
    strikingDistance: { minPosition: 5, maxPosition: 20, minImpressions: 1204 },
    lowCtr: { maxPosition: 10, ratio: 0.5 },
    cannibalization: { minShareOfClicks: 0.2, minPages: 2 },
  },
  strikingDistance: {
    // Capped list: 200 shown of 843, which the UI has to say out loud.
    total: 843,
    items: [
      {
        rule: "striking_distance",
        query: "booth props printable",
        page: "https://brandpacks.com/blog/booth-ideas",
        clicks: 120,
        impressions: 9000,
        ctr: 0.0133,
        position: 14.8,
      },
    ],
  },
  lowCtr: {
    total: 1,
    items: [
      {
        rule: "low_ctr",
        query: "photo booth templates",
        page: "https://brandpacks.com/templates/photo-booth",
        clicks: 300,
        impressions: 4000,
        ctr: 0.075,
        position: 3.1,
        expectedCtr: 0.32,
        ctrRatio: 0.234,
      },
    ],
  },
  cannibalization: {
    total: 1,
    items: [
      {
        rule: "cannibalization",
        // Deliberately the same query as the striking-distance row: a query
        // may legitimately appear under more than one rule.
        query: "booth props printable",
        page: "https://brandpacks.com/blog/booth-ideas",
        clicks: 120,
        impressions: 9000,
        ctr: 0.0133,
        position: 14.8,
        pages: [
          {
            page: "https://brandpacks.com/blog/booth-ideas",
            shareOfClicks: 0.6,
            clicks: 72,
            impressions: 5000,
            ctr: 0.0144,
            position: 13.2,
          },
          {
            page: "https://brandpacks.com/templates/props",
            shareOfClicks: 0.4,
            clicks: 48,
            impressions: 4000,
            ctr: 0.012,
            position: 16.9,
          },
        ],
      },
    ],
  },
};

/* --------------------------------- harness --------------------------------- */

interface Seed {
  status?: GscStatusResponse;
  role?: WorkspaceRole;
  sites?: GscSitesResponse;
  reports?: boolean;
}

function seededClient(seed: Seed): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], workspaces(seed.role));
  client.setQueryData(["projects", "list", WORKSPACE_ID], PROJECTS);

  if (seed.status !== undefined) {
    client.setQueryData(["gsc", "status", WORKSPACE_ID, PROJECT_ID], seed.status);
  }
  if (seed.sites !== undefined) {
    client.setQueryData(["gsc", "sites", WORKSPACE_ID, PROJECT_ID], seed.sites);
  }
  if (seed.reports === true) {
    const key = (report: string) =>
      ["gsc", report, WORKSPACE_ID, PROJECT_ID, "28d"] as const;
    client.setQueryData(key("overview"), OVERVIEW);
    client.setQueryData(key("queries"), QUERIES);
    client.setQueryData(key("pages"), PAGES);
    client.setQueryData(key("opportunities"), OPPORTUNITIES);
  }
  return client;
}

function render(url: string, seed: Seed = {}): string {
  return renderToString(
    <QueryClientProvider client={seededClient(seed)}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route
              path="/app/search-console/*"
              element={<SearchConsoleModule />}
            />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const AT_PROJECT = `/app/search-console?project=${PROJECT_ID}`;

/* --------------------------------- picker ---------------------------------- */

describe("with no project selected", () => {
  it("renders the project picker as the empty state", () => {
    const html = render("/app/search-console");
    expect(html).toContain("Choose a project");
    expect(html).toContain("BrandPacks");
  });

  it("does not guess a project on the user's behalf", () => {
    expect(render("/app/search-console")).not.toContain("Connect Google");
  });
});

/* ------------------------------ not configured ----------------------------- */

describe("configured: false", () => {
  const html = render(AT_PROJECT, { status: UNCONFIGURED });

  /*
   * The state a self-hosted deployment sits in by default. It has to read as
   * a setup guide, not as a fault.
   */
  it("renders the operator setup card rather than an error", () => {
    expect(html).toContain("Search Console isn&#x27;t set up on this deployment");
    expect(html).toContain("Operator setup");
    expect(html).not.toContain("Something went wrong");
  });

  it("names every configuration step from the spec", () => {
    expect(html).toContain("Google Search Console API");
    expect(html).toContain("webmasters.readonly");
    expect(html).toContain("Web application");
    expect(html).toContain("GOOGLE_CLIENT_ID");
    expect(html).toContain("GOOGLE_CLIENT_SECRET");
    expect(html).toContain("/privacy");
  });

  /*
   * The single most common way to lose an hour on this setup. The exact
   * redirect URI is shown for the host being served, so it can be copied
   * rather than transcribed.
   */
  it("warns that the redirect URI must match byte for byte", () => {
    expect(html).toContain("This must match byte for byte");
    expect(html).toContain("redirect_uri_mismatch");
    expect(html).toContain("/api/v1/gsc/callback");
  });

  it("offers no Connect button, because there is nothing to connect to", () => {
    expect(html).not.toContain("Connect Google Search Console");
  });

  it("tells a member these steps are not theirs to run", () => {
    const member = render(AT_PROJECT, {
      status: UNCONFIGURED,
      role: "member",
    });
    expect(member).toContain("they are the operator&#x27;s to run");
  });
});

/* ------------------------------- not connected ----------------------------- */

describe("connected: false", () => {
  const html = render(AT_PROJECT, { status: NOT_CONNECTED });

  it("leads with the connect action", () => {
    expect(html).toContain("Connect Google Search Console");
    expect(html).toContain("read-only");
  });

  it("does not show setup instructions once the client is configured", () => {
    expect(html).not.toContain("Operator setup");
  });

  /*
   * Admin-only server-side. A member gets the reason rather than a disabled
   * button they cannot explain.
   */
  it("gives a member the reason instead of a dead button", () => {
    const member = render(AT_PROJECT, {
      status: NOT_CONNECTED,
      role: "member",
    });
    expect(member).toContain("Connecting Search Console is an admin action");
    // The heading still says "Connect Google Search Console"; what a member
    // must not get is the *button*, which the API would reject with a 403.
    expect(html).toContain("Connect Google Search Console</button>");
    expect(member).not.toContain("Connect Google Search Console</button>");
  });
});

/* --------------------------------- broken ---------------------------------- */

describe("broken: true", () => {
  const html = render(AT_PROJECT, { status: BROKEN });

  /*
   * A dead grant must not read as "you never connected this". The user did
   * connect it, and the numbers they saw last week were real.
   */
  it("says the connection died rather than that it never existed", () => {
    expect(html).toContain("Google stopped accepting this connection");
    expect(html).toContain("Reconnect Google Search Console");
  });

  it("does not render reports over a connection that cannot refresh", () => {
    expect(html).not.toContain("Average position");
  });
});

/* ------------------------------ no property -------------------------------- */

describe("property: null", () => {
  const html = render(AT_PROJECT, { status: NO_PROPERTY, sites: SITES });

  it("renders the property picker", () => {
    expect(html).toContain("Choose a Search Console property");
    expect(html).toContain("brandpacks.com");
    expect(html).toContain("unrelated.example");
  });

  /* Suggests, never decides — binding the wrong property reports another
     site's numbers under this project's name. */
  it("marks the property that matches the project without selecting it", () => {
    expect(html).toContain("Matches this project");
    expect(html).toContain("Nothing is chosen for you");
  });

  /* Listed by Google, but they hold no data. Shown and blocked. */
  it("shows unverified properties as unusable rather than hiding them", () => {
    expect(html).toContain("Unverified");
    expect(html).toContain("no data available on an unverified property");
  });

  it("tells a member to ask an admin", () => {
    const member = render(AT_PROJECT, {
      status: NO_PROPERTY,
      sites: SITES,
      role: "member",
    });
    expect(member).toContain("Choosing the property is an admin action");
  });
});

/* --------------------------------- reports --------------------------------- */

describe("connected with reports", () => {
  const html = render(AT_PROJECT, { status: CONNECTED, reports: true });

  it("renders the four overview metrics", () => {
    expect(html).toContain("Clicks");
    expect(html).toContain("Impressions");
    expect(html).toContain("Average CTR");
    expect(html).toContain("Average position");
  });

  /*
   * The formatting mistake that would be invisible: ctr arrives as 0.0423 and
   * must render as 4.2%, not 0.04%.
   */
  it("renders CTR as a percentage of the fraction Google sent", () => {
    expect(html).toContain("4.2%");
    expect(html).not.toContain("0.04%");
    expect(html).not.toContain("0.0423");
  });

  it("renders average position to one decimal", () => {
    expect(html).toContain("12.4");
  });

  it("renders the counts with separators", () => {
    expect(html).toContain("1,234");
    expect(html).toContain("29,180");
  });

  /* Nothing here spends. The cost slot reports freshness instead. */
  it("shows a data-to chip and never a cost chip", () => {
    expect(html).toContain("Data to 27 Aug 2026");
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain("Cost");
  });

  it("shows the connected property and the range", () => {
    expect(html).toContain("brandpacks.com");
    expect(html).toContain("31 Jul 2026");
    expect(html).toContain("27 Aug 2026");
  });

  it("offers all three tabs", () => {
    expect(html).toContain("Queries");
    expect(html).toContain("Pages");
    expect(html).toContain("Opportunities");
  });

  it("defaults to the queries tab and renders its rows", () => {
    expect(html).toContain("photo booth templates");
    expect(html).toContain("booth props printable");
  });

  /* A capped set must not read as the whole picture. */
  it("says when the query table is showing a slice", () => {
    expect(html).toContain("Showing the top 2 of 1,043");
  });

  it("offers a CSV export of the loaded rows", () => {
    expect(html).toContain("Export CSV");
  });

  it("explains the indexed chart axis rather than leaving it to be guessed", () => {
    expect(html).toContain("scaled against its own best day");
    expect(html).toContain("Best day for clicks");
  });

  it("offers to change the property and to disconnect", () => {
    expect(html).toContain("Change property");
    expect(html).toContain("Disconnect");
  });

  it("hides the connection controls from a member", () => {
    const member = render(AT_PROJECT, {
      status: CONNECTED,
      reports: true,
      role: "member",
    });
    expect(member).toContain("Connected by an admin");
    expect(member).not.toContain("Change property");
  });
});

/* ------------------------------ opportunities ------------------------------ */

describe("the opportunities tab", () => {
  const html = render(`${AT_PROJECT}&tab=opportunities`, {
    status: CONNECTED,
    reports: true,
  });

  it("renders all three rules", () => {
    expect(html).toContain("Striking distance");
    expect(html).toContain("Low click-through rate");
    expect(html).toContain("Cannibalization");
  });

  /*
   * The explainer must quote the thresholds the worker actually ran with.
   * Striking distance's floor is the median of this property's own query set —
   * 1,204 here — and a hardcoded sentence would be wrong for every property.
   */
  it("quotes the live striking-distance threshold and calls it a median", () => {
    expect(html).toContain("1,204");
    expect(html).toContain("median");
    expect(html).toContain("position 5.0 to 20.0");
  });

  it("quotes the live low-CTR threshold as a percentage", () => {
    expect(html).toContain("position 10.0 or better");
    expect(html).toContain("under 50% of what a result");
  });

  it("quotes the live cannibalization thresholds", () => {
    expect(html).toContain("2 or more of your pages each take at least 20%");
  });

  it("says when a rule's list has been capped", () => {
    expect(html).toContain("Showing the top 1 of 843");
  });

  /* A query in two lists is a finding, not double-counting. */
  it("explains that a query may appear under more than one rule", () => {
    expect(html).toContain("can appear in more than one list");
  });

  it("offers View SERP on striking-distance rows", () => {
    expect(html).toContain("View SERP");
  });

  it("shows the competing pages and their click shares", () => {
    expect(html).toContain("/blog/booth-ideas");
    expect(html).toContain("/templates/props");
    expect(html).toContain("60%");
    expect(html).toContain("40%");
  });

  it("shows the low-CTR row against its expected rate", () => {
    // 0.075 actual, 0.32 expected, 0.234 of expected.
    expect(html).toContain("7.5%");
    expect(html).toContain("32.0%");
    expect(html).toContain("23%");
  });
});

/* -------------------------------- callbacks -------------------------------- */

describe("landing from the OAuth callback", () => {
  /*
   * The user pressed Cancel on Google's consent screen. They know what they
   * did; a red banner explaining their own decision back to them would be the
   * app arguing with the user.
   */
  it("says nothing at all about a cancellation", () => {
    const html = render(
      `/app/search-console?project=${PROJECT_ID}&error=access_denied`,
      { status: NOT_CONNECTED },
    );
    expect(html).not.toContain("didn&#x27;t complete");
    expect(html).not.toContain("role=\"alert\"");
    // Still on the connect screen, ready for a second attempt.
    expect(html).toContain("Connect Google Search Console");
  });

  it("explains a real failure in the first frame", () => {
    const html = render(
      `/app/search-console?project=${PROJECT_ID}&error=expired_state`,
      { status: NOT_CONNECTED },
    );
    expect(html).toContain("That connection attempt timed out");
    expect(html).toContain("ten minutes");
  });

  it("explains a state mismatch without blaming the user", () => {
    const html = render(
      `/app/search-console?project=${PROJECT_ID}&error=state_mismatch`,
      { status: NOT_CONNECTED },
    );
    expect(html).toContain("Someone else finished that connection");
  });

  it("keeps the project selection while carrying a callback result", () => {
    const html = render(
      `/app/search-console?connected=1&project=${PROJECT_ID}`,
      { status: NO_PROPERTY, sites: SITES },
    );
    // The project stayed selected, so the next step is on screen.
    expect(html).toContain("Choose a Search Console property");
  });
});
