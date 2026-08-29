/**
 * Membership and role checks. Every workspace-scoped handler in the Worker
 * goes through `requireWorkspaceRole` — that call is what turns a URL segment
 * into a proven claim about the caller.
 *
 * The workspace id always comes from the path. Nothing here reads a body.
 */
import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "../../db";
import { workspaceMembers } from "../../db";
import type { WorkspaceRole } from "../../shared/workspaces";
import { ApiException } from "../http";
import type { SessionContext } from "../types";

/**
 * Higher number wins. Comparing ranks rather than listing allowed roles at each
 * call site means adding a role later is one edit here.
 */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/** True when `role` is at least as privileged as `minimum`. */
export function roleAtLeast(
  role: WorkspaceRole,
  minimum: WorkspaceRole,
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Sorts most-privileged first. Handy for member lists. */
export function compareRoles(a: WorkspaceRole, b: WorkspaceRole): number {
  return ROLE_RANK[b] - ROLE_RANK[a];
}

/**
 * The role an API key acts with. Deliberately the weakest one: keys are for
 * reading a workspace's data from scripts, and a leaked key must not be able to
 * rotate DataForSEO credentials, change members, or delete the workspace.
 */
export const API_KEY_ROLE: WorkspaceRole = "member";

/**
 * Resolves the caller's role in `workspaceId` and asserts it meets `minRole`.
 *
 * Non-membership and insufficient privilege both raise `forbidden`, and a
 * missing workspace is indistinguishable from one the caller cannot see — a
 * 404 here would confirm that a given workspace id exists.
 */
export async function requireWorkspaceRole(
  db: Db,
  session: SessionContext | null,
  workspaceId: string,
  minRole: WorkspaceRole,
): Promise<WorkspaceRole> {
  if (session === null) {
    throw new ApiException("unauthorized", "Sign in to continue.");
  }

  if (session.kind === "api_key") {
    if (session.workspaceId !== workspaceId) {
      throw new ApiException("forbidden", "No access to this workspace.");
    }
    if (!roleAtLeast(API_KEY_ROLE, minRole)) {
      throw new ApiException(
        "forbidden",
        "API keys cannot perform this action. Use a signed-in session.",
      );
    }
    return API_KEY_ROLE;
  }

  const [membership] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, session.userId),
      ),
    )
    .limit(1);

  if (membership === undefined) {
    throw new ApiException("forbidden", "No access to this workspace.");
  }
  if (!roleAtLeast(membership.role, minRole)) {
    throw new ApiException(
      "forbidden",
      `This action requires the ${minRole} role.`,
    );
  }
  return membership.role;
}

/**
 * How many owners a workspace has. A workspace must never reach zero — that
 * would leave nobody able to delete it or promote anyone, so the last owner
 * cannot be demoted or removed.
 */
export async function countOwners(
  db: Db,
  workspaceId: string,
): Promise<number> {
  const owners = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "owner"),
      ),
    );
  return owners.length;
}

/**
 * Workspaces this user owns alone. Account deletion destroys these outright —
 * nobody else can — while workspaces with a co-owner just lose a member.
 */
export async function soleOwnedWorkspaceIds(
  db: Db,
  userId: string,
): Promise<string[]> {
  const owned = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, "owner"),
      ),
    );
  const ids = owned.map((row) => row.workspaceId);
  if (ids.length === 0) return [];

  // One query for every candidate, then count in memory — cheaper than N
  // round trips, and these lists are members-of-a-workspace small.
  const owners = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(
      and(
        inArray(workspaceMembers.workspaceId, ids),
        eq(workspaceMembers.role, "owner"),
      ),
    );

  const counts = new Map<string, number>();
  for (const { workspaceId } of owners) {
    counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1);
  }
  return ids.filter((id) => counts.get(id) === 1);
}

/**
 * The signed-in user, or a 401. Use in handlers that act *as a person*
 * (accepting an invite, deleting your own account) rather than as a workspace.
 */
export function requireUserSession(session: SessionContext | null): {
  sessionId: string;
  userId: string;
} {
  if (session === null) {
    throw new ApiException("unauthorized", "Sign in to continue.");
  }
  if (session.kind !== "session") {
    throw new ApiException(
      "forbidden",
      "This endpoint needs a signed-in user, not an API key.",
    );
  }
  return { sessionId: session.sessionId, userId: session.userId };
}
