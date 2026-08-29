import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PROJECT_PARAM,
  projectSearchParams,
  readLastProjectId,
  resolveProjectId,
  writeLastProjectId,
} from "./project-selection";

const PROJECTS = [{ id: "p-1" }, { id: "p-2" }, { id: "p-3" }];

describe("resolveProjectId", () => {
  it("prefers the URL over the remembered selection", () => {
    expect(
      resolveProjectId(PROJECTS, { fromUrl: "p-2", fromStorage: "p-1" }),
    ).toBe("p-2");
  });

  it("falls back to the remembered selection when the URL says nothing", () => {
    expect(
      resolveProjectId(PROJECTS, { fromUrl: null, fromStorage: "p-3" }),
    ).toBe("p-3");
  });

  /*
   * The precedence rule only holds if the URL is *valid*. A link to a project
   * that has since been deleted should fall through to what this user was
   * working on, not strand them on a broken selection.
   */
  it("ignores a URL naming a project that does not exist", () => {
    expect(
      resolveProjectId(PROJECTS, { fromUrl: "gone", fromStorage: "p-1" }),
    ).toBe("p-1");
  });

  it("ignores a stored id that no longer exists", () => {
    expect(
      resolveProjectId(PROJECTS, { fromUrl: null, fromStorage: "deleted" }),
    ).toBeNull();
  });

  it("ignores an id from another tenant even when both sources agree", () => {
    // Both sources naming the same unknown id must still resolve to nothing:
    // agreement is not evidence the project belongs to this workspace.
    expect(
      resolveProjectId(PROJECTS, { fromUrl: "other", fromStorage: "other" }),
    ).toBeNull();
  });

  it("returns null when the workspace has no projects at all", () => {
    expect(resolveProjectId([], { fromUrl: "p-1", fromStorage: "p-2" })).toBeNull();
  });

  it("never auto-selects the first project", () => {
    expect(resolveProjectId(PROJECTS, {})).toBeNull();
  });

  it("treats empty strings as absent", () => {
    expect(
      resolveProjectId(PROJECTS, { fromUrl: "", fromStorage: "" }),
    ).toBeNull();
  });
});

describe("project storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    const localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    vi.stubGlobal("localStorage", localStorage);
    return store;
  }

  it("round-trips a selection for a workspace", () => {
    stubStorage();
    writeLastProjectId("ws-1", "p-2");
    expect(readLastProjectId("ws-1")).toBe("p-2");
  });

  it("keeps workspaces apart", () => {
    stubStorage();
    writeLastProjectId("ws-1", "p-1");
    writeLastProjectId("ws-2", "p-9");

    expect(readLastProjectId("ws-1")).toBe("p-1");
    expect(readLastProjectId("ws-2")).toBe("p-9");
  });

  it("clears the entry rather than storing an empty value", () => {
    const store = stubStorage();
    writeLastProjectId("ws-1", "p-1");
    writeLastProjectId("ws-1", null);

    expect(readLastProjectId("ws-1")).toBeNull();
    expect([...store.keys()]).toHaveLength(0);
  });

  it("reads null without a workspace", () => {
    stubStorage({ "openrefs.rankTracking.project:ws-1": "p-1" });
    expect(readLastProjectId(null)).toBeNull();
  });

  it("survives storage that throws on every call", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });

    expect(readLastProjectId("ws-1")).toBeNull();
    expect(() => writeLastProjectId("ws-1", "p-1")).not.toThrow();
  });

  it("survives storage being absent entirely", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readLastProjectId("ws-1")).toBeNull();
    expect(() => writeLastProjectId("ws-1", "p-1")).not.toThrow();
  });
});

describe("projectSearchParams", () => {
  it("sets the project key", () => {
    const params = projectSearchParams(new URLSearchParams(), "p-1");
    expect(params.get(PROJECT_PARAM)).toBe("p-1");
  });

  it("removes the key when the selection is cleared", () => {
    const params = projectSearchParams(
      new URLSearchParams("project=p-1"),
      null,
    );
    expect(params.has(PROJECT_PARAM)).toBe(false);
  });

  it("preserves unrelated query state across a switch", () => {
    const params = projectSearchParams(
      new URLSearchParams("project=p-1&device=mobile"),
      "p-2",
    );
    expect(params.get(PROJECT_PARAM)).toBe("p-2");
    expect(params.get("device")).toBe("mobile");
  });

  it("does not mutate the params it was given", () => {
    const original = new URLSearchParams("project=p-1");
    projectSearchParams(original, "p-2");
    expect(original.get(PROJECT_PARAM)).toBe("p-1");
  });
});
