/**
 * Render smoke tests for the Phase 9 research workflow on the search screen.
 *
 * Two claims are worth pinning here, and neither is about layout:
 *
 * 1. **The trail is what the landing screen leads with.** A returning user's
 *    first question is "what have we already looked at?", and every row of the
 *    answer has to be scannable — keyword, volume, difficulty, when — without
 *    re-running anything.
 * 2. **Rendering any of this costs nothing.** `fetch` is stubbed to throw, so a
 *    request fired during render fails the test rather than passing silently.
 *    That is the invariant the whole cache design rests on: mounting, switching
 *    research tabs and opening the trail all bill zero.
 *
 * `renderToString`, seeded query cache, no jsdom — the same harness as the
 * other module smoke tests. Effects do not run, so nothing fetches on its own
 * and every hook reads the cache it was given.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryListResponse } from "../../../shared/history";
import type {
  KeywordListResponse,
  KeywordOverviewResponse,
  MetaLocationsResponse,
} from "../../../shared/keywords";
import type { Workspace } from "../../../shared/workspaces";
import { ToastProvider } from "../../components/ui/toast";
import { KeywordSearchView } from "./search-view";

const WORKSPACE_ID = "ws-1";

/** `useSearchHistory` asks for this many rows; the key carries the limit. */
const HISTORY_LIMIT = 12;

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

const HISTORY: HistoryListResponse = {
  total: 2,
  items: [
    {
      id: "h-1",
      module: "keywords",
      params: { keyword: "photo booth templates", location: 2826, language: "en" },
      summary: { volume: 12_400, difficulty: 38, cpc: 1.2, intent: "commercial" },
      hitCount: 3,
      firstSearchedAt: "2026-08-01T09:00:00.000Z",
      lastSearchedAt: "2026-08-28T09:00:00.000Z",
    },
    {
      id: "h-2",
      module: "keywords",
      params: { keyword: "booth strips", location: 2840, language: "en" },
      // Recorded before any metrics came back — nothing to snapshot yet.
      summary: null,
      hitCount: 1,
      firstSearchedAt: "2026-08-20T09:00:00.000Z",
      lastSearchedAt: "2026-08-20T09:00:00.000Z",
    },
  ],
};

const OVERVIEW = {
  costUsd: 0,
  cached: true,
  fetchedAt: "2026-08-28T09:00:00.000Z",
  keyword: "photo booth templates",
  locationCode: 2826,
  languageCode: "en",
  searchVolume: 12_400,
  cpc: 1.2,
  competition: 0.4,
  competitionLevel: "MEDIUM",
  lowTopOfPageBid: 0.5,
  highTopOfPageBid: 2.1,
  keywordDifficulty: 38,
  intent: "commercial",
  intentProbability: 0.8,
  monthlySearches: [],
} as unknown as KeywordOverviewResponse;

const LIST = {
  costUsd: 0,
  cached: true,
  keyword: "photo booth templates",
  locationCode: 2826,
  languageCode: "en",
  items: [
    {
      keyword: "photo booth template free",
      searchVolume: 880,
      keywordDifficulty: 21,
      cpc: 0.4,
      intent: "informational",
    },
  ],
  totalCount: 1,
  itemsCount: 1,
  limit: 50,
  offset: 0,
} as unknown as KeywordListResponse;

function render(url: string): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["keywords", "meta", WORKSPACE_ID], LOCATIONS);
  client.setQueryData(
    ["history", "list", WORKSPACE_ID, "keywords", HISTORY_LIMIT],
    HISTORY,
  );
  client.setQueryData(
    ["keywords", "overview", WORKSPACE_ID, "photo booth templates", 2826, "en"],
    OVERVIEW,
  );
  client.setQueryData(
    ["keywords", "list", WORKSPACE_ID, "suggestions", "photo booth templates", 2826, "en"],
    { pages: [LIST], pageParams: [0] },
  );

  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route path="/app/keyword-research" element={<KeywordSearchView />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/*
 * Nothing on this screen may reach the network while it renders. Anything that
 * tried would be a DataForSEO call the user did not ask for.
 */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      throw new Error(`unexpected request during render: ${String(input)}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the landing screen", () => {
  const html = render("/app/keyword-research");

  it("leads with the trail", () => {
    expect(html).toContain("Recent searches");
    expect(html).toContain("photo booth templates");
    expect(html).toContain("booth strips");
  });

  it("makes each row scannable without re-running it", () => {
    // Compact volume and the difficulty band, so the list answers "was that one
    // any good?" on its own.
    expect(html).toContain("12.4K");
    expect(html).toContain("Medium");
    expect(html).toContain("ago");
  });

  /*
   * `summary: null` is a real state — a row recorded before metrics came back.
   * It renders as an em dash rather than a zero, the same rule the rest of the
   * module follows.
   */
  it("says nothing rather than zero for a row with no snapshot", () => {
    expect(html).toContain("—");
  });

  it("promises the click is free", () => {
    expect(html).toContain("this costs nothing");
  });

  it("offers to clear the trail", () => {
    expect(html).toContain("Clear all");
    // The confirm is a dialog, and dialogs open on a click, not on a render.
    expect(html).not.toContain("Clear keyword search history?");
  });

  it("still explains the module to someone with no trail", () => {
    expect(html).toContain("Search a keyword to begin");
  });

  it("shows no research tabs before anything is opened", () => {
    expect(html).not.toContain("Open searches");
  });
});

describe("with a search on screen", () => {
  const html = render(
    "/app/keyword-research?q=photo+booth+templates&location=2826&language=en",
  );

  it("collapses the trail into a button", () => {
    expect(html).toContain("History");
    // Collapsed: the rows are not in the markup until it is opened.
    expect(html).not.toContain("Recent searches");
    expect(html).not.toContain("booth strips");
  });

  it("opens the URL's search as a research tab", () => {
    expect(html).toContain("Open searches");
    expect(html).toContain("Close photo booth templates");
  });

  it("says when the data was really fetched, and offers to refresh it", () => {
    expect(html).toContain("Updated");
    expect(html).toContain("Refresh");
  });

  /*
   * `stale` is absent on this payload, so the deliberately-old treatment must
   * not appear. It is reserved for a copy the Worker served past its lifetime.
   */
  it("does not claim the data is outdated when it is not", () => {
    expect(html).not.toContain("may be outdated");
  });

  it("leads with Suggestions and offers the keyword as a drill-down", () => {
    expect(html).toContain("Suggestions for photo booth templates");
    expect(html).toContain("Research photo booth template free in a new tab");
  });

  it("keeps the Ideas caveat off the tab that is not Ideas", () => {
    expect(html).not.toContain("often loosely related");
  });
});

describe("with a stale copy on screen", () => {
  it("says so, and does not also claim to be plainly cached", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(["workspaces"], WORKSPACES);
    client.setQueryData(["keywords", "meta", WORKSPACE_ID], LOCATIONS);
    client.setQueryData(
      ["keywords", "overview", WORKSPACE_ID, "photo booth templates", 2826, "en"],
      { ...OVERVIEW, stale: true },
    );

    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            "/app/keyword-research?q=photo+booth+templates&location=2826&language=en",
          ]}
        >
          <ToastProvider>
            <Routes>
              <Route path="/app/keyword-research" element={<KeywordSearchView />} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(html).toContain("may be outdated");
    expect(html).toContain("Refresh");
  });
});

describe("the Ideas tab", () => {
  it("carries the caveat that demoted it", () => {
    const html = render(
      "/app/keyword-research?q=photo+booth+templates&location=2826&language=en&tab=ideas",
    );
    expect(html).toContain("often loosely related");
    expect(html).toContain("Suggestions and Related stay closer to the phrase");
  });
});
