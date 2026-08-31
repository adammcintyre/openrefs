/**
 * The password-reset flow end to end at the HTTP layer (Phase 8c): what each
 * route answers, what it writes, and what it refuses to disclose.
 *
 * Guard/mount coverage for the auth module lives in routes.test.ts; this file
 * is about the reset lifecycle specifically, because every interesting rule in
 * it is a *combination* — 202 whatever the address, one live link per user,
 * and a redemption that also ends every session.
 *
 * D1 is faked rather than run. The doubles implement exactly the builder chains
 * these two handlers call and record the mutations, which is enough to assert
 * the things that matter here: that the delete of older resets is batched with
 * the insert, and that redeeming one deletes the user's sessions. `getDb` is
 * mocked because it constructs a real drizzle client from a binding; the table
 * objects stay real so an op can be identified by the table it names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { passwordResets, sessions, users, type Db } from "../../db";
import { createApp } from "../app";
import { sha256Hex } from "../lib/crypto";
import { sendEmailInBackground } from "../lib/email";
import { PASSWORD_RESET_TTL_MS } from "../lib/password-reset";
import { FORGOT_IP_RULE } from "../lib/rate-limit";
import { API_PREFIX } from "./index";

/* --------------------------------- doubles -------------------------------- */

/** One recorded mutation. `table` is the real drizzle table object. */
interface RecordedOp {
  kind: "insert" | "update" | "delete";
  table: unknown;
  values?: Record<string, unknown>;
}

/**
 * A Db that answers selects from a per-table fixture and records every
 * mutation in call order.
 *
 * Mutations record themselves when the chain is *built* rather than when it is
 * awaited, because both handlers hand their builders to `db.batch()` instead of
 * awaiting them individually. The array literal is evaluated in source order,
 * so `ops` still reflects the order the handler wrote them in — which is the
 * thing worth asserting, since the delete-then-insert pairing is what keeps a
 * user from being left with no live link at all.
 */
function fakeDb(rowsByTable: Map<unknown, unknown[]>): {
  db: Db;
  ops: RecordedOp[];
} {
  const ops: RecordedOp[] = [];

  const record = (op: RecordedOp): unknown => {
    ops.push(op);
    return { then: (resolve: (value: unknown) => unknown) => resolve(undefined) };
  };

  const selectFrom = (table: unknown): unknown => {
    const rows = rowsByTable.get(table) ?? [];
    const chain: Record<string, unknown> = {
      innerJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown[]) => unknown) => resolve(rows),
    };
    return chain;
  };

  const db = {
    select: () => ({ from: selectFrom }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) =>
        record({ kind: "insert", table, values }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => record({ kind: "update", table, values }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => record({ kind: "delete", table }),
    }),
    batch: async () => [],
  } as unknown as Db;

  return { db, ops };
}

class FakeKv {
  readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/* --------------------------------- mocks ---------------------------------- */

let current: { db: Db; ops: RecordedOp[] };

vi.mock("../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db")>();
  return { ...actual, getDb: () => current.db };
});

/*
 * The seam is mocked so the test can read the link the user would have been
 * mailed — deliberately the only way to get it, since the console provider
 * refuses to log message bodies and this suite must not weaken that.
 */
vi.mock("../lib/email", () => ({
  sendEmailInBackground: vi.fn(),
  sendEmail: vi.fn(async () => ({ sent: true })),
  isEmailConfigured: vi.fn(() => false),
}));

const mockSendInBackground = vi.mocked(sendEmailInBackground);

/* --------------------------------- harness -------------------------------- */

const app = createApp();
const USER_ID = "8f8f0b9e-1f3a-4a2e-9a1a-9a2b3c4d5e6f";
const EMAIL = "ada@example.com";
const PASSWORD = "correct-horse-battery";
const IP = "203.0.113.7";

let kv: FakeKv;

function envWith(): Env {
  return {
    APP_ENV: "development",
    DB: {} as D1Database,
    CACHE: kv as unknown as KVNamespace,
  } as Env;
}

function post(path: string, body: unknown, ip: string | null = IP) {
  return app.request(
    `${API_PREFIX}${path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ip === null ? {} : { "cf-connecting-ip": ip }),
      },
      body: JSON.stringify(body),
    },
    envWith(),
  );
}

/** Fixtures for a user who exists. */
function knownUser(): Map<unknown, unknown[]> {
  return new Map([[users, [{ id: USER_ID, email: EMAIL }]]]);
}

/** A `password_resets` row joined to its user, as `/auth/reset` selects it. */
function resetRow(overrides: Partial<{ expiresAt: Date; usedAt: Date | null }> = {}) {
  return {
    id: "reset-1",
    userId: USER_ID,
    email: EMAIL,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    usedAt: null,
    ...overrides,
  };
}

/** The token out of the link the user was mailed. */
function issuedToken(): string {
  const message = mockSendInBackground.mock.calls.at(-1)?.[1];
  const match = /\/reset\/(\S+)/.exec(message?.text ?? "");
  if (match?.[1] === undefined) throw new Error("no reset link was emailed");
  return match[1];
}

beforeEach(() => {
  kv = new FakeKv();
  current = fakeDb(new Map());
  mockSendInBackground.mockReset();
});

/* ------------------------------ POST /forgot ------------------------------ */

describe("POST /auth/forgot", () => {
  it("answers 202 for an address nobody has registered", async () => {
    const res = await post("/auth/forgot", { email: "nobody@example.com" });

    expect(res.status).toBe(202);
    // Nothing written, nothing mailed — and no way to tell from out here.
    expect(current.ops).toHaveLength(0);
    expect(mockSendInBackground).not.toHaveBeenCalled();
  });

  it("answers 202 for an address that exists — byte for byte the same reply", async () => {
    current = fakeDb(knownUser());
    const known = await post("/auth/forgot", { email: EMAIL });

    current = fakeDb(new Map());
    const unknown = await post("/auth/forgot", { email: "nobody@example.com" });

    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
  });

  it("stores only the hash of the token it mails", async () => {
    current = fakeDb(knownUser());
    await post("/auth/forgot", { email: EMAIL });

    const insert = current.ops.find((op) => op.kind === "insert");
    expect(insert?.table).toBe(passwordResets);
    expect(insert?.values?.userId).toBe(USER_ID);

    // The link is readable exactly once, in the mail; D1 gets the digest.
    const token = issuedToken();
    expect(insert?.values?.tokenHash).toBe(await sha256Hex(token));
    expect(JSON.stringify(insert?.values)).not.toContain(token);
  });

  it("expires the new link an hour out", async () => {
    current = fakeDb(knownUser());
    const before = Date.now();
    await post("/auth/forgot", { email: EMAIL });

    const insert = current.ops.find((op) => op.kind === "insert");
    const expiresAt = insert?.values?.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + PASSWORD_RESET_TTL_MS);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + PASSWORD_RESET_TTL_MS);
  });

  it("invalidates the user's older links in the same batch that issues the new one", async () => {
    current = fakeDb(knownUser());
    await post("/auth/forgot", { email: EMAIL });

    // Delete first, insert second: a user who clicks resend three times holds
    // exactly one live link, the newest.
    expect(current.ops.map((op) => op.kind)).toEqual(["delete", "insert"]);
    expect(current.ops[0]?.table).toBe(passwordResets);
  });

  it("mails a link on this deployment's own origin", async () => {
    current = fakeDb(knownUser());
    await post("/auth/forgot", { email: EMAIL });

    const message = mockSendInBackground.mock.calls[0]?.[1];
    expect(message?.to).toBe(EMAIL);
    expect(message?.text).toContain("http://localhost/reset/");
  });

  it("stops issuing links once the address hits its ceiling — still 202", async () => {
    current = fakeDb(knownUser());
    for (let i = 0; i < 3; i++) await post("/auth/forgot", { email: EMAIL });

    mockSendInBackground.mockReset();
    current = fakeDb(knownUser());
    const res = await post("/auth/forgot", { email: EMAIL });

    // A 429 here would answer the question the 202 exists to refuse.
    expect(res.status).toBe(202);
    expect(current.ops).toHaveLength(0);
    expect(mockSendInBackground).not.toHaveBeenCalled();
  });

  it("stops one host mailbombing by varying the address", async () => {
    // Every request a different address, so no email counter ever climbs —
    // only the per-IP dimension can catch this.
    for (let i = 0; i < FORGOT_IP_RULE.maxAttempts; i++) {
      current = fakeDb(knownUser());
      await post("/auth/forgot", { email: `victim-${i}@example.com` });
      expect(current.ops).toHaveLength(2);
    }

    mockSendInBackground.mockReset();
    current = fakeDb(knownUser());
    const res = await post("/auth/forgot", { email: "victim-999@example.com" });

    expect(res.status).toBe(202);
    expect(current.ops).toHaveLength(0);
    expect(mockSendInBackground).not.toHaveBeenCalled();
  });

  it("still limits per address when there is no client IP", async () => {
    current = fakeDb(knownUser());
    for (let i = 0; i < 3; i++) {
      await post("/auth/forgot", { email: EMAIL }, null);
    }

    current = fakeDb(knownUser());
    await post("/auth/forgot", { email: EMAIL }, null);
    expect(current.ops).toHaveLength(0);
  });

  it("rejects a malformed body before doing anything", async () => {
    const res = await post("/auth/forgot", { email: "not-an-email" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code: "validation_failed" },
    });
  });
});

/* ------------------------------- POST /reset ------------------------------ */

describe("POST /auth/reset", () => {
  const body = { token: "a-token", password: "a-brand-new-password" };

  it("410s an unknown token", async () => {
    const res = await post("/auth/reset", body);

    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: { code: "reset_invalid" } });
  });

  it("410s a token that has already been redeemed", async () => {
    current = fakeDb(new Map([[passwordResets, [resetRow({ usedAt: new Date() })]]]));
    const res = await post("/auth/reset", body);

    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: { code: "reset_invalid" } });
    // Nothing was written on the way to refusing.
    expect(current.ops).toHaveLength(0);
  });

  it("410s a token past its hour", async () => {
    current = fakeDb(
      new Map([[passwordResets, [resetRow({ expiresAt: new Date(Date.now() - 1) })]]]),
    );
    const res = await post("/auth/reset", body);

    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: { code: "reset_invalid" } });
  });

  it("answers unknown, used and expired with one indistinguishable code", async () => {
    // Three states, one answer: a caller holding a dead link learns only that
    // it is dead.
    const states = [
      new Map(),
      new Map([[passwordResets, [resetRow({ usedAt: new Date() })]]]),
      new Map([[passwordResets, [resetRow({ expiresAt: new Date(Date.now() - 1) })]]]),
    ];

    const bodies: string[] = [];
    for (const rows of states) {
      current = fakeDb(rows as Map<unknown, unknown[]>);
      const res = await post("/auth/reset", body);
      expect(res.status).toBe(410);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("sets a new password hash, stamps the row used, and deletes every session", async () => {
    current = fakeDb(new Map([[passwordResets, [resetRow()]]]));
    const res = await post("/auth/reset", body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [passwordUpdate, stamp, sessionWipe] = current.ops;

    expect(passwordUpdate).toMatchObject({ kind: "update", table: users });
    // The format crypto.ts owns — never the password itself.
    expect(String(passwordUpdate?.values?.passwordHash)).toMatch(/^pbkdf2\$sha256\$/);
    expect(String(passwordUpdate?.values?.passwordHash)).not.toContain(body.password);

    // Stamped rather than deleted, so a second click gets 410 from a row that
    // remembers being used.
    expect(stamp).toMatchObject({ kind: "update", table: passwordResets });
    expect(stamp?.values?.usedAt).toBeInstanceOf(Date);

    /*
     * The reason a reset is a useful answer to a compromise: whoever was
     * holding a session on this account loses it. Without this, an intruder
     * keeps their cookie and the victim has changed nothing that matters.
     */
    expect(sessionWipe).toMatchObject({ kind: "delete", table: sessions });
  });

  it("does not sign the resetter in — it clears their cookie instead", async () => {
    current = fakeDb(new Map([[passwordResets, [resetRow()]]]));
    const res = await post("/auth/reset", body);

    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toContain("orf_session=");
    // An expiry in the past is a deletion; nothing hands out a fresh session.
    expect(cookies).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it("forgives the login limiter for that address", async () => {
    // Someone who locked themselves out guessing has almost certainly just
    // reset for exactly that reason.
    const { LOGIN_EMAIL_RULE, rateLimitKey } = await import("../lib/rate-limit");
    const key = await rateLimitKey(LOGIN_EMAIL_RULE, "email", EMAIL);
    kv.store.set(key, "10");

    current = fakeDb(new Map([[passwordResets, [resetRow()]]]));
    await post("/auth/reset", body);

    expect(kv.store.has(key)).toBe(false);
  });

  it("holds a new password to the same floor registration does", async () => {
    const res = await post("/auth/reset", { token: "a-token", password: "short" });

    expect(res.status).toBe(422);
    const failure = (await res.json()) as {
      error: { details?: { fieldErrors?: Record<string, string[]> } };
    };
    expect(failure.error.details?.fieldErrors).toHaveProperty("password");
  });

  it("validates before looking anything up", async () => {
    current = fakeDb(new Map([[passwordResets, [resetRow()]]]));
    const res = await post("/auth/reset", { token: "" , password: PASSWORD });

    expect(res.status).toBe(422);
    expect(current.ops).toHaveLength(0);
  });
});
