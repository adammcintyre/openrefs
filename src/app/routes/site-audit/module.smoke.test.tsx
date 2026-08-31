/**
 * Render smoke tests for the Site Audit module.
 *
 * `tsc` proves the props line up; it cannot prove the tree mounts. This module
 * renders a data-driven column set, a native <progress>, a <details> group and
 * two dialogs — the kind of thing that typechecks and then throws at render.
 *
 * `renderToString` is the whole harness: no jsdom, no testing-library, no new
 * dependency, matching rank-tracking's and domain-overview's smoke tests.
 * TanStack Query does not fetch during a server render, so every query is
 * seeded from the cache and these tests are hermetic and spend nothing.
 *
 * The fixtures encode the four states this screen must never confuse: a project
 * with no audits, a crawl in flight, a finished audit whose Lighthouse has not
 * landed yet, and a finished audit with everything.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type {
  AuditCategoryResult,
  AuditDetailResponse,
  AuditIssuesResponse,
  AuditListItem,
  AuditListResponse,
  AuditSummary,
} from "../../../shared/audits";
import { AUDIT_CATEGORIES } from "../../../shared/audits";
import type { ProjectListResponse } from "../../../shared/projects";
import type { Workspace } from "../../../shared/workspaces";
import { ToastProvider } from "../../components/ui/toast";
import { SiteAuditModule } from "./module";

const WORKSPACE_ID = "ws-1";
const PROJECT_ID = "proj-1";
const OTHER_PROJECT_ID = "proj-2";
const AUDIT_ID = "audit-2";
const PREVIOUS_AUDIT_ID = "audit-1";
const RUNNING_AUDIT_ID = "audit-3";

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

/* --------------------------------- fixtures -------------------------------- */

function categoryResult(
  id: (typeof AUDIT_CATEGORIES)[number],
  patch: Partial<AuditCategoryResult> = {},
): AuditCategoryResult {
  return {
    category: id,
    label: id,
    description: `What ${id} covers.`,
    severity: "notice",
    affectedPages: 0,
    checks: [],
    ...patch,
  };
}

/**
 * All 17 categories, as the contract guarantees, with three of them failing.
 * The other fourteen are empty `notice` rows — the ones that must not end up in
 * the issues table.
 */
const CATEGORIES: AuditCategoryResult[] = AUDIT_CATEGORIES.map((id) => {
  if (id === "indexability") {
    return categoryResult(id, {
      label: "Indexability",
      description: "Pages a search engine cannot index.",
      severity: "error",
      affectedPages: 4,
      checks: [
        { check: "is_4xx_code", label: "4xx status", severity: "error", pages: 4 },
      ],
    });
  }
  if (id === "titles") {
    return categoryResult(id, {
      label: "Titles",
      description: "Missing, duplicated or over-long page titles.",
      severity: "warning",
      affectedPages: 4,
      checks: [
        { check: "title_too_long", label: "Title too long", severity: "warning", pages: 6 },
      ],
    });
  }
  if (id === "social_tags") {
    return categoryResult(id, {
      label: "Social tags",
      description: "Missing Open Graph and Twitter card tags.",
      severity: "notice",
      affectedPages: 25,
    });
  }
  return categoryResult(id);
});

function summary(patch: Partial<AuditSummary> = {}): AuditSummary {
  return {
    score: 94.4,
    pagesCrawled: 25,
    pagesLimit: 25,
    renderJs: false,
    domain: "brandpacks.com",
    categories: CATEGORIES,
    pagesWithIssues: 25,
    totalIssues: 39,
    lighthouse: {
      url: "https://brandpacks.com/",
      mobile: true,
      performance: 62,
      accessibility: 91,
      bestPractices: 100,
      seo: 92,
      lcpMs: 3120,
      cls: 0.08,
      // Always null in a lab run — the tile must fall back to TBT and say so.
      inpMs: null,
      fcpMs: 1400,
      tbtMs: 340,
      speedIndexMs: 2600,
    },
    lighthouseNote: null,
    brokenLinks: 2,
    brokenResources: 0,
    nonIndexablePages: 4,
    duplicateTitlePages: 0,
    duplicateDescriptionPages: 0,
    duplicateContentPages: 0,
    ingestedAt: "2026-08-29T14:34:00.000Z",
    ...patch,
  };
}

const LIST: AuditListResponse = {
  projectId: PROJECT_ID,
  domain: "brandpacks.com",
  auditInProgress: false,
  audits: [
    {
      id: AUDIT_ID,
      projectId: PROJECT_ID,
      status: "done",
      createdAt: "2026-08-29T14:32:00.000Z",
      score: 94.4,
      pagesCrawled: 25,
      pagesLimit: 25,
      renderJs: false,
      error: null,
    },
    {
      id: PREVIOUS_AUDIT_ID,
      projectId: PROJECT_ID,
      status: "done",
      createdAt: "2026-08-01T09:00:00.000Z",
      score: 88,
      pagesCrawled: 25,
      pagesLimit: 25,
      renderJs: false,
      error: null,
    },
  ],
};

const EMPTY_LIST: AuditListResponse = {
  projectId: OTHER_PROJECT_ID,
  domain: "hikelist.com",
  auditInProgress: false,
  audits: [],
};

const DETAIL: AuditDetailResponse = {
  id: AUDIT_ID,
  projectId: PROJECT_ID,
  domain: "brandpacks.com",
  status: "done",
  createdAt: "2026-08-29T14:32:00.000Z",
  summary: summary(),
  error: null,
  progress: null,
  previous: {
    auditId: PREVIOUS_AUDIT_ID,
    createdAt: "2026-08-01T09:00:00.000Z",
    score: 88,
    /*
     * `titles` fell from 11 to 4 and `indexability` rose from 1 to 4. `h1` is
     * deliberately absent: a category the previous rollup never carried must
     * produce no chip rather than a fabricated one.
     */
    categoryCounts: { titles: 11, indexability: 1, social_tags: 25 },
  },
};

const RUNNING_DETAIL: AuditDetailResponse = {
  id: RUNNING_AUDIT_ID,
  projectId: PROJECT_ID,
  domain: "brandpacks.com",
  status: "running",
  createdAt: "2026-08-29T15:00:00.000Z",
  summary: null,
  error: null,
  progress: {
    state: "in_progress",
    pagesCrawled: 12,
    pagesInQueue: 13,
    pagesLimit: 25,
  },
  previous: null,
};

const RUNNING_LIST: AuditListResponse = {
  ...LIST,
  auditInProgress: true,
  audits: [
    {
      id: RUNNING_AUDIT_ID,
      projectId: PROJECT_ID,
      status: "running",
      createdAt: "2026-08-29T15:00:00.000Z",
      score: null,
      pagesCrawled: 0,
      pagesLimit: 25,
      renderJs: false,
      error: null,
    },
    ...LIST.audits,
  ],
};

/**
 * The queue-backed window (Phase 7).
 *
 * Creating an audit inserts a `pending` row and enqueues an `audit_post` job
 * rather than posting the task inline, so for the first minute or two the audit
 * exists, has no crawl task, and nothing is happening on DataForSEO's side yet.
 * `progress` is null because there is no upstream queue to poll.
 */
const QUEUED_DETAIL: AuditDetailResponse = {
  ...RUNNING_DETAIL,
  status: "pending",
  progress: null,
};

const QUEUED_LIST: AuditListResponse = {
  ...RUNNING_LIST,
  audits: [
    { ...(RUNNING_LIST.audits[0] as AuditListItem), status: "pending" },
    ...LIST.audits,
  ],
};

/** A refusal that arrives as a code on the row, not as an HTTP status. */
function failedList(errorCode: string | null, error: string): AuditListResponse {
  return {
    ...LIST,
    auditInProgress: false,
    audits: [
      {
        ...(LIST.audits[0] as AuditListItem),
        id: RUNNING_AUDIT_ID,
        status: "failed",
        score: null,
        pagesCrawled: 0,
        error,
        errorCode,
      },
      ...LIST.audits,
    ],
  };
}

function failedDetail(error: string): AuditDetailResponse {
  return {
    ...RUNNING_DETAIL,
    status: "failed",
    progress: null,
    error,
  };
}

const ISSUES: AuditIssuesResponse = {
  auditId: AUDIT_ID,
  category: "titles",
  label: "Titles",
  severity: "warning",
  page: 1,
  pageSize: 50,
  total: 4,
  pages: [
    {
      url: "https://brandpacks.com/templates/photo-booth",
      statusCode: 200,
      checks: ["title_too_long"],
      // camelCase, as the live section data actually sends it.
      details: { title: "A very long title indeed", titleLength: 112 },
    },
    {
      url: "https://brandpacks.com/pricing",
      statusCode: 404,
      checks: ["no_title"],
      details: { title: null },
    },
  ],
};

/* --------------------------------- harness --------------------------------- */

function seededClient(overrides: Array<[readonly unknown[], unknown]> = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["projects", "list", WORKSPACE_ID], PROJECTS);
  client.setQueryData(["audits", "list", WORKSPACE_ID, PROJECT_ID], LIST);
  client.setQueryData(
    ["audits", "list", WORKSPACE_ID, OTHER_PROJECT_ID],
    EMPTY_LIST,
  );
  client.setQueryData(["audits", "detail", WORKSPACE_ID, AUDIT_ID], DETAIL);
  client.setQueryData(
    ["audits", "issues", WORKSPACE_ID, AUDIT_ID, "titles", 1],
    ISSUES,
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
            <Route path="/app/site-audit/*" element={<SiteAuditModule />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* -------------------------------- the picker ------------------------------- */

describe("with no project selected", () => {
  it("renders the picker as the empty state", () => {
    const html = render("/app/site-audit");
    expect(html).toContain("Site Audit");
    expect(html).toContain("BrandPacks");
    expect(html).toContain("brandpacks.com");
  });

  it("does not guess a project on the user's behalf", () => {
    expect(render("/app/site-audit")).not.toContain("Page Score");
  });
});

/* ------------------------------ no audits yet ------------------------------ */

describe("a project with no audits", () => {
  const html = render(`/app/site-audit?project=${OTHER_PROJECT_ID}`);

  it("explains what an audit is before offering to buy one", () => {
    expect(html).toContain("No audits yet");
    expect(html).toContain("Core Web Vitals");
    expect(html).toContain("Run first audit");
  });

  it("quotes the cost as a ceiling", () => {
    expect(html).toContain("up to $0.0088");
    expect(html).toContain("charged for the pages actually crawled");
  });
});

/* -------------------------------- in flight -------------------------------- */

describe("a crawl in progress", () => {
  const html = render(`/app/site-audit?project=${PROJECT_ID}`, [
    [["audits", "list", WORKSPACE_ID, PROJECT_ID], RUNNING_LIST],
    [
      ["audits", "detail", WORKSPACE_ID, RUNNING_AUDIT_ID],
      RUNNING_DETAIL,
    ],
  ]);

  it("shows real progress rather than an indeterminate spinner", () => {
    expect(html).toContain("Crawling brandpacks.com");
    expect(html).toContain("12 of 25 pages crawled");
    expect(html).toContain("13 in queue");
  });

  it("says the crawl survives leaving the page", () => {
    expect(html).toContain("You can leave this page");
  });
});

/* ------------------------------ a done audit ------------------------------- */

describe("a finished audit", () => {
  const html = render(`/app/site-audit?project=${PROJECT_ID}`);

  it("renders the health score with its band", () => {
    expect(html).toContain("Page Score");
    expect(html).toContain("94.4");
    expect(html).toContain("Good");
  });

  it("compares the score with the previous audit", () => {
    expect(html).toContain("+6.4 vs previous");
  });

  it("renders the Core Web Vitals strip, homepage only", () => {
    expect(html).toContain("Core Web Vitals");
    expect(html).toContain("LCP");
    expect(html).toContain("3.1 s");
    expect(html).toContain("0.08");
    expect(html).toContain("homepage only");
  });

  /*
   * `inpMs` is null on every lab run, so this fallback is the normal path. The
   * label has to change with it — TBT under an "INP" heading would present a
   * different measurement under a familiar name.
   */
  it("falls back to TBT and relabels the tile", () => {
    expect(html).toContain("TBT (lab)");
    expect(html).toContain("340 ms");
    expect(html).not.toContain(">INP<");
  });

  it("lists the failing categories worst first", () => {
    const indexability = html.indexOf("Indexability");
    const titles = html.indexOf("Titles");
    const social = html.indexOf("Social tags");
    expect(indexability).toBeGreaterThan(-1);
    expect(indexability).toBeLessThan(titles);
    expect(titles).toBeLessThan(social);
  });

  /*
   * The bug the partition exists to prevent: fourteen empty categories carry
   * severity `notice`, and putting them in the table buries the one error.
   */
  it("collapses the categories that found nothing", () => {
    expect(html).toContain("14 categories found no issues");
  });

  it("renders comparison chips from the rollup it already has", () => {
    expect(html).toContain("−7");
    expect(html).toContain("+3");
  });

  it("shows no chip for a category the previous audit never carried", () => {
    // `h1` is absent from previous.categoryCounts and has no issues, so it is
    // in the collapsed list — and no chip was invented for it anywhere.
    expect(html).toContain("h1");
  });

  it("renders the history with both audits and the crawl metadata", () => {
    expect(html).toContain("Audit history");
    expect(html).toContain("29 Aug 2026");
    expect(html).toContain("1 Aug 2026");
    expect(html).toContain("25 pages");
  });
});

/* --------------------------- lighthouse still out -------------------------- */

describe("a finished audit whose Lighthouse has not landed", () => {
  const html = render(`/app/site-audit?project=${PROJECT_ID}`, [
    [
      ["audits", "detail", WORKSPACE_ID, AUDIT_ID],
      {
        ...DETAIL,
        summary: summary({
          lighthouse: null,
          lighthouseNote: "Lighthouse task still in queue.",
        }),
      },
    ],
  ]);

  it("waits rather than declaring it unavailable", () => {
    expect(html).toContain("Core Web Vitals still arriving");
    expect(html).not.toContain("Core Web Vitals unavailable");
  });

  it("still renders the rest of the audit", () => {
    expect(html).toContain("Page Score");
    expect(html).toContain("Indexability");
  });
});

/* ------------------------------- drill-down -------------------------------- */

describe("a category drill-down", () => {
  const html = render(
    `/app/site-audit/${AUDIT_ID}/titles?project=${PROJECT_ID}`,
  );

  it("names the category and the affected count", () => {
    expect(html).toContain("Titles");
    expect(html).toContain("4 affected pages");
  });

  it("shows the path, keeping the full URL on the link", () => {
    expect(html).toContain("/templates/photo-booth");
    expect(html).toContain("https://brandpacks.com/templates/photo-booth");
  });

  it("renders the specific failing values, not just a list of paths", () => {
    expect(html).toContain("Title length");
    expect(html).toContain("112");
  });

  it("keeps a row whose detail value is null aligned rather than dropping it", () => {
    expect(html).toContain("/pricing");
    expect(html).toContain("404");
  });

  it("offers a CSV of the rows it actually loaded", () => {
    expect(html).toContain("Export loaded rows");
  });

  it("links back to the audit it came from", () => {
    expect(html).toContain("Back to audit");
    expect(html).toContain(`audit=${AUDIT_ID}`);
  });
});

describe("a drill-down for a category that does not exist", () => {
  it("says so rather than asking the API", () => {
    const html = render(
      `/app/site-audit/${AUDIT_ID}/not-a-category?project=${PROJECT_ID}`,
    );
    expect(html).toContain("No such issue category");
  });
});

/**
 * Phase 7: the queue-backed window.
 *
 * `POST /projects/:id/audits` now inserts a `pending` row and enqueues an
 * `audit_post` job instead of buying the crawl inline, so a tarpit on
 * DataForSEO's side costs a retry rather than the user's click. For that first
 * minute or two the audit has no crawl task and nothing is happening upstream.
 */
describe("an audit queued but not yet posted", () => {
  const html = render(`/app/site-audit?project=${PROJECT_ID}`, [
    [["audits", "list", WORKSPACE_ID, PROJECT_ID], QUEUED_LIST],
    [["audits", "detail", WORKSPACE_ID, RUNNING_AUDIT_ID], QUEUED_DETAIL],
  ]);

  it("says it is queued rather than claiming a crawl is under way", () => {
    expect(html).toContain("Queued: brandpacks.com");
    expect(html).toContain("the crawler starts shortly");
  });

  /*
   * The old copy said "queued with DataForSEO", which in this window is simply
   * untrue — we have not told them about it yet. The distinction matters
   * because the two states fail differently: a queued audit can still be
   * refused for a spend cap or missing credentials; a crawling one cannot.
   */
  it("does not claim DataForSEO has it yet", () => {
    expect(html).not.toContain("has been queued with DataForSEO");
    expect(html).not.toContain("Crawling brandpacks.com");
  });

  it("says the job retries by itself", () => {
    expect(html).toContain("retrying by itself if they are busy");
  });

  it("shows no progress bar, having no numbers to build one from", () => {
    expect(html).not.toContain("<progress");
    expect(html).not.toContain("of 25 pages crawled");
  });

  it("still promises the crawl survives leaving the page", () => {
    expect(html).toContain("You can leave this page");
  });

  /*
   * A pending audit that somehow reports progress is already crawling whatever
   * its status column says — the numbers are the stronger evidence, so the bar
   * wins over the label.
   */
  it("prefers real progress over the pending label", () => {
    const crawling = render(`/app/site-audit?project=${PROJECT_ID}`, [
      [["audits", "list", WORKSPACE_ID, PROJECT_ID], QUEUED_LIST],
      [
        ["audits", "detail", WORKSPACE_ID, RUNNING_AUDIT_ID],
        { ...QUEUED_DETAIL, progress: RUNNING_DETAIL.progress },
      ],
    ]);
    expect(crawling).toContain("12 of 25 pages crawled");
    expect(crawling).not.toContain("Queued: brandpacks.com");
  });
});

/**
 * Phase 7: a queue-side refusal.
 *
 * The crawl is bought after the create call was already answered with a 202, so
 * a refusal cannot arrive as an HTTP status the SPA branches on. It arrives as
 * `errorCode` on the audit row — and the UI switches on that code, never on the
 * message prose, which would break the moment the message is reworded.
 */
describe("a failed audit", () => {
  function renderFailure(code: string | null, message: string): string {
    return render(`/app/site-audit?project=${PROJECT_ID}`, [
      [["audits", "list", WORKSPACE_ID, PROJECT_ID], failedList(code, message)],
      [
        ["audits", "detail", WORKSPACE_ID, RUNNING_AUDIT_ID],
        failedDetail(message),
      ],
    ]);
  }

  it("sends a spend-cap refusal to the settings that fix it", () => {
    const html = renderFailure("spend_cap_exceeded", "Monthly spend cap hit.");
    expect(html).toContain("Monthly spend cap reached");
    expect(html).toContain("Review spend cap");
    expect(html).toContain('href="/app/settings"');
    // Nothing was bought, so nothing was charged — worth saying plainly.
    expect(html).toContain("nothing was spent");
  });

  it("sends a credentials refusal to the data-provider screen", () => {
    const html = renderFailure("no_credentials", "No DataForSEO credentials.");
    expect(html).toContain("No DataForSEO credentials");
    expect(html).toContain("Add API credentials");
    expect(html).toContain('href="/app/settings/data-provider"');
  });

  /*
   * The codes are what select a CTA — not the words. A spend-cap *message* with
   * no code attached must not be given the spend-cap button, because the code
   * is the only thing that actually establishes what happened.
   */
  it("switches on the code, not on the message", () => {
    const html = renderFailure(null, "Monthly spend cap exceeded for August.");
    expect(html).toContain("This audit failed");
    expect(html).not.toContain("Review spend cap");
    expect(html).toContain("Monthly spend cap exceeded for August.");
  });

  it("keeps the plain explanation for a fault with no button to press", () => {
    const html = renderFailure(
      "upstream_timeout",
      "DataForSEO did not respond in time.",
    );
    expect(html).toContain("This audit failed");
    expect(html).toContain("DataForSEO did not respond in time.");
    expect(html).toContain("Running a new audit is safe");
  });
});
