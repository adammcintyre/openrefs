import { describe, expect, it } from "vitest";

import { bytesToBase64Url } from "../lib/crypto";
import {
  OAUTH_STATE_MAX_TTL_SECONDS,
  createOAuthState,
  verifyOAuthState,
} from "./state";

/** Never a real key. 64 hex characters, as `deriveHmacKey` requires. */
const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

const BINDING = {
  userId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  projectId: "33333333-3333-4333-8333-333333333333",
};

const NOW = new Date("2026-08-29T12:00:00.000Z");

const te = new TextEncoder();

/** Swaps in a payload without touching the signature — the forger's move. */
function withPayload(token: string, payload: unknown): string {
  const [version, , signature] = token.split(".") as [string, string, string];
  const encoded = bytesToBase64Url(te.encode(JSON.stringify(payload)));
  return `${version}.${encoded}.${signature}`;
}

describe("createOAuthState / verifyOAuthState", () => {
  it("round-trips the binding the callback will act on", async () => {
    const token = await createOAuthState(KEY, BINDING, { now: NOW });
    const result = await verifyOAuthState(KEY, token, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject(BINDING);
  });

  it("stamps an expiry inside the ten-minute ceiling", async () => {
    const token = await createOAuthState(KEY, BINDING, { now: NOW });
    const result = await verifyOAuthState(KEY, token, { now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lifetime = result.payload.exp - Math.floor(NOW.getTime() / 1000);
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(OAUTH_STATE_MAX_TTL_SECONDS);
  });

  it("produces a URL-safe token — no percent-encoding needed", async () => {
    const token = await createOAuthState(KEY, BINDING, { now: NOW });
    expect(token).toMatch(/^g1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("is unforgeable without the key — a fresh signature over the same payload", async () => {
    // The whole point: an attacker who knows the format and the payload still
    // cannot mint a token, because they do not have APP_MASTER_KEY.
    const attacker = await createOAuthState(OTHER_KEY, BINDING, { now: NOW });
    await expect(
      verifyOAuthState(KEY, attacker, { now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a payload swapped under a valid signature", async () => {
    // The attack this token exists to stop: keep a signature that verified for
    // someone else's flow, point it at a project you want to hijack.
    const token = await createOAuthState(KEY, BINDING, { now: NOW });
    const hijacked = withPayload(token, {
      ...BINDING,
      projectId: "victim-project",
      exp: Math.floor(NOW.getTime() / 1000) + 300,
    });

    await expect(
      verifyOAuthState(KEY, hijacked, { now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses an extended expiry — `exp` is signed, not advisory", async () => {
    const token = await createOAuthState(KEY, BINDING, { now: NOW });
    const extended = withPayload(token, {
      ...BINDING,
      exp: Math.floor(NOW.getTime() / 1000) + 86_400,
    });

    await expect(
      verifyOAuthState(KEY, extended, { now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a single flipped character in the signature", async () => {
    const token = await createOAuthState(KEY, BINDING, { now: NOW });
    const [version, payload, signature] = token.split(".") as [
      string,
      string,
      string,
    ];
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);

    await expect(
      verifyOAuthState(KEY, `${version}.${payload}.${flipped}`, { now: NOW }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a truncated signature rather than comparing a prefix", async () => {
    const token = await createOAuthState(KEY, BINDING, { now: NOW });
    const [version, payload, signature] = token.split(".") as [
      string,
      string,
      string,
    ];

    await expect(
      verifyOAuthState(KEY, `${version}.${payload}.${signature.slice(0, 10)}`, {
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a token moved to another format version", async () => {
    // The version is inside the signed message, so re-labelling breaks the MAC
    // *and* the version check. Either rejection is fine; being rejected is not
    // optional.
    const token = await createOAuthState(KEY, BINDING, { now: NOW });
    const [, payload, signature] = token.split(".") as [string, string, string];

    const result = await verifyOAuthState(KEY, `g2.${payload}.${signature}`, {
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("expires — one second past `exp` is dead", async () => {
    const token = await createOAuthState(KEY, BINDING, {
      now: NOW,
      ttlSeconds: 60,
    });

    const justAlive = new Date(NOW.getTime() + 59_000);
    await expect(
      verifyOAuthState(KEY, token, { now: justAlive }),
    ).resolves.toMatchObject({ ok: true });

    const dead = new Date(NOW.getTime() + 61_000);
    await expect(verifyOAuthState(KEY, token, { now: dead })).resolves.toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("treats the expiry instant itself as expired", async () => {
    const token = await createOAuthState(KEY, BINDING, {
      now: NOW,
      ttlSeconds: 60,
    });
    const atExpiry = new Date(NOW.getTime() + 60_000);
    await expect(
      verifyOAuthState(KEY, token, { now: atExpiry }),
    ).resolves.toEqual({ ok: false, reason: "expired" });
  });

  it("refuses to mint a token that outlives the ten-minute ceiling", async () => {
    await expect(
      createOAuthState(KEY, BINDING, {
        now: NOW,
        ttlSeconds: OAUTH_STATE_MAX_TTL_SECONDS + 1,
      }),
    ).rejects.toThrow(RangeError);
    await expect(
      createOAuthState(KEY, BINDING, { now: NOW, ttlSeconds: 0 }),
    ).rejects.toThrow(RangeError);
  });

  it.each([
    ["empty", ""],
    ["no separators", "notatoken"],
    ["two parts", "g1.abc"],
    ["four parts", "g1.abc.def.ghi"],
    ["empty payload", "g1..sig"],
    ["empty signature", "g1.cGF5.'"],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.c2ln"],
  ])("refuses a %s token", async (_label, token) => {
    const result = await verifyOAuthState(KEY, token, { now: NOW });
    expect(result.ok).toBe(false);
  });

  it("refuses an authentic signature over a payload missing a field", async () => {
    // Signed by us, so the MAC passes — the strict schema is what stops it.
    const bad = await signedPayload({ userId: "u", workspaceId: "w", exp: 99 });
    await expect(verifyOAuthState(KEY, bad, { now: NOW })).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses an authentic signature carrying extra fields", async () => {
    const bad = await signedPayload({
      ...BINDING,
      exp: Math.floor(NOW.getTime() / 1000) + 300,
      role: "owner",
    });
    await expect(verifyOAuthState(KEY, bad, { now: NOW })).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses an authentic signature over non-JSON", async () => {
    const bad = await signedRaw("this is not json");
    await expect(verifyOAuthState(KEY, bad, { now: NOW })).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("gives two tokens for the same binding different signatures", async () => {
    // Different `exp` values, so identical bindings a second apart do not
    // produce a replayable constant.
    const first = await createOAuthState(KEY, BINDING, { now: NOW });
    const second = await createOAuthState(KEY, BINDING, {
      now: new Date(NOW.getTime() + 1000),
    });
    expect(first).not.toBe(second);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Mints a token whose signature is genuine but whose payload is whatever the
 * test wants — the only way to exercise the checks that run *after* the MAC.
 */
async function signedPayload(payload: unknown): Promise<string> {
  return signedRaw(JSON.stringify(payload));
}

async function signedRaw(body: string): Promise<string> {
  const { deriveHmacKey, hmacSha256 } = await import("../lib/crypto");
  const encoded = bytesToBase64Url(te.encode(body));
  const key = await deriveHmacKey(KEY, "openrefs:gsc:oauth-state:v1");
  const signature = bytesToBase64Url(await hmacSha256(key, `g1.${encoded}`));
  return `g1.${encoded}.${signature}`;
}
