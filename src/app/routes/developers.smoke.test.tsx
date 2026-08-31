/**
 * TEMPORARY — not committed. See the agent report: this brief allows exactly
 * one new file under src/app, so this render check is run and then deleted.
 */
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ThemeProvider } from "../lib/theme";
import { DevelopersPage } from "./developers";

/*
 * ThemeProvider reads `document.documentElement` on first render to match the
 * class the inline script in index.html already set. This suite runs in plain
 * node with no jsdom (vitest.config.ts), so the minimum it needs is stubbed
 * here. `window` is deliberately left undefined — see the last test.
 */
(globalThis as { document?: unknown }).document = {
  documentElement: { classList: { contains: () => false } },
};

// ThemeProvider because the page's header carries <ThemeToggle>, exactly as
// /privacy does. main.tsx wraps the whole router in one, so this mirrors the
// real tree rather than working around it.
function render() {
  return renderToString(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/developers"]}>
        <DevelopersPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("DevelopersPage", () => {
  it("mounts", () => {
    expect(render()).toContain("Developers");
  });

  it("says the caller spends their own DataForSEO credits under a cap", () => {
    const html = render();
    expect(html).toContain("own DataForSEO account");
    expect(html).toContain("spend cap");
  });

  it("tells you where to mint a key", () => {
    expect(render()).toContain("API Keys");
  });

  it("carries a copy-paste MCP config with a bearer header", () => {
    const html = render();
    expect(html).toContain("mcpServers");
    expect(html).toContain("/mcp");
    expect(html).toContain("Authorization");
    expect(html).toContain("2026-07-28");
  });

  it("links the OpenAPI document", () => {
    expect(render()).toContain("/api/v1/openapi.json");
  });

  it("lists all twelve tools", () => {
    const html = render();
    for (const name of [
      "keyword_overview",
      "keyword_ideas",
      "keyword_serp",
      "domain_overview",
      "domain_keywords",
      "backlinks_summary",
      "gap_keywords",
      "content_discover",
      "list_collections",
      "add_keywords_to_collection",
      "list_projects",
      "tracked_keywords",
    ]) {
      expect(html, name).toContain(name);
    }
  });

  it("survives having no window, so a server render cannot crash it", () => {
    // `origin()` falls back to a placeholder rather than touching window.
    expect(render()).toContain("https://openrefs.example");
  });
});
