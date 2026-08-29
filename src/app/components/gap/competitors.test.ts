import { describe, expect, it } from "vitest";

import { GAP_MAX_COMPETITORS } from "../../../shared/gap";
import {
  addCompetitor,
  parseCompetitorList,
  removeCompetitor,
} from "./competitors";

const TARGET = "brandpacks.com";

describe("addCompetitor", () => {
  it("normalises a pasted URL down to the hostname", () => {
    const result = addCompetitor([], "https://www.Templatesbooth.com/pricing", TARGET);
    expect(result.added).toBe("templatesbooth.com");
    expect(result.competitors).toEqual(["templatesbooth.com"]);
    expect(result.rejected).toBeNull();
  });

  it("refuses a blank entry", () => {
    expect(addCompetitor([], "   ", TARGET).rejected).toBe("empty");
  });

  it("refuses something that is not a domain before it costs a call", () => {
    expect(addCompetitor([], "not a domain", TARGET).rejected).toBe("invalid");
    expect(addCompetitor([], "localhost", TARGET).rejected).toBe("invalid");
  });

  it("refuses the target itself, however it is spelled", () => {
    expect(addCompetitor([], "https://www.brandpacks.com", TARGET).rejected).toBe(
      "self",
    );
  });

  it("refuses a duplicate — it would be billed twice for one column", () => {
    const result = addCompetitor(["hikelist.com"], "www.hikelist.com/", TARGET);
    expect(result.rejected).toBe("duplicate");
    expect(result.competitors).toEqual(["hikelist.com"]);
  });

  it("stops at the ceiling", () => {
    const full = ["a.com", "b.com", "c.com", "d.com"];
    expect(full).toHaveLength(GAP_MAX_COMPETITORS);
    const result = addCompetitor(full, "e.com", TARGET);
    expect(result.rejected).toBe("full");
    expect(result.competitors).toEqual(full);
  });

  it("never mutates the array it was given", () => {
    const current = ["a.com"];
    addCompetitor(current, "b.com", TARGET);
    expect(current).toEqual(["a.com"]);
  });
});

describe("removeCompetitor", () => {
  it("drops one and leaves the rest in order", () => {
    expect(removeCompetitor(["a.com", "b.com", "c.com"], "b.com")).toEqual([
      "a.com",
      "c.com",
    ]);
  });
});

describe("parseCompetitorList", () => {
  it("reads the URL's comma-separated list", () => {
    expect(parseCompetitorList("templatesbooth.com,hikelist.com", TARGET)).toEqual([
      "templatesbooth.com",
      "hikelist.com",
    ]);
  });

  it("accepts a pasted, spaced, mixed-case list", () => {
    expect(
      parseCompetitorList("Templatesbooth.com, https://www.hikelist.com/trails"),
    ).toEqual(["templatesbooth.com", "hikelist.com"]);
  });

  /** A hand-edited URL must still land on a usable screen. */
  it("keeps the usable part of a junk list rather than failing", () => {
    expect(parseCompetitorList("banana,,hikelist.com,   ,%%%", TARGET)).toEqual([
      "hikelist.com",
    ]);
    expect(parseCompetitorList("", TARGET)).toEqual([]);
  });

  it("drops the target and duplicates, and caps the list", () => {
    expect(
      parseCompetitorList(
        "brandpacks.com,a.com,a.com,b.com,c.com,d.com,e.com",
        TARGET,
      ),
    ).toEqual(["a.com", "b.com", "c.com", "d.com"]);
  });
});
