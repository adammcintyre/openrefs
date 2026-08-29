/**
 * `/api/v1/workspaces` — the tenant boundary of OpenRefs.
 *
 * Invariants for anything added to this file:
 *
 *  1. The workspace id comes from the path, never from a body or a header, and
 *     every handler proves membership with `requireWorkspaceRole` before it
 *     touches a row. There is no "current workspace" to fall back on.
 *  2. Stored DataForSEO credentials never appear in a response. The only
 *     readable form is `{ configured, login: "te***@example.com" }`.
 *  3. Secrets are write-only from the client's side and hashed at rest: invite
 *     and API-key tokens exist in plaintext exactly once, in the response that
 *     creates them.
 */
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  apiKeys,
  getDb,
  invites,
  users,
  workspaceMembers,
  workspaces,
  type Db,
} from "../../db";
import type {
  ApiKeySummary,
  CreatedApiKey,
  CreatedInvite,
  Workspace,
  WorkspaceCredentials,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRole,
} from "../../shared/workspaces";
import {
  acceptInviteSchema,
  createApiKeySchema,
  createInviteSchema,
  createWorkspaceSchema,
  credentialsSchema,
  deleteWorkspaceSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from "../../shared/workspaces";
import { apiError } from "../http";
import {
  countOwners,
  requireUserSession,
  requireWorkspaceRole,
  roleAtLeast,
} from "../lib/authorization";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "../lib/crypto";
import { deleteWorkspaceEverywhere } from "../lib/deletion";
import { buildInviteUrl, inviteExpiresAt, isInviteUsable } from "../lib/invites";
import { maskLogin } from "../lib/mask";
import { readJson, readParams } from "../lib/validate";
import { API_KEY_PREFIX, requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const workspaceParams = z.object({ id: z.uuid() });
const memberParams = z.object({ id: z.uuid(), userId: z.uuid() });
const inviteParams = z.object({ id: z.uuid(), inviteId: z.uuid() });
const apiKeyParams = z.object({ id: z.uuid(), keyId: z.uuid() });

const app = new Hono<AppEnv>();

// Nothing under /workspaces is public.
app.use("*", requireSession);

/* ------------------------------- helpers ---------------------------------- */

/**
 * Turns the encrypted columns into the only shape a client may see. A
 * decryption failure (rotated `APP_MASTER_KEY`, corrupt ciphertext) still
 * reports `configured: true` — the operator needs to know something is stored
 * — but reveals nothing about it.
 */
async function credentialsSummary(
  masterKey: string,
  loginEnc: string | null,
  passwordEnc: string | null,
): Promise<WorkspaceCredentials> {
  if (loginEnc === null || passwordEnc === null) {
    return { configured: false, login: null };
  }
  try {
    return { configured: true, login: maskLogin(await decryptSecret(masterKey, loginEnc)) };
  } catch {
    return { configured: true, login: null };
  }
}

/** The columns a workspace response is built from — never the password. */
const workspaceColumns = {
  id: workspaces.id,
  name: workspaces.name,
  spendCapUsd: workspaces.spendCapUsd,
  dfsLoginEnc: workspaces.dfsLoginEnc,
  dfsPasswordEnc: workspaces.dfsPasswordEnc,
  createdAt: workspaces.createdAt,
};

type WorkspaceRow = {
  id: string;
  name: string;
  spendCapUsd: number;
  dfsLoginEnc: string | null;
  dfsPasswordEnc: string | null;
  createdAt: Date;
};

async function toWorkspace(
  masterKey: string,
  row: WorkspaceRow,
  role: WorkspaceRole,
): Promise<Workspace> {
  return {
    id: row.id,
    name: row.name,
    role,
    spendCapUsd: row.spendCapUsd,
    credentials: await credentialsSummary(
      masterKey,
      row.dfsLoginEnc,
      row.dfsPasswordEnc,
    ),
    createdAt: row.createdAt.getTime(),
  };
}

async function loadWorkspace(
  db: Db,
  workspaceId: string,
): Promise<WorkspaceRow | undefined> {
  const [row] = await db
    .select(workspaceColumns)
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row;
}

/* ------------------------------- invites ---------------------------------- */

/*
 * Registered before the `/:id/...` routes: "invites" would otherwise be read as
 * a workspace id and fail uuid validation.
 */
app.post("/invites/accept", async (c) => {
  const { userId } = requireUserSession(c.get("session"));
  const { token } = await readJson(c, acceptInviteSchema);
  const db = getDb(c.env.DB);

  const tokenHash = await sha256Hex(token);
  const [invite] = await db
    .select({
      id: invites.id,
      workspaceId: invites.workspaceId,
      role: invites.role,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);

  if (!isInviteUsable(invite)) {
    // Unknown, expired and already-redeemed are one answer on purpose: the
    // token is a capability, and probing must not distinguish these.
    if (invite !== undefined) {
      await db.delete(invites).where(eq(invites.id, invite.id));
    }
    return apiError(
      c,
      "invite_invalid",
      "That invite link has expired or has already been used.",
    );
  }

  // `isInviteUsable` narrowed this, but TypeScript cannot see through it.
  const accepted = invite as NonNullable<typeof invite>;

  const [existing] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, accepted.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  if (existing === undefined) {
    await db.batch([
      db.insert(workspaceMembers).values({
        workspaceId: accepted.workspaceId,
        userId,
        role: accepted.role,
      }),
      db.delete(invites).where(eq(invites.id, accepted.id)),
    ]);
  } else {
    /*
     * Already a member: consume the invite but leave the membership alone. An
     * invite must never be able to change an existing role — that would let a
     * stale "member" link quietly demote an owner. Role changes go through
     * PATCH /:id/members/:userId.
     */
    await db.delete(invites).where(eq(invites.id, accepted.id));
  }

  const row = await loadWorkspace(db, accepted.workspaceId);
  if (row === undefined) return apiError(c, "not_found", "Workspace not found.");

  return c.json(
    await toWorkspace(
      c.env.APP_MASTER_KEY,
      row,
      existing?.role ?? accepted.role,
    ),
  );
});

/* ----------------------------- workspaces --------------------------------- */

app.get("/", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const masterKey = c.env.APP_MASTER_KEY;

  // An API key sees exactly the workspace it was minted for.
  if (session?.kind === "api_key") {
    const row = await loadWorkspace(db, session.workspaceId);
    if (row === undefined) return c.json([] satisfies Workspace[]);
    return c.json([await toWorkspace(masterKey, row, "member")]);
  }

  const { userId } = requireUserSession(session);
  const rows = await db
    .select({ ...workspaceColumns, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);

  return c.json(
    await Promise.all(
      rows.map(({ role, ...row }) => toWorkspace(masterKey, row, role)),
    ),
  );
});

app.post("/", async (c) => {
  const { userId } = requireUserSession(c.get("session"));
  const { name } = await readJson(c, createWorkspaceSchema);
  const db = getDb(c.env.DB);

  const workspaceId = crypto.randomUUID();
  await db.batch([
    db.insert(workspaces).values({ id: workspaceId, name }),
    db.insert(workspaceMembers).values({ workspaceId, userId, role: "owner" }),
  ]);

  const row = await loadWorkspace(db, workspaceId);
  if (row === undefined) {
    return apiError(c, "internal_error", "Workspace could not be created.");
  }
  return c.json(await toWorkspace(c.env.APP_MASTER_KEY, row, "owner"), 201);
});

app.get("/:id", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  const role = await requireWorkspaceRole(db, c.get("session"), id, "member");

  const row = await loadWorkspace(db, id);
  if (row === undefined) return apiError(c, "not_found", "Workspace not found.");
  return c.json(await toWorkspace(c.env.APP_MASTER_KEY, row, role));
});

app.patch("/:id", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  const role = await requireWorkspaceRole(db, c.get("session"), id, "admin");
  const patch = await readJson(c, updateWorkspaceSchema);

  await db
    .update(workspaces)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.spendCapUsd === undefined
        ? {}
        : { spendCapUsd: patch.spendCapUsd }),
    })
    .where(eq(workspaces.id, id));

  const row = await loadWorkspace(db, id);
  if (row === undefined) return apiError(c, "not_found", "Workspace not found.");
  return c.json(await toWorkspace(c.env.APP_MASTER_KEY, row, role));
});

app.delete("/:id", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "owner");
  const { confirmName } = await readJson(c, deleteWorkspaceSchema);

  const row = await loadWorkspace(db, id);
  if (row === undefined) return apiError(c, "not_found", "Workspace not found.");

  if (confirmName !== row.name) {
    return apiError(
      c,
      "bad_request",
      "The confirmation name does not match this workspace.",
    );
  }

  const purged = await deleteWorkspaceEverywhere(
    { db, kv: c.env.CACHE, r2: c.env.BLOBS, masterKey: c.env.APP_MASTER_KEY },
    id,
  );
  return c.json({ deleted: true, purged });
});

/* ----------------------------- credentials -------------------------------- */

app.put("/:id/credentials", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "admin");
  const { login, password } = await readJson(c, credentialsSchema);

  const masterKey = c.env.APP_MASTER_KEY;
  const [dfsLoginEnc, dfsPasswordEnc] = await Promise.all([
    encryptSecret(masterKey, login),
    encryptSecret(masterKey, password),
  ]);

  await db
    .update(workspaces)
    .set({ dfsLoginEnc, dfsPasswordEnc })
    .where(eq(workspaces.id, id));

  // Echo the masked form, never the values that were just stored.
  return c.json(await credentialsSummary(masterKey, dfsLoginEnc, dfsPasswordEnc));
});

app.delete("/:id/credentials", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "admin");

  await db
    .update(workspaces)
    .set({ dfsLoginEnc: null, dfsPasswordEnc: null })
    .where(eq(workspaces.id, id));

  return c.json({ configured: false, login: null } satisfies WorkspaceCredentials);
});

/* ------------------------------- members ---------------------------------- */

app.get("/:id/members", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "member");

  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      email: users.email,
      role: workspaceMembers.role,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, id))
    .orderBy(workspaceMembers.createdAt);

  return c.json(
    rows.map(
      (row): WorkspaceMember => ({
        userId: row.userId,
        email: row.email,
        role: row.role,
        createdAt: row.createdAt.getTime(),
      }),
    ),
  );
});

app.patch("/:id/members/:userId", async (c) => {
  const { id, userId } = readParams(c, memberParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "owner");
  const { role } = await readJson(c, updateMemberSchema);

  const [target] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  if (target === undefined) {
    return apiError(c, "not_found", "That person is not in this workspace.");
  }

  if (target.role === "owner" && role !== "owner" && (await countOwners(db, id)) <= 1) {
    return apiError(
      c,
      "conflict",
      "This is the last owner. Promote someone else before changing this role.",
    );
  }

  await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, id),
        eq(workspaceMembers.userId, userId),
      ),
    );

  return c.json({ userId, role });
});

app.delete("/:id/members/:userId", async (c) => {
  const { id, userId } = readParams(c, memberParams);
  const session = c.get("session");
  const db = getDb(c.env.DB);

  const isSelf = session?.kind === "session" && session.userId === userId;
  // Anyone may leave a workspace; removing someone else needs admin.
  const actorRole = await requireWorkspaceRole(
    db,
    session,
    id,
    isSelf ? "member" : "admin",
  );

  const [target] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);

  if (target === undefined) {
    return apiError(c, "not_found", "That person is not in this workspace.");
  }

  // An admin must not be able to evict an owner.
  if (!isSelf && !roleAtLeast(actorRole, target.role)) {
    return apiError(
      c,
      "forbidden",
      "You cannot remove someone with a higher role than your own.",
    );
  }

  if (target.role === "owner" && (await countOwners(db, id)) <= 1) {
    return apiError(
      c,
      "conflict",
      "This is the last owner. Promote someone else first, or delete the workspace.",
    );
  }

  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, id),
        eq(workspaceMembers.userId, userId),
      ),
    );

  return c.body(null, 204);
});

/* --------------------------- invites (scoped) ------------------------------ */

app.post("/:id/invites", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  const actorRole = await requireWorkspaceRole(db, c.get("session"), id, "admin");
  const { email, role } = await readJson(c, createInviteSchema);

  // Nobody can hand out more power than they hold.
  if (!roleAtLeast(actorRole, role)) {
    return apiError(c, "forbidden", `Only an owner can invite an ${role}.`);
  }

  const [alreadyMember] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, id), eq(users.email, email)))
    .limit(1);

  if (alreadyMember !== undefined) {
    return apiError(c, "conflict", "That person is already in this workspace.");
  }

  const token = randomToken();
  const inviteId = crypto.randomUUID();
  const expiresAt = inviteExpiresAt();

  await db.insert(invites).values({
    id: inviteId,
    workspaceId: id,
    email,
    tokenHash: await sha256Hex(token),
    role,
    expiresAt,
  });

  const [created] = await db
    .select({ createdAt: invites.createdAt })
    .from(invites)
    .where(eq(invites.id, inviteId))
    .limit(1);

  const body: CreatedInvite = {
    id: inviteId,
    email,
    role,
    expiresAt: expiresAt.getTime(),
    createdAt: (created?.createdAt ?? new Date()).getTime(),
    // The only time this token is ever readable.
    inviteUrl: buildInviteUrl(new URL(c.req.url).origin, token),
  };
  return c.json(body, 201);
});

app.get("/:id/invites", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "admin");

  const rows = await db
    .select({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
    })
    .from(invites)
    .where(eq(invites.workspaceId, id))
    .orderBy(invites.createdAt);

  return c.json(
    rows.map(
      (row): WorkspaceInvite => ({
        id: row.id,
        email: row.email,
        role: row.role,
        expiresAt: row.expiresAt.getTime(),
        createdAt: row.createdAt.getTime(),
      }),
    ),
  );
});

app.delete("/:id/invites/:inviteId", async (c) => {
  const { id, inviteId } = readParams(c, inviteParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "admin");

  // The workspace id is part of the predicate, so an invite belonging to
  // another tenant can never be revoked through this path.
  await db
    .delete(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.workspaceId, id)));

  return c.body(null, 204);
});

/* ------------------------------- API keys --------------------------------- */

app.post("/:id/api-keys", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "admin");
  const { name } = await readJson(c, createApiKeySchema);

  const key = `${API_KEY_PREFIX}${randomToken()}`;
  const keyId = crypto.randomUUID();

  await db.insert(apiKeys).values({
    id: keyId,
    workspaceId: id,
    name,
    keyHash: await sha256Hex(key),
  });

  const [created] = await db
    .select({ createdAt: apiKeys.createdAt })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1);

  const body: CreatedApiKey = {
    id: keyId,
    name,
    createdAt: (created?.createdAt ?? new Date()).getTime(),
    lastUsedAt: null,
    // Shown once. Only sha256Hex(key) exists after this response.
    key,
  };
  return c.json(body, 201);
});

app.get("/:id/api-keys", async (c) => {
  const { id } = readParams(c, workspaceParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "admin");

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, id))
    .orderBy(apiKeys.createdAt);

  return c.json(
    rows.map(
      (row): ApiKeySummary => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.getTime(),
        lastUsedAt: row.lastUsedAt?.getTime() ?? null,
      }),
    ),
  );
});

app.delete("/:id/api-keys/:keyId", async (c) => {
  const { id, keyId } = readParams(c, apiKeyParams);
  const db = getDb(c.env.DB);
  await requireWorkspaceRole(db, c.get("session"), id, "admin");

  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.workspaceId, id)));

  return c.body(null, 204);
});

export default app;
