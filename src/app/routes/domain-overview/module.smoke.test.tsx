/**
 * Render smoke tests for the module.
 *
 * `tsc` proves the props line up; it cannot prove the tree mounts. This module
 * is the first consumer of the DataTable primitive (TanStack Table v9) and of
 * the chart wrappers, so a render-time failure — an invalid hook call, a
 * primitive used the way v8 wanted rather than v9 — would otherwise reach a
 * browser before it reached a test.
 *
 * `renderToString` is the whole harness: no jsdom, no testing-library, no new
 * dependency. TanStack Query does not fetch during a server render, which is
 * convenient rather than limiting — every query is seeded from the cache, so
 * these tests are hermetic and spend nothing.
 *
 * The fixtures mirror shapes captured from the live API, including the two
 * that are easy to get wrong: estimated traffic arrives as a float, and a
 * competitor carries both its own metrics and the *target's* metrics on the
 * keywords they share.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type {
  CompetitorRow,
  DomainKeywordsResponse,
  DomainOverviewResponse,
  PositionBuckets,
  RankMetrics,
} from "../../../shared/domains";
import type { HistoryListResponse } from "../../../shared/history";
import { HISTORY_DEFAULT_LIMIT } from "../../../shared/history";
import type { MetaLocationsResponse } from "../../../shared/keywords";
import type { Workspace } from "../../../shared/workspaces";
import { ToastProvider } from "../../components/ui/toast";
import { DomainOverviewModule } from "./module";

const WORKSPACE_ID = "ws-1";
const TARGET = "brandpacks.com";

const NO_POSITIONS: PositionBuckets = {
  pos1: 1,
  pos2to3: 2,
  pos4to10: 3,
  pos11to20: null,
  pos21to30: null,
  pos31to40: null,
  pos41to50: null,
  pos51to60: null,
  pos61to70: null,
  pos71to80: null,
  pos81to90: null,
  pos91to100: null,
};

function metrics(
  traffic: number | null,
  keywordCount: number | null,
  trafficValueUsd: number | null = null,
): RankMetrics {
  return {
    keywordCount,
    traffic,
    trafficValueUsd,
    positions: NO_POSITIONS,
    isNew: null,
    isUp: null,
    isDown: null,
    isLost: null,
  };
}

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

const OVERVIEW: DomainOverviewResponse = {
  domain: TARGET,
  locationCode: 2826,
  languageCode: "en",
  // Floats, as the live API sends them.
  organic: metrics(418.652_000_140_398_74, 484, 1186.141_964_152_222_5),
  paid: metrics(0, 0, 0),
  costUsd: 0.012_12,
  cached: false,
  fetchedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};

/**
 * The search trail. One entry with a full summary — which is the row worth
 * pinning, because the metrics on it are the whole reason the list beats
 * re-running the search.
 */
const HISTORY: HistoryListResponse = {
  items: [
    {
      id: "h-1",
      module: "domains",
      params: { target: "hikelist.com", location: 2826, language: "en" },
      summary: {
        domainScore: 41,
        organicTraffic: 12_400.6,
        organicKeywords: 3120,
      },
      hitCount: 2,
      firstSearchedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      lastSearchedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
  ],
  total: 1,
};

const KEYWORDS: DomainKeywordsResponse = {
  domain: TARGET,
  locationCode: 2826,
  languageCode: "en",
  paid: false,
  items: [
    {
      keyword: "brand pack",
      searchVolume: 210,
      cpc: 8.6,
      competition: null,
      competitionLevel: null,
      keywordDifficulty: 12,
      position: 2,
      positionAbsolute: 2,
      url: "https://brandpacks.com/",
      title: null,
      serpItemType: "organic",
      traffic: 34.020_000_457_763_67,
    },
    {
      // A row where everything optional is missing — the em-dash path.
      keyword: "what's on poster",
      searchVolume: null,
      cpc: null,
      competition: null,
      competitionLevel: null,
      keywordDifficulty: null,
      position: null,
      positionAbsolute: null,
      url: null,
      title: null,
      serpItemType: "organic",
      traffic: null,
    },
  ],
  totalCount: 484,
  itemsCount: 2,
  limit: 50,
  offset: 0,
  costUsd: 0.012_6,
  cached: false,
};

const COMPETITOR: CompetitorRow = {
  domain: "youtube.com",
  commonKeywords: 466,
  avgPosition: 18.98,
  // Their own totals: enormous.
  organic: metrics(433_383_516.8, 23_890_660),
  paid: metrics(null, null),
  // The target's numbers on the shared keywords: tiny. Mixing these up is the
  // failure this module is built to avoid.
  sharedOrganic: metrics(413.453, 466),
  sharedPaid: metrics(null, null),
};

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["meta", "locations", WORKSPACE_ID], LOCATIONS);
  client.setQueryData(
    ["history", "list", WORKSPACE_ID, "domains", HISTORY_DEFAULT_LIMIT],
    HISTORY,
  );
  client.setQueryData(
    ["domains", "overview", WORKSPACE_ID, TARGET, 2826, "en"],
    OVERVIEW,
  );
  client.setQueryData(
    ["domains", "keywords", WORKSPACE_ID, TARGET, 2826, "en", false, {}],
    { pages: [KEYWORDS], pageParams: [0] },
  );
  client.setQueryData(
    ["domains", "competitors", WORKSPACE_ID, TARGET, 2826, "en"],
    {
      pages: [
        {
          domain: TARGET,
          locationCode: 2826,
          languageCode: "en",
          items: [COMPETITOR],
          totalCount: 3820,
          itemsCount: 1,
          limit: 50,
          offset: 0,
          costUsd: 0.012_6,
          cached: false,
        },
      ],
      pageParams: [0],
    },
  );
  return client;
}

function render(url: string): string {
  return renderToString(
    <QueryClientProvider client={seededClient()}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route
              path="/app/domain-overview/*"
              element={<DomainOverviewModule />}
            />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the module mounts", () => {
  it("invites a search when the URL carries none", () => {
    const html = render("/app/domain-overview");
    expect(html).toContain("Analyze any domain");
    // No target means no queries and no tabs to spend on.
    expect(html).not.toContain("Top keywords");
  });

  it("rejects a target that is not a domain without calling anything", () => {
    const html = render("/app/domain-overview?target=nonsense");
    expect(html).toContain("isn&#x27;t a domain");
  });

  it("renders the dashboard for a searched domain", () => {
    const html = render(
      `/app/domain-overview?target=${TARGET}&location=2826&language=en`,
    );
    expect(html).toContain(TARGET);
    expect(html).toContain("United Kingdom · en");
    expect(html).toContain("Organic traffic (est.)");
    expect(html).toContain("Organic keywords");
    expect(html).toContain("Paid traffic (est.)");
    expect(html).toContain("Paid keywords");
    // 418.652 rounded and grouped, and the traffic value badge beside it.
    expect(html).toContain("419");
    expect(html).toContain("484");
    expect(html).toContain("$1,186/mo value");
    // Live cost, shown as spent.
    expect(html).toContain("$0.01 live");
  });
});

describe("Top keywords", () => {
  const html = render(
    `/app/domain-overview?target=${TARGET}&location=2826&language=en`,
  );

  it("shows the rows with a SERP action", () => {
    expect(html).toContain("brand pack");
    expect(html).toContain("View SERP");
    // The path, not the whole URL, with the URL kept as the title.
    expect(html).toContain('title="https://brandpacks.com/"');
  });

  it("renders an unreported value as an em dash, never a zero", () => {
    expect(html).toContain("—");
  });

  it("says out loud that the paid switch costs a call", () => {
    expect(html).toContain("separate DataForSEO queries");
  });

  it("counts what is loaded against the total", () => {
    expect(html).toContain("2 of 484 rows loaded");
  });
});

describe("Competitors", () => {
  const html = render(
    `/app/domain-overview?target=${TARGET}&location=2826&language=en&tab=competitors`,
  );

  /**
   * The whole point of the tab: 433,383,517 is YouTube's traffic and 413 is
   * brandpacks.com's traffic on the keywords they share. Both appear, and the
   * columns say which is which.
   */
  it("labels whose traffic is whose", () => {
    expect(html).toContain("Their traffic (est.)");
    expect(html).toContain("Your shared traffic (est.)");
    expect(html).toContain("433,383,517");
    expect(html).toContain("413");
    expect(html).toContain("Analyze");
  });
});

describe("Countries", () => {
  it("costs nothing until asked, and names the price", () => {
    const html = render(
      `/app/domain-overview?target=${TARGET}&location=2826&language=en&tab=countries`,
    );
    expect(html).toContain("Analyze countries · ≈ $0.10");
    expect(html).toContain("ten major markets");
  });
});

describe("the search trail", () => {
  it("lists past domains with their metrics on an empty screen", () => {
    const html = render("/app/domain-overview");
    expect(html).toContain("Recent domains");
    expect(html).toContain("hikelist.com");
    // The Domain Score badge, and the compact metrics beside it.
    expect(html).toContain("41");
    expect(html).toContain("12,401 traffic");
    expect(html).toContain("3,120 keywords");
    expect(html).toContain("2 hours ago");
  });

  it("says out loud that re-opening one is free", () => {
    const html = render("/app/domain-overview");
    expect(html).toContain("costs nothing");
    expect(html).toContain("Clear all");
    // Every row can be dropped on its own, not only as a whole list.
    expect(html).toContain("Remove hikelist.com from history");
  });

  it("folds itself away once a report is on screen", () => {
    const html = render(
      `/app/domain-overview?target=${TARGET}&location=2826&language=en`,
    );
    // The disclosure, not the card: the report is the content now.
    expect(html).toContain("<summary");
    expect(html).toContain("1 recent");
    expect(html).not.toContain("Searches this workspace has run");
  });
});

describe("freshness", () => {
  const html = render(
    `/app/domain-overview?target=${TARGET}&location=2826&language=en`,
  );

  it("says how old the figures are", () => {
    expect(html).toContain("Updated 3 days ago");
  });

  it("offers exactly one way to spend on a re-read", () => {
    expect(html).toContain("Refresh");
    expect(html).toContain("This spends credits.");
  });

  /** `stale` is unset on this fixture, so the warning must not appear. */
  it("does not cry stale over an ordinary result", () => {
    expect(html).not.toContain("may be outdated");
  });
});
