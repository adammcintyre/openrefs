/**
 * Render smoke tests for the module.
 *
 * `tsc` proves the props line up; it cannot prove the tree mounts. This module
 * builds its table columns *conditionally* — the Page Score column exists only
 * when the response says page scores came back — which is exactly the kind of
 * thing that typechecks and then throws at render.
 *
 * `renderToString` is the whole harness: no jsdom, no testing-library, no new
 * dependency, matching the other modules' smoke tests. TanStack Query does not
 * fetch during a server render, so every query is seeded from the cache and
 * these tests are hermetic and spend nothing.
 *
 * The fixtures encode the two things this screen must never get wrong:
 * `pageScoresAvailable: false` must remove a column rather than fill it with
 * dashes, and a cached result must still say what the set cost to build.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type {
  ContentDiscoverResponse,
  ContentPageRow,
} from "../../../shared/content";
import type { MetaLocationsResponse } from "../../../shared/keywords";
import type { Workspace } from "../../../shared/workspaces";
import { ToastProvider } from "../../components/ui/toast";
import { ContentDiscoveryModule } from "./module";

const WORKSPACE_ID = "ws-1";
const TOPIC = "photo booth template";

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

/** A small site winning traffic — the row the whole module exists to surface. */
const WINNER: ContentPageRow = {
  url: "https://photoboothtemplates.com/blog/free-templates",
  domain: "photoboothtemplates.com",
  title: "Free photo booth templates",
  domainScore: 12,
  pageScore: null,
  estTraffic: 940,
  keywords: [
    { keyword: TOPIC, position: 3, volume: 1300 },
    { keyword: "photo booth strips template", position: 9, volume: 210 },
  ],
  totalVolume: 1510,
  bestPosition: 3,
  wordCount: null,
};

/**
 * Unknown authority and unknown traffic on the same row.
 *
 * Both nulls matter and they behave in opposite directions: this row survives a
 * `maxDomainScore` cap and is dropped by a `minTraffic` floor. It renders two
 * dashes, and neither may become a zero.
 */
const UNKNOWN: ContentPageRow = {
  url: "https://tinycraftblog.example/booths",
  domain: "tinycraftblog.example",
  title: null,
  domainScore: null,
  pageScore: null,
  estTraffic: null,
  keywords: [{ keyword: TOPIC, position: 17, volume: 1300 }],
  totalVolume: 1300,
  bestPosition: 17,
  wordCount: null,
};

function discoverResponse(
  patch: Partial<ContentDiscoverResponse> = {},
): ContentDiscoverResponse {
  return {
    topic: TOPIC,
    locationCode: 2826,
    languageCode: "en",
    expand: 5,
    keywordsSearched: [TOPIC, "photo booth strips template"],
    items: [WINNER, UNKNOWN],
    totalCount: 42,
    itemsCount: 2,
    filteredOut: 0,
    limit: 50,
    offset: 0,
    sort: "estTraffic",
    costs: {
      serpUsd: 0.024,
      serpCalls: 6,
      expansionUsd: 0.0126,
      scoresUsd: 0.02,
      trafficUsd: 0.0132,
      totalUsd: 0.0698,
    },
    pageScoresAvailable: false,
    costUsd: 0.0698,
    cached: false,
    ...patch,
  };
}

function discoverKey(overrides: {
  expand?: number;
  sort?: string;
  filters?: Record<string, unknown>;
}) {
  return [
    "content",
    "discover",
    WORKSPACE_ID,
    TOPIC,
    2826,
    "en",
    overrides.expand ?? 5,
    overrides.sort ?? "estTraffic",
    overrides.filters ?? {},
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
  client.setQueryData(discoverKey({}), {
    pages: [discoverResponse()],
    pageParams: [0],
  });
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
            <Route
              path="/app/content-discovery/*"
              element={<ContentDiscoveryModule />}
            />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SWEEP = `/app/content-discovery?topic=${encodeURIComponent(TOPIC)}&location=2826&language=en&expand=5`;

describe("the module mounts", () => {
  const html = render("/app/content-discovery");

  it("invites a topic when the URL carries none", () => {
    expect(html).toContain("Start with a topic");
    // Nothing searched means no table and nothing to spend on.
    expect(html).not.toContain("Domain Score</th>");
  });

  it("prices every expansion option in the select itself", () => {
    // The comparison has to be possible while the menu is open — that is the
    // only moment the price can change the decision.
    expect(html).toContain("Just this topic");
    expect(html).toContain("+5 related searches");
    expect(html).toContain("+10 related searches");
    // Three options, three figures, presented as floors.
    expect(html.match(/from \$/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe("the results table", () => {
  const html = render(SWEEP);

  it("renders the market and the rows", () => {
    expect(html).toContain("United Kingdom · en");
    expect(html).toContain("Free photo booth templates");
    expect(html).toContain("photoboothtemplates.com");
  });

  /*
   * The cost chip's whole point. `costs` travels even on a cached response, so
   * the chip reports what the set cost to *build* rather than what this request
   * cost — a bare "Cached" would tell a user nothing about where 42 pages came
   * from or what re-running the sweep would cost them.
   */
  it("says what the set cost to build", () => {
    expect(html).toContain("Built for $0.07");
  });

  it("names the searches the sweep was built from", () => {
    expect(html).toContain("Built from 2 searches");
    expect(html).toContain("photo booth strips template");
  });

  it("shows a page's ranking keywords behind a disclosure", () => {
    expect(html).toContain("2 ranking keywords for /blog/free-templates");
    // The evidence is in the markup, one interaction away.
    expect(html).toContain("#3 · 1.3K/mo");
  });

  it("offers the three row actions", () => {
    expect(html).toContain("Open https://photoboothtemplates.com/blog/free-templates in a new tab");
    expect(html).toContain(`View SERP for ${TOPIC}`);
    expect(html).toContain("Copy the URL of Free photo booth templates");
  });

  it("counts the rows loaded against everything matching", () => {
    expect(html).toContain("2 shown of 42 matching");
  });

  it("says there is nothing more to load on a short page", () => {
    expect(html).toContain("Everything loaded");
  });
});

/**
 * Paging a composed set is free — every page after the first comes out of the
 * Worker's cache rather than DataForSEO. A cost hint on this button would be a
 * lie, and a discouraging one.
 */
describe("paging a full page", () => {
  const html = render(SWEEP, [
    [
      discoverKey({}),
      {
        pages: [
          discoverResponse({
            // A full page is what makes another one available: `limit` rows
            // back means the set has not run out. `totalCount` has to be
            // consistent with that — paging stops at the end of the *filtered*
            // set, so 50 rows out of a total of 42 would (correctly) be the end.
            items: Array.from({ length: 50 }, (_, index) => ({
              ...WINNER,
              url: `https://photoboothtemplates.com/blog/${index}`,
            })),
            itemsCount: 50,
            totalCount: 420,
          }),
        ],
        pageParams: [0],
      },
    ],
  ]);

  it("offers the next page with no charge attached", () => {
    expect(html).toContain("no DataForSEO call, no charge");
    expect(html).not.toContain("Everything loaded");
  });
});

/**
 * `bulk_ranks` holds far fewer pages than domains, so a whole sweep coming back
 * with every page score null is normal. A column of dashes would read as a bug
 * in us rather than a gap in their index.
 */
describe("page scores", () => {
  it("hides the column entirely when the sweep produced none", () => {
    expect(render(SWEEP)).not.toContain("Page Score");
  });

  it("shows it, de-emphasised, when there is something to show", () => {
    const html = render(SWEEP, [
      [
        discoverKey({}),
        {
          pages: [
            discoverResponse({
              pageScoresAvailable: true,
              items: [{ ...WINNER, pageScore: 31 }],
            }),
          ],
          pageParams: [0],
        },
      ],
    ]);
    expect(html).toContain("Page Score");
    expect(html).toContain("Page Score 31 of 100 for this URL");
  });
});

describe("unknown values", () => {
  const html = render(SWEEP);

  /*
   * The asymmetry this module must not get wrong, and the reason both tooltips
   * exist: unknown authority is not high authority, but unmeasured traffic
   * cannot meet a floor.
   */
  it("explains that an unscored site is kept by a Domain Score cap", () => {
    expect(html).toContain(
      "Pages with no Domain Score are kept",
    );
  });

  it("explains that an unmeasured page is dropped by a traffic floor", () => {
    expect(html).toContain("Pages with no traffic estimate are dropped");
  });

  it("renders both unknowns as dashes rather than zeroes", () => {
    expect(html).toContain("—");
    expect(html).not.toContain(">0<");
  });
});

describe("the preset chip", () => {
  it("reads its numbers from the shared constant", () => {
    const html = render(SWEEP);
    expect(html).toContain("Low-competition winners");
    // Honest framing, as the shared constant's own doc comment asks for.
    expect(html).toContain("A starting point, not a verdict");
    expect(html).toContain("Domain Score at most 30");
    expect(html).toContain("at least 500 estimated visits");
    expect(html).toContain("There is no score below which ranking is easy");
  });
});

/**
 * The empty state the spec names: filters that removed everything must offer
 * the fix, and say that taking it costs nothing.
 */
describe("a filter that matched nothing", () => {
  const filtered = `${SWEEP}&maxDomainScore=5&minTraffic=9000`;
  const html = render(filtered, [
    [
      discoverKey({ filters: { maxDomainScore: 5, minTraffic: 9000 } }),
      {
        pages: [
          discoverResponse({
            items: [],
            itemsCount: 0,
            filteredOut: 42,
          }),
        ],
        pageParams: [0],
      },
    ],
  ]);

  it("suggests loosening the cap rather than implying there is nothing", () => {
    expect(html).toContain("No pages matched — loosen the Domain Score cap?");
    expect(html).toContain("42 pages were found for this topic");
  });

  it("says that widening costs nothing", () => {
    expect(html).toContain("costs nothing");
    expect(html).toContain("Clear filters");
  });

  it("reports how many the filters hid", () => {
    expect(html).toContain("hidden by your filters");
  });
});

describe("the stale-if-error chip", () => {
  it("stays silent on a normal result", () => {
    expect(render(SWEEP)).not.toContain("may be outdated");
  });

  it("warns when the Worker served a stale copy", () => {
    const html = render(SWEEP, [
      [
        discoverKey({}),
        {
          pages: [discoverResponse({ stale: true, cached: true, costUsd: 0 })],
          pageParams: [0],
        },
      ],
    ]);
    expect(html).toContain("cached · may be outdated");
    // The build cost still travels on a cached response.
    expect(html).toContain("Built for $0.07");
    expect(html).toContain("Cached");
  });
});

describe("the word count column", () => {
  const html = render(SWEEP);

  it("exists before anything has been counted", () => {
    expect(html).toContain("Words");
    expect(html).toContain("Not counted yet");
  });

  it("says counting is per-URL and paid", () => {
    expect(html).toContain("Each URL is a separate paid fetch of the page");
  });
});
