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

import type {
  GapKeywordRow,
  GapKeywordsResponse,
  GapPagesResponse,
} from "../../../shared/gap";
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

/** The compared URLs for the pages view — two rivals on the same subject. */
const PAGES = ["https://brandpacks.com/guide", "https://hikelist.com/guide"];

const PAGES_RESPONSE: GapPagesResponse = {
  pages: PAGES,
  locationCode: 2826,
  languageCode: "en",
  items: [
    {
      keyword: "photo booth guide",
      searchVolume: 480,
      cpc: 0.9,
      competition: null,
      competitionLevel: "LOW",
      keywordDifficulty: 21,
      intent: "informational",
      pages: [
        {
          domain: PAGES[0] as string,
          position: 4,
          url: PAGES[0] as string,
          traffic: 88,
        },
        // The second page does not rank for this keyword — a dash, not a zero.
        { domain: PAGES[1] as string, position: null, url: null, traffic: null },
      ],
    },
  ],
  totalCount: 37,
  itemsCount: 1,
  limit: 50,
  offset: 0,
  costUsd: 0.012,
  cached: false,
};

export function gapKeywordsKey(mode: string) {
  return [
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
}

function seededClient(
  overrides: Array<[readonly unknown[], unknown]> = [],
): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["meta", "locations", WORKSPACE_ID], LOCATIONS);

  for (const mode of ["missing", "all"] as const) {
    client.setQueryData(gapKeywordsKey(mode), {
      pages: [gapResponse(mode)],
      pageParams: [0],
    });
  }
  client.setQueryData(gapKeywordsKey("weak"), {
    pages: [ALL_FILTERED],
    pageParams: [0],
  });
  client.setQueryData(
    ["gap", "pages", WORKSPACE_ID, PAGES.join(","), 2826, "en"],
    { pages: [PAGES_RESPONSE], pageParams: [0] },
  );

  for (const [key, value] of overrides) client.setQueryData(key, value);
  return client;
}

function render(
  url: string,
  overrides: Array<[readonly unknown[], unknown]> = [],
): string {
  return renderToString(
    <QueryClientProvider client={seededClient(overrides)}>
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

/**
 * Retrofit: the Pages view.
 *
 * A different endpoint, a different input and a different table from the
 * keyword views — and crucially no mode, because `missing` and `weak` are
 * defined against a target and this comparison has no "you".
 */
describe("the pages view", () => {
  it("is offered alongside the keyword view", () => {
    const html = render(COMPARISON);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(">Pages</button>");
    expect(html).toContain(">Keywords</button>");
  });

  it("explains itself before it will spend", () => {
    const html = render("/app/gap-analysis?view=pages");
    expect(html).toContain("Compare pages, not domains");
    expect(html).toContain("this one has no “you”");
  });

  it("says the URLs are compared exactly, and how many fit", () => {
    const html = render("/app/gap-analysis?view=pages");
    expect(html).toContain("compared as exact pages");
    expect(html).toContain("up to 20");
  });

  describe("with a comparison", () => {
    const html = render(
      `/app/gap-analysis?view=pages&pages=${PAGES.join(",")}&location=2826&language=en`,
    );

    it("renders a column per compared page, in the order requested", () => {
      expect(html).toContain("Page 1");
      expect(html).toContain("Page 2");
      // Paths, not whole URLs — twenty absolute URLs across a header row is
      // unreadable — with the full address in a title.
      expect(html).toContain("/guide");
      expect(html).toContain('title="https://brandpacks.com/guide"');
    });

    it("renders the shared keywords with their metrics", () => {
      expect(html).toContain("photo booth guide");
      expect(html).toContain("480");
    });

    /** The same rule as the keyword table: absent is a dash, never a zero. */
    it("renders a page that does not rank as a dash", () => {
      expect(html).toContain("This page does not rank for this keyword");
    });

    it("prices the view honestly — one call for the whole set", () => {
      expect(html).toContain(
        "one DataForSEO call for the whole set, however many pages are in it",
      );
    });

    it("counts what is loaded against the total", () => {
      expect(html).toContain("1 shown of 37");
    });
  });
});

/**
 * Retrofit: the `missing` dead end.
 *
 * An empty `missing` is the most common one on this screen — it needs *every*
 * rival to rank. The fix is one tab away, and taking it is free: both modes
 * issue the identical upstream query (`upstreamQueriesForMode` in
 * src/worker/routes/gap.ts) and differ only in the row filter after it.
 */
describe("an empty Missing result", () => {
  const html = render(COMPARISON, [
    [
      gapKeywordsKey("missing"),
      {
        pages: [
          { ...gapResponse("missing"), items: [], itemsCount: 0, filteredOut: 0 },
        ],
        pageParams: [0],
      },
    ],
  ]);

  it("offers a one-click switch to the broader view", () => {
    expect(html).toContain("Show Untapped instead");
  });

  it("explains why Untapped is broader, and that switching is free", () => {
    expect(html).toContain("it only needs one of them to rank");
    expect(html).toContain("costs nothing");
  });

  it("does not offer the switch from the other modes", () => {
    expect(render(`${COMPARISON}&mode=weak`)).not.toContain(
      "Show Untapped instead",
    );
  });
});
