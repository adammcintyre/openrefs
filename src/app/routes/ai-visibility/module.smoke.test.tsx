/**
 * Render smoke tests for the module.
 *
 * `tsc` proves the props line up; it cannot prove the tree mounts. This module
 * renders two context-fed tables, a lazy chart and three dialogs — exactly the
 * kind of thing that typechecks and then throws at render.
 *
 * `renderToString` is the whole harness: no jsdom, no testing-library, no new
 * dependency, matching rank-tracking's and domain-overview's smoke tests.
 * TanStack Query does not fetch during a server render, so every query is
 * seeded from the cache and these tests are hermetic and spend nothing.
 *
 * **What this harness cannot reach.** An open `Dialog` renders through
 * `createPortal`, which the server renderer refuses, so the add/edit dialog
 * and the snapshot drill-down are only asserted *closed* here. Their risky
 * logic — the mention highlighter above all — is covered directly in
 * `components/ai/format.test.ts`, where it needs no DOM at all.
 *
 * The fixtures encode the distinctions this screen must never blur: a prompt
 * that has never run, one answered and not mentioned, one mentioned but not
 * cited, and a day with no run at all in the middle of the timeline.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type {
  AiPromptListResponse,
  AiResultsResponse,
} from "../../../shared/ai";
import type { MetaLocationsResponse } from "../../../shared/keywords";
import type { ProjectListResponse } from "../../../shared/projects";
import type { Workspace } from "../../../shared/workspaces";
import { DEFAULT_WINDOW, windowRange } from "../../components/ai/range";
import { ToastProvider } from "../../components/ui/toast";
import { AiVisibilityModule } from "./module";

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

/**
 * Two prompts across two engines, covering three of the four verdict states:
 * mentioned-and-cited, mentioned-not-cited, and never-run.
 */
const PROMPTS: AiPromptListResponse = {
  projectId: PROJECT_ID,
  domain: "brandpacks.com",
  runInProgress: false,
  prompts: [
    {
      id: "prompt-1",
      prompt: "best photo booth template sites",
      engines: ["perplexity", "chat_gpt"],
      createdAt: "2026-08-01T00:00:00.000Z",
      lastRunAt: "2026-08-27T09:00:00.000Z",
      statuses: [
        {
          engine: "perplexity",
          lastRunDate: "2026-08-27",
          mentioned: true,
          cited: true,
          citationCount: 4,
        },
        {
          engine: "chat_gpt",
          lastRunDate: "2026-08-27",
          mentioned: true,
          cited: false,
          citationCount: 3,
        },
      ],
    },
    {
      id: "prompt-2",
      prompt: "where can I download PSD templates",
      engines: ["perplexity"],
      createdAt: "2026-08-26T00:00:00.000Z",
      lastRunAt: null,
      statuses: [
        {
          engine: "perplexity",
          lastRunDate: null,
          mentioned: null,
          cited: null,
          citationCount: 0,
        },
      ],
    },
  ],
};

const EMPTY_PROMPTS: AiPromptListResponse = {
  projectId: OTHER_PROJECT_ID,
  domain: "hikelist.com",
  runInProgress: true,
  prompts: [],
};

/*
 * The window the panel will ask for. Derived rather than hardcoded so the test
 * does not go stale at midnight — it is the same call the component makes.
 */
const RANGE = windowRange(DEFAULT_WINDOW);

const RESULTS: AiResultsResponse = {
  projectId: PROJECT_ID,
  domain: "brandpacks.com",
  from: RANGE.from,
  to: RANGE.to,
  timelines: [
    {
      engine: "perplexity",
      mentionRate: 0.75,
      citationRate: 0.5,
      points: [
        {
          date: "2026-08-20",
          runs: 2,
          mentions: 1,
          citations: 1,
          mentionRate: 0.5,
          citationRate: 0.5,
        },
        // A day this engine did not run: null, not zero.
        {
          date: "2026-08-24",
          runs: 0,
          mentions: 0,
          citations: 0,
          mentionRate: null,
          citationRate: null,
        },
        {
          date: "2026-08-27",
          runs: 2,
          mentions: 2,
          citations: 1,
          mentionRate: 1,
          citationRate: 0.5,
        },
      ],
    },
    {
      engine: "chat_gpt",
      mentionRate: 1,
      citationRate: 0,
      points: [
        {
          date: "2026-08-27",
          runs: 1,
          mentions: 1,
          citations: 0,
          mentionRate: 1,
          citationRate: 0,
        },
      ],
    },
  ],
  latest: [
    {
      id: "snap-1",
      promptId: "prompt-1",
      engine: "perplexity",
      date: "2026-08-27",
      mentioned: true,
      cited: true,
      citations: [
        {
          url: "https://brandpacks.com/templates",
          title: "BrandPacks templates",
          host: "brandpacks.com",
          ours: true,
        },
        {
          url: "https://example.com/roundup",
          title: "Template roundup",
          host: "example.com",
          ours: false,
        },
      ],
      citedUrls: ["https://brandpacks.com/templates"],
      model: "sonar-2026-07",
      costUsd: 0.006124,
      createdAt: "2026-08-27T09:00:00.000Z",
      responseExcerpt: "BrandPacks.com is a good place to start.",
      mentionTerms: ["brandpacks.com", "brandpacks"],
    },
    {
      id: "snap-2",
      promptId: "prompt-1",
      engine: "chat_gpt",
      date: "2026-08-27",
      mentioned: true,
      cited: false,
      citations: [],
      citedUrls: [],
      model: "gpt-4o-mini-2024-07-18",
      costUsd: 0.029631,
      createdAt: "2026-08-27T09:01:00.000Z",
      responseExcerpt: "You could try BrandPacks for that.",
      mentionTerms: ["brandpacks"],
    },
  ],
  prompts: [
    {
      id: "prompt-1",
      prompt: "best photo booth template sites",
      engines: ["perplexity", "chat_gpt"],
    },
    {
      id: "prompt-2",
      prompt: "where can I download PSD templates",
      engines: ["perplexity"],
    },
  ],
};

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["meta", "locations", WORKSPACE_ID], LOCATIONS);
  client.setQueryData(["projects", "list", WORKSPACE_ID], PROJECTS);
  client.setQueryData(["ai", "prompts", WORKSPACE_ID, PROJECT_ID], PROMPTS);
  client.setQueryData(
    ["ai", "prompts", WORKSPACE_ID, OTHER_PROJECT_ID],
    EMPTY_PROMPTS,
  );
  client.setQueryData(
    ["ai", "results", WORKSPACE_ID, PROJECT_ID, RANGE.from, RANGE.to],
    RESULTS,
  );
  return client;
}

function render(url: string): string {
  return renderToString(
    <QueryClientProvider client={seededClient()}>
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <Routes>
            <Route path="/app/ai-visibility/*" element={<AiVisibilityModule />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/* -------------------------------- the picker ------------------------------- */

describe("with no project selected", () => {
  it("renders the picker as the empty state", () => {
    const html = render("/app/ai-visibility");
    expect(html).toContain("Choose a project");
    expect(html).toContain("BrandPacks");
    expect(html).toContain("brandpacks.com");
  });

  it("does not guess a project on the user's behalf", () => {
    // Two projects exist; neither may be auto-selected, so the project
    // header's own furniture must not appear.
    expect(render("/app/ai-visibility")).not.toContain("Runs weekly");
  });
});

/* ------------------------------ the prompts tab ---------------------------- */

describe("with ?project= selecting a project", () => {
  const html = render(`/app/ai-visibility?project=${PROJECT_ID}`);

  it("renders the header with domain, prompt count and the weekly cadence", () => {
    expect(html).toContain("BrandPacks");
    expect(html).toContain("brandpacks.com");
    expect(html).toContain("2 prompts");
    // The spec asks that scheduled runs be stated, not implied.
    expect(html).toContain("Runs weekly");
  });

  it("offers Run now with a hedged estimate, never a bare price", () => {
    expect(html).toContain("Run now");
    // perplexity + chat_gpt + perplexity = 0.006 + 0.028 + 0.006.
    expect(html).toContain("est. $0.040");
  });

  it("lists both prompts with their engines", () => {
    expect(html).toContain("best photo booth template sites");
    expect(html).toContain("where can I download PSD templates");
    expect(html).toContain("Perplexity");
    expect(html).toContain("ChatGPT");
  });

  /*
   * The three verdict states must not read the same. A prompt that has never
   * run is not a prompt that ran and was not cited.
   */
  it("distinguishes yes, measured-no and never-run in the verdict columns", () => {
    expect(html).toContain("Mentioned on Perplexity: yes");
    expect(html).toContain("Cited on ChatGPT: no");
    expect(html).toContain("Mentioned on Perplexity: not run yet");
  });

  it("shows the last-run date as a day, never a clock time", () => {
    expect(html).toContain("27 Aug 2026");
    expect(html).not.toMatch(/09:00/);
  });

  it("keeps the results panel out of the tree until its tab is chosen", () => {
    expect(html).not.toContain("Mention rate");
  });

  it("does not render a dialog that has not been opened", () => {
    expect(html).not.toContain("Add a prompt");
    expect(html).not.toContain("Answer excerpt");
  });
});

/* ------------------------------- the empty state --------------------------- */

describe("a project with no prompts", () => {
  const html = render(`/app/ai-visibility?project=${OTHER_PROJECT_ID}`);

  it("explains the concept rather than saying 'no data'", () => {
    expect(html).toContain("Track what assistants say about you");
    expect(html).toContain("hikelist.com");
    // Two sentences of concept, naming the engines a prompt can run against.
    expect(html).toContain("Perplexity");
  });

  it("offers starter prompts built from the project's own name", () => {
    expect(html).toContain("Best alternatives to HikeList");
    expect(html).toContain("What are the top sites like HikeList?");
  });

  it("shows the in-progress indicator while a run is under way", () => {
    expect(html).toContain("Running…");
  });

  it("disables Run now when there is nothing to run", () => {
    expect(html).toContain("Add a prompt first — there is nothing to run.");
  });
});

/* ------------------------------ the results tab ---------------------------- */

describe("with ?view=results", () => {
  const html = render(`/app/ai-visibility?project=${PROJECT_ID}&view=results`);

  it("renders the mention-rate chart with per-engine window rates", () => {
    expect(html).toContain("Mention rate");
    expect(html).toContain("75%");
    expect(html).toContain("100%");
  });

  it("explains that a gap is not a zero", () => {
    expect(html).toContain(
      "A break in a line is a day that engine did not run, not a day it scored zero.",
    );
  });

  it("lists the latest run per prompt and engine", () => {
    expect(html).toContain("Latest runs");
    expect(html).toContain("best photo booth template sites");
  });

  /*
   * The cost column is the real charge, at a precision that does not round a
   * six-tenths-of-a-cent answer to zero.
   */
  it("shows real per-answer costs, not the estimate", () => {
    expect(html).toContain("$0.006");
    expect(html).toContain("$0.030");
    expect(html).not.toContain("est. $0.006");
  });

  it("sums the real spend for the answers on screen", () => {
    // 0.006124 + 0.029631 = 0.035755 -> $0.036
    expect(html).toContain("$0.036 spent on the 2 answers shown");
  });

  it("keeps the drill-down closed until a row is opened", () => {
    expect(html).not.toContain("Answer excerpt");
    expect(html).not.toContain("BrandPacks.com is a good place to start.");
  });
});
