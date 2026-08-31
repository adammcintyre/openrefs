/**
 * The freshness pair — `?fresh` and `?stale` — and the rule that they are
 * exclusive.
 *
 * This is a money rule, not a tidiness one. `fresh` buys a new answer and
 * `stale` refuses to spend, so a request carrying both has to be refused rather
 * than ranked: whichever way a ranking fell, a client that sent both by mistake
 * would either bill on every history click or never refresh at all, and neither
 * failure shows up until the invoice does.
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { booleanParam, freshnessShape, toFreshness, withFreshness } from "./research";

const schema = withFreshness(
  z.object({ workspace: z.string() }).extend(freshnessShape),
);

function parse(query: Record<string, string>) {
  return schema.safeParse({ workspace: "ws-1", ...query });
}

describe("booleanParam, as the freshness flags use it", () => {
  it("reads a bare flag, an explicit true, and a 1 as true", () => {
    for (const value of ["", "true", "1", "yes", "on", "TRUE"]) {
      expect(parse({ stale: value }).data?.stale, value).toBe(true);
    }
  });

  it("reads anything else as false, and absence as undefined", () => {
    expect(parse({ stale: "false" }).data?.stale).toBe(false);
    expect(parse({ stale: "0" }).data?.stale).toBe(false);
    // Undefined, not false: absent means "no instruction", so the client's own
    // default applies rather than one we invented.
    expect(parse({}).data?.stale).toBeUndefined();
    expect(parse({}).data?.fresh).toBeUndefined();
  });
});

describe("withFreshness", () => {
  it("accepts either flag alone", () => {
    expect(parse({ fresh: "true" }).success).toBe(true);
    expect(parse({ stale: "true" }).success).toBe(true);
  });

  it("accepts neither", () => {
    expect(parse({}).success).toBe(true);
  });

  it("refuses both together", () => {
    const result = parse({ fresh: "true", stale: "true" });
    expect(result.success).toBe(false);
    const flattened: { fieldErrors: Record<string, string[] | undefined> } =
      z.flattenError(result.error as z.ZodError);
    expect(flattened.fieldErrors["stale"]).toBeDefined();
  });

  it("accepts the pair when one of them is explicitly false", () => {
    // `?fresh=false&stale=true` is not a contradiction — it is one instruction
    // and one thing switched off, which a UI toggling both flags will send.
    expect(parse({ fresh: "false", stale: "true" }).success).toBe(true);
    expect(parse({ fresh: "true", stale: "0" }).success).toBe(true);
  });
});

describe("toFreshness", () => {
  it("renames `stale` to the client's `allowStale`", () => {
    // Two words on purpose: the query parameter is a request ("give me the
    // stale one") and the client option is a permission ("you may serve one,
    // if there is one") — the difference is what makes the fall-through-and-
    // bill case read as intended rather than as a bug.
    expect(toFreshness({ stale: true })).toEqual({
      fresh: undefined,
      allowStale: true,
    });
  });

  it("passes `fresh` through untouched", () => {
    expect(toFreshness({ fresh: true })).toEqual({
      fresh: true,
      allowStale: undefined,
    });
  });

  it("carries nothing when the caller asked for nothing", () => {
    expect(toFreshness({})).toEqual({ fresh: undefined, allowStale: undefined });
  });
});

describe("the shape itself", () => {
  it("is the same booleanParam both routes and tests rely on", () => {
    expect(freshnessShape.fresh).toBe(booleanParam);
    expect(freshnessShape.stale).toBe(booleanParam);
  });
});
