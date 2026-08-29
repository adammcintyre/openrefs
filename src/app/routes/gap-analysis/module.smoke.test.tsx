/**
 * Render smoke tests for the module.
 *
 * `tsc` proves the props line up; it cannot prove the tree mounts. This module
 * builds its table columns *dynamically* — one per competitor, from the URL —
 * which is exactly the kind of thing that typechecks and then throws at render.
 *
 * `renderToString` is the whole harness: no jsdom, no testing-library, no new
 * dependency, matching domain-overview's smoke test. TanStack Query does not
 * fetch during a server render, so every query is seeded from the cache and
 * these tests are hermetic and spend nothing.
 *
 * The fixtures encode the one thing this screen must never get wrong: a
 * `position` of `null` means "does not rank", and has to reach the page as a
 * dash rather than as a zero.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type { GapKeywordRow, GapKeywordsResponse } from "../../../shared/gap";
import type { MetaLocationsResponse } from "../../../shared/keywords";
import type { Workspace } from "../../../shared/workspaces";
import { ToastProvider } from "../../components/ui/toast";
import { GapAnalysisModule } from "./module";

const WORKSPACE_ID = "ws-1";
const TARGET = "brandpacks.com";
const COMPETITORS = ["templatesbooth.com", "hikelist.com"];

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

/** Both competitors rank, we do not: the definition of a `missing` keyword. */
const MISSING_ROW: GapKeywordRow = {
  keyword: "photo booth templates",
  searchVolume: 1300,
  cpc: 1.24,
  competition: null,
  competitionLevel: "MEDIUM",
  keywordDifficulty: 34,
  intent: "commercial",
  target: { domain: TARGET, position: null, url: null, traffic: null },
  competitors: [
    {
      domain: "templatesbooth.com",
      position: 3,
      url: "https://templatesbooth.com/photo-booth",
      traffic: 210.4,
    },
    {
      domain: "hikelist.com",
      position: 11,
      url: "https://hikelist.com/booth",
      traffic: 12.9,
    },
  ],
  bestCompetitorTraffic: 210.4,
};

/** One rival absent — the per-competitor dash, not a zero. */
const PARTIAL_ROW: GapKeywordRow = {
  keyword: "brand pack",
  searchVolume: null,
  cpc: null,
  competition: null,
  competitionLevel: null,
  keywordDifficulty: null,
  intent: null,
  target: { domain: TARGET, position: null, url: null, traffic: null },
  competitors: [
    {
      domain: "templatesbooth.com",
      position: 7,
      url: "https://templatesbooth.com/brand",
      traffic: 41,
    },
    { domain: "hikelist.com", position: null, url: null, traffic: null },
  ],
  bestCompetitorTraffic: 41,
};

function gapResponse(mode: GapKeywordsResponse["mode"]): GapKeywordsResponse {
  return {
    target: TARGET,
    competitors: COMPETITORS,
    locationCode: 2826,
    languageCode: "en",
    mode,
    items: [MISSING_ROW, PARTIAL_ROW],
    totalCount: 128,
    itemsCount: 2,
    // Rows this page fetched and dropped: the paging subtlety, on screen as
    // "2 shown of 128 compared".
    filteredOut: 48,
    limit: 50,
    offset: 0,
    costUsd: 0.024_6,
    cached: false,
  };
}

/**
 * A page where the mode filter dropped everything — captured from the live API,
 * which really does answer `missing` against unrelated rivals with 0 of 20 rows
 * kept and 51 still to page through. The screen must not read as "no results".
 */
const ALL_FILTERED: GapKeywordsResponse = {
  ...gapResponse("weak"),
  items: [],
  itemsCount: 0,
  filteredOut: 20,
  totalCount: 51,
  limit: 20,
};

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["meta", "locations", WORKSPACE_ID], LOCATIONS);

  const key = (mode: string) => [
    "gap",
    "keywords",
    WORKSPACE_ID,
    TARGET,
    COMPETITORS.join(","),
    2826,
    "en",
    mode,
    {},
  ];

  for (const mode of ["missing", "all"] as const) {
    client.setQueryData(key(mode), {
      pages: [gapResponse(mode)],
      pageParams: [0],
    });
  }
  client.setQueryData(key("weak"), { pages: [ALL_FILTERED], pageParams: [0] });
  return client;
}

function render(url: string): string {
  return renderToString(
    <QueryClientProvider client={seededClient()}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route path="/app/gap-analysis/*" element={<GapAnalysisModule />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COMPARISON = `/app/gap-analysis?target=${TARGET}&competitors=${COMPETITORS.join(",")}&location=2826&language=en`;

describe("the module mounts", () => {
  it("invites a comparison when the URL carries none", () => {
    const html = render("/app/gap-analysis");
    expect(html).toContain("Compare yourself against up to four rivals");
    // Nothing to compare means no tabs and no queries to spend on.
    expect(html).not.toContain("Best rival traffic");
  });

  it("asks for a competitor before it will spend", () => {
    const html = render(`/app/gap-analysis?target=${TARGET}`);
    expect(html).toContain("Add a competitor");
    expect(html).toContain("A gap needs someone to be on the other side of it");
  });

  it("rejects a target that is not a domain without calling anything", () => {
    const html = render(
      "/app/gap-analysis?target=nonsense&competitors=hikelist.com",
    );
    expect(html).toContain("isn&#x27;t a domain");
  });
});

describe("the gap table", () => {
  const html = render(COMPARISON);

  it("renders the market, the mode and what it cost", () => {
    expect(html).toContain("United Kingdom · en");
    expect(html).toContain("Every competitor ranks for this keyword and you don&#x27;t.");
    expect(html).toContain("$0.02 live");
  });

  it("gives every requested competitor its own column", () => {
    expect(html).toContain("templatesbooth.com");
    expect(html).toContain("hikelist.com");
    expect(html).toContain("Best rival traffic");
  });

  /**
   * The assertion this module exists for: `position: null` is "does not rank",
   * and 0 would be the best possible rank — the exact inversion of the meaning.
   */
  it("renders an absent ranking as a dash, never as a zero", () => {
    expect(html).toContain("Does not rank for this keyword");
    expect(html).toContain("—");
    expect(html).not.toContain(">0<");
  });

  it("shows the rows with both row actions", () => {
    expect(html).toContain("photo booth templates");
    expect(html).toContain("View SERP");
    expect(html).toContain("Add photo booth templates to a collection");
    // Best-rival traffic, rounded from 210.4.
    expect(html).toContain("210");
  });

  it("counts the rows shown against everything compared", () => {
    expect(html).toContain("2 shown of 128 compared");
  });

  it("offers the server-side export with its row cap in the tooltip", () => {
    expect(html).toContain("/api/v1/gap/keywords/export.csv?");
    expect(html).toContain("up to 1,000 rows");
  });
});

describe("mode tabs", () => {
  it("names the price of the expensive one", () => {
    const html = render(`${COMPARISON}&mode=all`);
    expect(html).toContain("Every keyword any of these domains ranks for.");
    expect(html).toContain(
      "two DataForSEO queries per competitor instead of one — 4 upstream calls for 2 competitors here",
    );
  });

  it("offers all four views", () => {
    const html = render(COMPARISON);
    for (const label of ["Missing", "Weak", "Untapped", "All"]) {
      expect(html).toContain(`>${label}</button>`);
    }
  });
});

/**
 * Regression, from a live run: `missing` against unrelated rivals returned 0
 * rows, 20 filtered out and 51 still to come. Paging runs against the
 * *unfiltered* set, so the next page can hold matches — hiding the pager here
 * would strand the user on an empty table with results sitting behind it.
 */
describe("a page the mode filtered empty", () => {
  const html = render(`${COMPARISON}&mode=weak`);

  it("still offers the next page", () => {
    // The label is interpolated, so SSR splits it with comment markers; the
    // button's title is the stable thing to assert on.
    expect(html).toContain(
      "Fetches the next page from DataForSEO — one call per competitor.",
    );
  });

  it("explains the empty page rather than implying there is nothing", () => {
    expect(html).toContain(
      "20 of the 20 keywords fetched didn&#x27;t match Weak",
    );
    expect(html).toContain("the next page may hold more");
    expect(html).toContain("0 shown of 51 compared");
  });
});
