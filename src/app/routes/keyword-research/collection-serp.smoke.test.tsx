/**
 * Render smoke tests for the Phase 7 "View SERP" retrofit on collection detail.
 *
 * The thing worth testing here is a *semantic* rule, not a layout one:
 * `locationCode`/`languageCode` are nullable on a collection row, and
 * `src/shared/collections.ts` is explicit that null means **unknown market, not
 * the default**. So a row that knows its market opens a SERP directly, and a
 * row that does not has to ask first — silently showing UK results for a
 * keyword saved while researching the US would be a wrong answer wearing the
 * clothes of a right one.
 *
 * `renderToString`, seeded query cache, no jsdom and no network — the same
 * harness as the other module smoke tests.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type { CollectionDetailResponse } from "../../../shared/collections";
import type { MetaLocationsResponse } from "../../../shared/keywords";
import type { Workspace } from "../../../shared/workspaces";
import { ToastProvider } from "../../components/ui/toast";
import { CollectionDetail } from "./collection-detail";

const WORKSPACE_ID = "ws-1";
const COLLECTION_ID = "col-1";

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

const COLLECTION: CollectionDetailResponse = {
  id: COLLECTION_ID,
  name: "Booth ideas",
  keywordCount: 2,
  createdAt: "2026-08-01T00:00:00.000Z",
  keywords: [
    // Saved after the migration: the market travelled with it.
    {
      keyword: "photo booth templates",
      volumeSnapshot: 1300,
      locationCode: 2826,
      languageCode: "en",
      addedAt: "2026-08-20T00:00:00.000Z",
    },
    // Saved before it: market genuinely unknown.
    {
      keyword: "booth strips",
      volumeSnapshot: null,
      locationCode: null,
      languageCode: null,
      addedAt: "2026-07-01T00:00:00.000Z",
    },
  ],
};

function render(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["workspaces"], WORKSPACES);
  client.setQueryData(["keywords", "meta", WORKSPACE_ID], LOCATIONS);
  client.setQueryData(
    ["collections", "detail", WORKSPACE_ID, COLLECTION_ID],
    COLLECTION,
  );

  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          `/app/keyword-research/collections/${COLLECTION_ID}`,
        ]}
      >
        <ToastProvider>
          <Routes>
            <Route
              path="/app/keyword-research/collections/:id"
              element={<CollectionDetail workspaceId={WORKSPACE_ID} />}
            />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the market column", () => {
  const html = render();

  it("names the market a row was saved in", () => {
    expect(html).toContain("United Kingdom · en");
  });

  /*
   * The distinction the shared type insists on. "Unknown" is a fact about the
   * row; rendering the workspace default here would be inventing one.
   */
  it("says Unknown for a row saved before markets were recorded", () => {
    expect(html).toContain("Unknown");
    expect(html).toContain(
      "saved before collections recorded a market",
    );
  });
});

describe("the View SERP action", () => {
  const html = render();

  it("is offered on every row", () => {
    expect(html).toContain("View SERP for photo booth templates");
    expect(html).toContain("View SERP for booth strips");
  });

  it("promises the saved market when there is one", () => {
    expect(html).toContain("in the market it was saved in");
  });

  /*
   * The whole point of the retrofit: an unknown market is asked about, not
   * assumed. SerpPanel's props are non-nullable, so "asking" and "showing" are
   * two genuinely different states rather than one with a hole in it.
   */
  it("promises to ask first when the market is unknown", () => {
    expect(html).toContain("we&#x27;ll ask which market first");
  });

  it("opens no panel and no picker until something is clicked", () => {
    expect(html).not.toContain("Which market?");
    expect(html).not.toContain("Top organic results from Google.");
  });
});
