import { describe, expect, it } from "vitest";

import { WORKSPACE_ROLES } from "../../shared/workspaces";
import type { WorkspaceRole } from "../../shared/workspaces";
import { API_KEY_ROLE, compareRoles, roleAtLeast } from "./authorization";

describe("roleAtLeast", () => {
  it("treats every role as meeting itself", () => {
    for (const role of WORKSPACE_ROLES) {
      expect(roleAtLeast(role, role)).toBe(true);
    }
  });

  it("ranks owner > admin > member", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("owner", "member")).toBe(true);
    expect(roleAtLeast("admin", "member")).toBe(true);

    expect(roleAtLeast("admin", "owner")).toBe(false);
    expect(roleAtLeast("member", "owner")).toBe(false);
    expect(roleAtLeast("member", "admin")).toBe(false);
  });

  it("is transitive across the whole ladder", () => {
    for (const a of WORKSPACE_ROLES) {
      for (const b of WORKSPACE_ROLES) {
        for (const c of WORKSPACE_ROLES) {
          if (roleAtLeast(a, b) && roleAtLeast(b, c)) {
            expect(roleAtLeast(a, c), `${a} >= ${b} >= ${c}`).toBe(true);
          }
        }
      }
    }
  });

  it("is antisymmetric — only equal roles satisfy both directions", () => {
    for (const a of WORKSPACE_ROLES) {
      for (const b of WORKSPACE_ROLES) {
        if (roleAtLeast(a, b) && roleAtLeast(b, a)) expect(a).toBe(b);
      }
    }
  });
});

describe("compareRoles", () => {
  it("sorts most privileged first", () => {
    const shuffled: WorkspaceRole[] = ["member", "owner", "admin", "member"];
    expect([...shuffled].sort(compareRoles)).toEqual([
      "owner",
      "admin",
      "member",
      "member",
    ]);
  });
});

describe("API_KEY_ROLE", () => {
  it("is the least privileged role, so a leaked key cannot administer", () => {
    expect(API_KEY_ROLE).toBe("member");
    expect(roleAtLeast(API_KEY_ROLE, "admin")).toBe(false);
    expect(roleAtLeast(API_KEY_ROLE, "owner")).toBe(false);
  });
});
