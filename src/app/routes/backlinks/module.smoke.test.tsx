/**
 * Render smoke tests for the module.
 *
 * `tsc` proves the props line up; it cannot prove the tree mounts. Same harness
 * as Domain Overview's: `renderToString`, no jsdom, no testing-library, no new
 * dependency. TanStack Query does not fetch during a server render, so every
 * query is seeded from the cache and these tests are hermetic and spend nothing.
 *
 * The fixtures mirror shapes captured from the live API against brandpacks.com,
 * including the three that are easy to get wrong: a dofollow block that cannot
 * be derived, a referring-domains `totalCount` that is *smaller* than the rows
 * returned, and a history series with a month missing from the middle.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type {
  AnchorsResponse,
  BacklinksHistoryResponse,
  BacklinksListResponse,
  BacklinksSummaryResponse,
  DofollowSplit,
  ReferringDomainsResponse,
} from "../../../shared/backlinks";
import type { Workspace } from "../../../shared/workspaces";
import { ToastProvider } from "../../components/ui/toast";
import { BacklinksModule } from "./module";

const WORKSPACE_ID = "ws-1";
const TARGET = "brandpacks.com";

const NO_SPLIT: DofollowSplit = {
  dofollowPages: null,
  nofollowPages: null,
  dofollowRatio: null,
};

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

const SUMMARY: BacklinksSummaryResponse = {
  target: TARGET,
  // Already 0–100 when it arrives. Nothing in the UI divides this.
  domainScore: 61,
  backlinks: 12_480,
  referringDomains: 843,
  referringMainDomains: 790,
  referringPages: 11_902,
  dofollow: { dofollowPages: 7_140, nofollowPages: 4_762, dofollowRatio: 0.6 },
  brokenBacklinks: 41,
  brokenPages: 12,
  crawledPages: 1_204,
  internalLinksCount: null,
  externalLinksCount: null,
  referringIps: 601,
  referringSubnets: 480,
  spamScore: 4,
  firstSeen: "2019-04-02 11-05-31 +00:00",
  lostDate: null,
  server: null,
  countryIsoCode: "GB",
  linkAttributes: { nofollow: 4_762 },
  linkTypes: { anchor: 11_000 },
  costUsd: 0.020_2,
  cached: false,
};

/** June, then a gap, then August — the missing-month case the chart must break. */
const HISTORY: BacklinksHistoryResponse = {
  target: TARGET,
  dateFrom: "2019-01-01",
  dateTo: "2026-08-28",
  items: [
    {
      period: "2026-06",
      date: "2026-06-01 00-00-00 +00:00",
      domainScore: 58,
      backlinks: 11_000,
      newBacklinks: 0,
      lostBacklinks: 0,
      referringDomains: 800,
      newReferringDomains: 0,
      lostReferringDomains: 0,
      referringMainDomains: 760,
      referringPages: 10_500,
      brokenBacklinks: 30,
      crawledPages: 1_100,
    },
    {
      period: "2026-08",
      date: "2026-08-01 00-00-00 +00:00",
      domainScore: 61,
      backlinks: 12_480,
      newBacklinks: 1_480,
      lostBacklinks: 0,
      referringDomains: 843,
      newReferringDomains: 43,
      lostReferringDomains: 0,
      referringMainDomains: 790,
      referringPages: 11_902,
      brokenBacklinks: 41,
      crawledPages: 1_204,
    },
  ],
  itemsCount: 2,
  costUsd: 0.010_1,
  cached: true,
};

const LIST: BacklinksListResponse = {
  target: TARGET,
  mode: "one_per_domain",
  items: [
    {
      domainFrom: "example.org",
      urlFrom: "https://example.org/blog/best-brand-kits",
      urlTo: "https://brandpacks.com/pricing",
      anchor: "brand packs",
      dofollow: true,
      isBroken: false,
      isNew: null,
      isLost: null,
      firstSeen: "2024-03-11 08-22-14 +00:00",
      lastSeen: "2026-08-01 00-00-00 +00:00",
      pageScore: 42,
      domainScore: 61,
      pageFromTitle: null,
      pageFromLanguage: "en",
      linksCount: 1,
      groupCount: 7,
      itemType: "anchor",
      spamScore: 3,
    },
    {
      // Everything the provider can leave out, left out.
      domainFrom: "quiet.example",
      urlFrom: null,
      urlTo: null,
      anchor: null,
      dofollow: null,
      isBroken: null,
      isNew: null,
      isLost: null,
      firstSeen: null,
      lastSeen: null,
      pageScore: null,
      domainScore: null,
      pageFromTitle: null,
      pageFromLanguage: null,
      linksCount: null,
      groupCount: null,
      itemType: null,
      spamScore: null,
    },
  ],
  totalCount: 843,
  itemsCount: 2,
  limit: 50,
  offset: 0,
  costUsd: 0.020_2,
  cached: false,
};

/**
 * Two rows against a total of 1: DataForSEO counts main domains in `totalCount`
 * and returns rows per subdomain. The UI must present this, not "fix" it.
 */
const REFERRING: ReferringDomainsResponse = {
  target: TARGET,
  items: [
    {
      domain: "blog.example.org",
      domainScore: 61,
      backlinks: 12,
      referringPages: 50,
      dofollow: { dofollowPages: 30, nofollowPages: 20, dofollowRatio: 0.6 },
      brokenBacklinks: 0,
      firstSeen: "2024-03-11 08-22-14 +00:00",
      lostDate: null,
      spamScore: 3,
    },
    {
      domain: "shop.example.org",
      domainScore: null,
      backlinks: 3,
      referringPages: 3,
      dofollow: NO_SPLIT,
      brokenBacklinks: null,
      firstSeen: null,
      lostDate: null,
      spamScore: null,
    },
  ],
  totalCount: 1,
  itemsCount: 2,
  limit: 50,
  offset: 0,
  costUsd: 0.020_2,
  cached: false,
};

const ANCHORS: AnchorsResponse = {
  target: TARGET,
  items: [
    {
      anchor: "brand packs",
      score: 40,
      backlinks: 120,
      referringDomains: 34,
      referringPages: 90,
      dofollow: { dofollowPages: 70, nofollowPages: 20, dofollowRatio: 0.777 },
      brokenBacklinks: 0,
      firstSeen: "2024-03-11 08-22-14 +00:00",
      lostDate: null,
    },
    {
      // Image links produce these, and they are not missing data. The live API
      // sends null here, not "" — for brandpacks.com it is the largest group.
      anchor: null,
      score: null,
      backlinks: 9,
      referringDomains: 4,
      referringPages: 9,
      dofollow: NO_SPLIT,
      brokenBacklinks: null,
      firstSeen: null,
      lostDate: null,
    },
  ],
  totalCount: 2,
  itemsCount: 2,
  limit: 50,
  offset: 0,
  costUsd: 0.020_2,
  cached: false,
};

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["backlinks", "summary", WORKSPACE_ID, TARGET], SUMMARY);
  client.setQueryData(["backlinks", "history", WORKSPACE_ID, TARGET], HISTORY);
  client.setQueryData(
    ["backlinks", "list", WORKSPACE_ID, TARGET, "one_per_domain", {}],
    { pages: [LIST], pageParams: [0] },
  );
  client.setQueryData(["backlinks", "referring", WORKSPACE_ID, TARGET], {
    pages: [REFERRING],
    pageParams: [0],
  });
  client.setQueryData(["backlinks", "anchors", WORKSPACE_ID, TARGET], {
    pages: [ANCHORS],
    pageParams: [0],
  });
  return client;
}

function render(url: string): string {
  return renderToString(
    <QueryClientProvider client={seededClient()}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route path="/app/backlinks/*" element={<BacklinksModule />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the module mounts", () => {
  it("invites a search when the URL carries none", () => {
    const html = render("/app/backlinks");
    expect(html).toContain("Analyze any link profile");
    // No target means no queries and no tabs to spend on.
    expect(html).not.toContain("Referring domains");
  });

  it("rejects a target that is neither domain nor URL without calling anything", () => {
    const html = render("/app/backlinks?target=nonsense");
    expect(html).toContain("isn&#x27;t a domain or URL");
  });

  it("offers no market selector — a link profile has none", () => {
    const html = render(`/app/backlinks?target=${TARGET}`);
    expect(html).not.toContain("Location");
    expect(html).not.toContain("Language");
  });
});

describe("the metric strip", () => {
  const html = render(`/app/backlinks?target=${TARGET}`);

  it("leads with Domain Score, on the 0–100 scale it arrived on", () => {
    expect(html).toContain("Domain Score");
    expect(html).toContain("61");
    expect(html).toContain("/ 100");
    expect(html).toContain("high authority");
  });

  it("shows backlinks, referring domains and the dofollow share", () => {
    expect(html).toContain("12,480");
    expect(html).toContain("843");
    expect(html).toContain("60%");
    // The main-domain count is smaller and labelled, not silently substituted.
    expect(html).toContain("790 main");
  });

  it("says the dofollow figure is derived", () => {
    expect(html).toContain("derived");
    expect(html).toContain("does not publish a dofollow count");
  });

  it("names the cost of each result set", () => {
    expect(html).toContain("$0.02 live");
    expect(html).toContain("cached");
  });

  it("offers the range picker", () => {
    expect(html).toContain("6 months");
    expect(html).toContain("All time");
  });

  /** Never the provider's 0–1000 scale, and never anyone else's trademark. */
  it("shows no raw rank and no trademarked metric name", () => {
    expect(html).not.toContain("610");
    expect(html).not.toMatch(/Domain Rating|Domain Authority|\bDR\b|\bUR\b/);
  });
});

describe("Backlinks tab", () => {
  const html = render(`/app/backlinks?target=${TARGET}`);

  it("shows the source, its scores, the anchor, the target path and follow state", () => {
    expect(html).toContain("example.org");
    expect(html).toContain("/blog/best-brand-kits");
    expect(html).toContain("brand packs");
    expect(html).toContain("/pricing");
    expect(html).toContain("Dofollow");
    expect(html).toContain("Mar 11, 2024");
  });

  it("renders an unreported value as an em dash, never a zero", () => {
    expect(html).toContain("—");
  });

  it("says out loud that the grouping switch costs a call", () => {
    expect(html).toContain("bills a call");
  });

  it("offers the three filters", () => {
    expect(html).toContain("Min Domain Score");
    expect(html).toContain("Anchor contains");
    expect(html).toContain("Dofollow links only");
  });

  it("counts what is loaded against the total", () => {
    expect(html).toContain("2 of 843 rows loaded");
  });

  it("drops the group column in the ungrouped mode", () => {
    const grouped = render(`/app/backlinks?target=${TARGET}`);
    expect(grouped).toContain("Links from domain");
    // Under as_is the provider returns group_count 0 for every row, so a
    // column of zeroes would read as a claim rather than as an absence.
    const raw = render(`/app/backlinks?target=${TARGET}&mode=as_is`);
    expect(raw).not.toContain("Links from domain");
    expect(raw).toContain("All backlinks");
  });
});

describe("Referring domains tab", () => {
  const html = render(`/app/backlinks?target=${TARGET}&tab=referring`);

  it("lists subdomains separately and scores each", () => {
    expect(html).toContain("blog.example.org");
    expect(html).toContain("shop.example.org");
    expect(html).toContain("Analyze");
  });

  /**
   * Two rows against a totalCount of 1. The count is presented as approximate
   * rather than corrected, because upstream it genuinely counts something else.
   */
  it("presents the documented count asymmetry instead of hiding it", () => {
    expect(html).toContain("2 of about 1 rows loaded");
    expect(html).toContain("Subdomains are listed separately");
  });
});

describe("Anchors tab", () => {
  const html = render(`/app/backlinks?target=${TARGET}&tab=anchors`);

  it("shows backlinks and referring domains per anchor", () => {
    expect(html).toContain("brand packs");
    expect(html).toContain("120");
    expect(html).toContain("34");
  });

  it("labels an absent anchor rather than implying missing data", () => {
    expect(html).toContain("(no anchor text)");
  });
});

describe("a page target", () => {
  it("keeps the path and says it is analyzing one page", () => {
    const html = render(
      `/app/backlinks?target=${encodeURIComponent(
        "https://brandpacks.com/pricing",
      )}`,
    );
    expect(html).toContain("https://brandpacks.com/pricing");
    expect(html).toContain("Single page");
  });
});
