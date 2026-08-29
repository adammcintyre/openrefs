import { describe, expect, it } from "vitest";

import { GSC_CALLBACK_ERRORS } from "../../../shared/gsc";
import {
  clearedGscCallbackParams,
  hasGscCallbackParams,
  readGscCallback,
} from "./callback";

describe("readGscCallback", () => {
  it("reports an ordinary visit as nothing to announce", () => {
    expect(readGscCallback("")).toEqual({ kind: "none" });
    expect(readGscCallback("?project=p1")).toEqual({ kind: "none" });
  });

  it("reads a successful connection and the project it was for", () => {
    expect(readGscCallback("?connected=1&project=p1")).toEqual({
      kind: "connected",
      projectId: "p1",
    });
  });

  it("survives a connected flag without a project", () => {
    expect(readGscCallback("?connected=1")).toEqual({
      kind: "connected",
      projectId: null,
    });
  });

  /*
   * The distinction this whole module exists for. Cancelling is a decision the
   * user made on purpose and understood; explaining it back to them in a red
   * banner would be the app arguing with them.
   */
  it("treats access_denied as a quiet cancellation, not a failure", () => {
    const outcome = readGscCallback("?error=access_denied&project=p1");
    expect(outcome).toEqual({ kind: "cancelled", projectId: "p1" });
    expect(outcome.kind).not.toBe("failed");
  });

  it("gives every other flow error a titled, actionable notice", () => {
    for (const code of GSC_CALLBACK_ERRORS) {
      if (code === "access_denied") continue;
      const outcome = readGscCallback(`?error=${code}`);
      if (outcome.kind !== "failed") {
        throw new Error(`${code} should be a failure`);
      }
      expect(outcome.code).toBe(code);
      expect(outcome.title.length).toBeGreaterThan(0);
      // Every message has to end somewhere useful, not just report the fault.
      expect(outcome.body.length).toBeGreaterThan(40);
    }
  });

  it("covers the API error codes the callback passes through", () => {
    for (const code of [
      "gsc_error",
      "gsc_reconnect_required",
      "forbidden",
      "not_found",
    ]) {
      const outcome = readGscCallback(`?error=${code}`);
      expect(outcome.kind).toBe("failed");
    }
  });

  it("falls back to a generic notice for a code it has never seen", () => {
    const outcome = readGscCallback("?error=teapot");
    if (outcome.kind !== "failed") throw new Error("expected a failure");
    expect(outcome.code).toBe("teapot");
    expect(outcome.title).toBe("That connection didn't complete");
  });

  /*
   * If both somehow arrive, the failure is the honest report: announcing a
   * success that a following error contradicts is the worse mistake.
   */
  it("lets an error win over a connected flag", () => {
    expect(readGscCallback("?connected=1&error=invalid_state").kind).toBe(
      "failed",
    );
  });

  it("ignores blank and falsy values rather than announcing them", () => {
    expect(readGscCallback("?connected=&error=").kind).toBe("none");
    expect(readGscCallback("?connected=0").kind).toBe("none");
    expect(readGscCallback("?connected=false").kind).toBe("none");
  });

  it("accepts URLSearchParams as well as a string", () => {
    const params = new URLSearchParams({ connected: "1", project: "p9" });
    expect(readGscCallback(params)).toEqual({
      kind: "connected",
      projectId: "p9",
    });
  });
});

describe("clearing the callback parameters", () => {
  it("detects the parameters that need consuming", () => {
    expect(hasGscCallbackParams("?connected=1")).toBe(true);
    expect(hasGscCallbackParams("?error=invalid_state")).toBe(true);
    expect(hasGscCallbackParams("?project=p1")).toBe(false);
    expect(hasGscCallbackParams("")).toBe(false);
  });

  /*
   * `project` is the module's own selection parameter. Cleaning it away would
   * bounce the user to the project picker in the same instant they connected
   * the project they were looking at.
   */
  it("removes the callback parameters and keeps the project selection", () => {
    const next = clearedGscCallbackParams(
      new URLSearchParams("connected=1&error=x&project=p1&tab=queries"),
    );
    expect(next.get("project")).toBe("p1");
    expect(next.get("tab")).toBe("queries");
    expect(next.has("connected")).toBe(false);
    expect(next.has("error")).toBe(false);
  });

  it("does not mutate the params it was given", () => {
    const original = new URLSearchParams("connected=1&project=p1");
    clearedGscCallbackParams(original);
    expect(original.get("connected")).toBe("1");
  });
});
