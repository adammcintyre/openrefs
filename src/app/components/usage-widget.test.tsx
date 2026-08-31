/**
 * The sidebar spend readout, now that it reports real money.
 *
 * It used to render a hardcoded $3.42 behind a "Sample" badge. The badge was
 * load-bearing while the number was fiction, and removing it while leaving a
 * plausible fake in place would have been the worst of both — so the first
 * thing pinned here is that the badge is gone *and* the numbers are the ones
 * the API returned.
 *
 * `renderToString` is the harness, as everywhere else in this app: TanStack
 * Query does not fetch during a server render, so the happy paths are seeded
 * from the cache. The error path is the exception — it is seeded straight onto
 * the query so the widget's most important behaviour (say nothing) is proved
 * rather than assumed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { UsageResponse } from "../../shared/api";
import type { Workspace } from "../../shared/workspaces";
import { UsageWidget, usageKeys, usagePercent } from "./usage-widget";

const WORKSPACE_ID = "ws-1";

function workspace(spendCapUsd: number): Workspace {
  return {
    id: WORKSPACE_ID,
    name: "My workspace",
    role: "owner",
    spendCapUsd,
    credentials: { configured: true, login: "ke***@example.com" },
    createdAt: 0,
  };
}

/** Shaped like the Worker's rollup: a month's total plus the per-endpoint split. */
const USAGE: UsageResponse = {
  totalUsd: 7.41,
  requestCount: 214,
  byEndpoint: [
    {
      endpoint: "dataforseo_labs/google/domain_rank_overview/live",
      requests: 120,
      costUsd: 5.2,
    },
    { endpoint: "backlinks/summary/live", requests: 94, costUsd: 2.21 },
  ],
  periodStart: "2026-08-01T00:00:00.000Z",
};

function render({
  cap = 25,
  usage = USAGE,
  failed = false,
  pending = false,
  collapsed = false,
}: {
  cap?: number;
  usage?: UsageResponse;
  failed?: boolean;
  pending?: boolean;
  collapsed?: boolean;
} = {}): string {
  const client = new QueryClient({
    /*
     * `retryOnMount: false` is what makes the error path observable at all. A
     * query that failed and holds no data is optimistically reported as pending
     * on its first mount, so without this the error case would render the
     * skeleton and the assertion below would pass for the wrong reason.
     */
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
  client.setQueryData(["workspaces"], [workspace(cap)]);

  if (failed) {
    client
      .getQueryCache()
      .build(client, { queryKey: usageKeys.month(WORKSPACE_ID) })
      .setState({
        status: "error",
        error: new Error("usage read failed"),
        fetchStatus: "idle",
      });
  } else if (!pending) {
    client.setQueryData(usageKeys.month(WORKSPACE_ID), usage);
  }

  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UsageWidget collapsed={collapsed} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the real numbers", () => {
  const html = render();

  it("renders what the API reported, not a sample", () => {
    expect(html).toContain("$7.41");
    expect(html).toContain("of $25.00 cap");
  });

  /** The badge existed only to label fiction. Fiction is gone; so is it. */
  it("no longer claims to be sample data", () => {
    expect(html).not.toContain("Sample");
    expect(html).not.toContain("sample data");
    expect(html).not.toContain("$3.42");
  });

  it("announces the bar as a percentage rather than as two empty divs", () => {
    expect(html).toContain('role="progressbar"');
    // 7.41 of 25 is 30%.
    expect(html).toContain('aria-valuenow="30"');
  });

  it("points at where the cap is set", () => {
    expect(html).toContain('href="/app/settings"');
  });
});

describe("a cap of zero", () => {
  const html = render({ cap: 0 });

  /**
   * 0 is the setting that blocks every paid call. Rendering it as an empty bar
   * would read as "plenty of headroom" — the exact opposite of the truth.
   */
  it("reads as blocked, not as unlimited headroom", () => {
    expect(html).toContain("paid calls blocked");
    expect(html).toContain('aria-valuenow="100"');
  });
});

describe("a failed read", () => {
  /** This sits in the frame around every screen; its failure mode is silence. */
  it("renders nothing at all rather than breaking the sidebar", () => {
    expect(render({ failed: true })).toBe("");
  });
});

describe("loading", () => {
  it("holds the space with a skeleton instead of a number", () => {
    const html = render({ pending: true });
    expect(html).not.toContain("$");
    expect(html).toContain("animate-pulse");
  });
});

describe("the collapsed rail", () => {
  const html = render({ collapsed: true });

  it("still works, as a percentage and a screen-reader summary", () => {
    expect(html).toContain("30%");
    expect(html).toContain("$7.41 of $25.00 monthly cap used");
  });

  it("keeps the sidebar quiet when the read failed", () => {
    expect(render({ collapsed: true, failed: true })).toBe("");
  });
});

describe("usagePercent", () => {
  it("rounds spend against the cap", () => {
    expect(usagePercent(7.41, 25)).toBe(30);
    expect(usagePercent(0, 25)).toBe(0);
  });

  /** Over the cap is still a full bar — never 140% of one. */
  it("clamps at a full bar", () => {
    expect(usagePercent(35, 25)).toBe(100);
  });

  it("treats a zero cap as full rather than as a division by zero", () => {
    expect(usagePercent(0, 0)).toBe(100);
    expect(Number.isNaN(usagePercent(0, 0) ?? NaN)).toBe(false);
  });

  /** No denominator, no percentage — "unknown" must not render as "unlimited". */
  it("has nothing to say without a cap", () => {
    expect(usagePercent(7.41, null)).toBeNull();
    expect(usagePercent(7.41, undefined)).toBeNull();
  });
});
