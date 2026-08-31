/**
 * The billing invariants, at the level where they are decided: the URL.
 *
 * Two rules the search trail depends on, and both are one careless edit away
 * from costing users money:
 *
 *  1. **A history click never bills.** Opening a past search asks for the
 *     cached copy with `stale=true`, which the Worker answers at $0 without
 *     touching DataForSEO.
 *  2. **Only a Refresh press bills.** `fresh=true` is reachable from exactly
 *     one builder, and that builder is used by exactly one mutation. No
 *     mounting query can produce it, however its cache mode is set.
 */
import { describe, expect, it } from "vitest";

import { domainFreshParams, domainQueryParams } from "./queries";
import type { DomainSearch } from "./url-state";

const SEARCH: DomainSearch = {
  target: "brandpacks.com",
  location: 2826,
  language: "en",
  tab: "keywords",
};

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
