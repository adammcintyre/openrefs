/**
 * The billing invariants, at the level where they are decided: the request.
 *
 * Two rules the search trail depends on, and both are one careless edit away
 * from costing users money:
 *
 *  1. **A history click never bills.** Opening a past search asks for the
 *     cached copy with `stale=true`, which the Worker answers at $0 without
 *     touching DataForSEO.
 *  2. **Only a Refresh press bills.** `fresh=true` is reachable from exactly
 *     one builder per endpoint, and those builders are used by exactly one
 *     mutation. No mounting query can produce it, however its cache mode is set.
 *
 * Most of that is decided in a URL and can be checked by building one. The
 * Domain Score gauge is the exception — it is a POST, so its rules live in a
 * body, and "exactly once per Refresh" is a claim about how many calls happen
 * rather than about what one of them says. Hence the recorded API below.
 */
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ApiCall {
  method: "get" | "post";
  path: string;
  body?: unknown;
}

/** Every call the module made, in order. Hoisted so the mock factory can see it. */
const calls = vi.hoisted(() => [] as ApiCall[]);

vi.mock("../../lib/api", () => ({
  api: {
    get: (path: string) => {
      calls.push({ method: "get", path });
      return Promise.resolve({});
    },
    post: (path: string, body: unknown) => {
      calls.push({ method: "post", path, body });
      return Promise.resolve({ items: [], itemsCount: 0, costUsd: 0.02, cached: false });
    },
  },
}));

import {
  domainFreshParams,
  domainKeys,
  domainQueryParams,
  domainScoreBody,
  domainScoreFreshBody,
  domainScoreQueryOptions,
  refreshDomainReport,
} from "./queries";
import type { DomainSearch } from "./url-state";

const SEARCH: DomainSearch = {
  target: "brandpacks.com",
  location: 2826,
  language: "en",
  tab: "keywords",
};

const SCORES_PATH = "/backlinks/scores";

beforeEach(() => {
  calls.length = 0;
});

describe("domainQueryParams", () => {
  it("carries the domain and market", () => {
    const params = domainQueryParams("ws-1", SEARCH);
    expect(params.get("workspace")).toBe("ws-1");
    expect(params.get("domain")).toBe("brandpacks.com");
    expect(params.get("location")).toBe("2826");
    expect(params.get("language")).toBe("en");
  });

  it("asks for nothing special in the ordinary case", () => {
    const params = domainQueryParams("ws-1", SEARCH, "auto");
    expect(params.get("stale")).toBeNull();
    expect(params.get("fresh")).toBeNull();
  });

  it("asks for the cached copy when opened from history", () => {
    const params = domainQueryParams("ws-1", SEARCH, "stale");
    expect(params.get("stale")).toBe("true");
  });

  /**
   * The invariant behind rule 2. A query hook can only ever reach this builder,
   * so there is no cache mode — and no argument at all — that makes a mounting
   * query spend.
   */
  it("can never produce a billed request, whatever the mode", () => {
    for (const mode of ["auto", "stale"] as const) {
      expect(domainQueryParams("ws-1", SEARCH, mode).get("fresh")).toBeNull();
    }
  });
});

describe("domainFreshParams", () => {
  it("bypasses the cache", () => {
    expect(domainFreshParams("ws-1", SEARCH).get("fresh")).toBe("true");
  });

  /** `fresh` + `stale` together is a 422 by contract (docs/specs/PHASE9.md). */
  it("never asks for stale and fresh at once", () => {
    expect(domainFreshParams("ws-1", SEARCH).get("stale")).toBeNull();
  });

  it("keeps the domain and market it is refreshing", () => {
    const params = domainFreshParams("ws-1", SEARCH);
    expect(params.get("domain")).toBe("brandpacks.com");
    expect(params.get("location")).toBe("2826");
  });
});

/* ------------------------- the Domain Score gauge ------------------------- */

describe("domainScoreBody", () => {
  it("asks about exactly the domain on screen", () => {
    expect(domainScoreBody("ws-1", SEARCH)).toEqual({
      workspace: "ws-1",
      targets: ["brandpacks.com"],
    });
  });

  it("asks for the cached copy when opened from history", () => {
    expect(domainScoreBody("ws-1", SEARCH, "stale").stale).toBe(true);
  });

  /** The same invariant the URL builder carries: a mounting query cannot bill. */
  it("can never produce a billed request, whatever the mode", () => {
    for (const mode of ["auto", "stale"] as const) {
      expect(domainScoreBody("ws-1", SEARCH, mode)).not.toHaveProperty("fresh");
    }
  });

  /**
   * No location, no language. A link profile is not a per-market fact, so
   * switching market must not re-buy a score that cannot have changed — and a
   * body carrying one would fork the server cache entry per market.
   */
  it("carries no market", () => {
    const body = domainScoreBody("ws-1", SEARCH);
    expect(body).not.toHaveProperty("location");
    expect(body).not.toHaveProperty("language");
  });
});

describe("domainScoreFreshBody", () => {
  it("bypasses the cache", () => {
    expect(domainScoreFreshBody("ws-1", SEARCH).fresh).toBe(true);
  });

  /** `fresh` + `stale` together is a 422 by contract. */
  it("never asks for stale and fresh at once", () => {
    expect(domainScoreFreshBody("ws-1", SEARCH)).not.toHaveProperty("stale");
  });
});

describe("the score query", () => {
  it("does not fire without a target", () => {
    expect(
      domainScoreQueryOptions("ws-1", { ...SEARCH, target: "" }, true).enabled,
    ).toBe(false);
  });

  it("does not fire without a workspace", () => {
    expect(domainScoreQueryOptions(null, SEARCH, true).enabled).toBe(false);
  });

  it("does not fire before the page says it may", () => {
    expect(domainScoreQueryOptions("ws-1", SEARCH, false).enabled).toBe(false);
  });

  it("fires for a real target in a real workspace", () => {
    expect(domainScoreQueryOptions("ws-1", SEARCH, true).enabled).toBe(true);
  });

  it("posts the batch endpoint, not a per-market GET", async () => {
    await domainScoreQueryOptions("ws-1", SEARCH, true).queryFn();
    expect(calls).toEqual([
      {
        method: "post",
        path: SCORES_PATH,
        body: { workspace: "ws-1", targets: ["brandpacks.com"] },
      },
    ]);
  });

  /** The whole reason a history click is free: it must reach the wire. */
  it("carries stale=true under the history cache mode", async () => {
    await domainScoreQueryOptions("ws-1", SEARCH, true, "stale").queryFn();
    expect(calls[0]?.body).toMatchObject({ stale: true });
    expect(calls[0]?.body).not.toHaveProperty("fresh");
  });

  /**
   * Authority moves over months and this is a billed call sitting beside the
   * headline block; a short window would mean paying to redraw the same dial.
   */
  it("does not re-buy itself in the background", () => {
    const options = domainScoreQueryOptions("ws-1", SEARCH, true);
    expect(options.staleTime).toBeGreaterThanOrEqual(60 * 60_000);
    expect(options.retry).toBe(false);
  });

  /** Cache mode is a property of the fetch, never of the entry. */
  it("keys the same domain the same way in every mode", () => {
    expect(domainScoreQueryOptions("ws-1", SEARCH, true, "stale").queryKey).toEqual(
      domainScoreQueryOptions("ws-1", SEARCH, true, "auto").queryKey,
    );
  });
});

describe("refreshDomainReport", () => {
  it("re-buys the Domain Score with the headline block, exactly once", async () => {
    const client = new QueryClient();
    await refreshDomainReport(client, "ws-1", SEARCH, { tab: "pages" });

    const scores = calls.filter((call) => call.path === SCORES_PATH);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.body).toEqual({
      workspace: "ws-1",
      targets: ["brandpacks.com"],
      fresh: true,
    });
  });

  /** A refreshed score has to land where the gauge reads from, or it is lost. */
  it("writes the answer into the gauge's cache entry", async () => {
    const client = new QueryClient();
    await refreshDomainReport(client, "ws-1", SEARCH, { tab: "pages" });

    expect(client.getQueryData(domainKeys.score("ws-1", SEARCH))).toBeDefined();
  });

  /**
   * The gauge refreshes with the headline block whichever tab is open — it is
   * part of that block, not part of any tab — and a tab that was never loaded
   * still buys nothing.
   */
  it.each(["keywords", "pages", "competitors", "countries"] as const)(
    "buys it once on the %s tab and nothing the user has not opened",
    async (tab) => {
      const client = new QueryClient();
      await refreshDomainReport(
        client,
        "ws-1",
        SEARCH,
        tab === "keywords" ? { tab, paid: false, filters: {} } : { tab },
      );

      expect(calls.filter((call) => call.path === SCORES_PATH)).toHaveLength(1);
      // The headline overview, and the score. Nothing else was on screen.
      expect(calls).toHaveLength(2);
    },
  );

  /** An empty target is a 422 nobody learns anything from. */
  it("does not ask about a domain that is not there", async () => {
    const client = new QueryClient();
    await refreshDomainReport(client, "ws-1", { ...SEARCH, target: "" }, {
      tab: "pages",
    });

    expect(calls.filter((call) => call.path === SCORES_PATH)).toHaveLength(0);
  });
});
