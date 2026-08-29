/**
 * The OAuth `state` parameter for the Search Console connect flow.
 *
 * `state` makes a round trip through Google and comes back on a plain GET that
 * anyone can forge, so it is the one place in this flow where trusting the
 * query string would be a real vulnerability: without a signature, anybody who
 * could talk a signed-in admin into loading a crafted `/gsc/callback?...` URL
 * could bind **their own** Google account to **that admin's** project, and from
 * then on the project's "Search Console data" would be the attacker's — a
 * classic OAuth login-CSRF, inverted. Every field the callback acts on
 * therefore comes out of a token this Worker signed, never out of `c.req.query`.
 *
 * Format — three dot-separated parts, all base64url:
 *
 *     g1.<payload>.<signature>
 *      │      │          └── HMAC-SHA256 over the literal string "g1.<payload>"
 *      │      └───────────── JSON { userId, workspaceId, projectId, exp }
 *      └──────────────────── format version, covered by the signature
 *
 * The version prefix is inside the signed message on purpose: signing only the
 * payload would let an attacker move a valid payload to a future format whose
 * rules are laxer. Bumping to `g2` invalidates every outstanding `g1` token,
 * which for a ten-minute credential is exactly the right blast radius.
 *
 * The signing key is derived from `APP_MASTER_KEY` via HKDF — see
 * `deriveHmacKey` in ../lib/crypto.ts for why it is derived and not reused.
 * The primitives live there (ARCHITECTURE.md: crypto goes in one file); this
 * module owns only the token *format* and its validity rules.
 */
import { z } from "zod";

import {
  base64UrlToBytes,
  bytesToBase64Url,
  deriveHmacKey,
  hmacSha256,
  timingSafeEqual,
} from "../lib/crypto";

const te = new TextEncoder();
const td = new TextDecoder();

/** Current format version. Part of the signed message. */
const STATE_VERSION = "g1";

/**
 * HKDF `info`. Changing this string rotates the signing key and invalidates
 * every outstanding state token — see `deriveHmacKey`.
 */
export const STATE_HKDF_INFO = "openrefs:gsc:oauth-state:v1";

/**
 * Hard ceiling on a state token's life, from docs/specs/PHASE5.md ("expiry
 * ≤ 10 min"). This is a CSRF nonce that a human uses once, immediately —
 * the only reason it lives at all is the seconds spent on Google's consent
 * screen. `createOAuthState` refuses a longer TTL rather than silently
 * clamping, so a caller that asks for an hour finds out at the call site.
 */
export const OAUTH_STATE_MAX_TTL_SECONDS = 600;

/** Default TTL. The full ten minutes: consent screens can involve a login. */
export const OAUTH_STATE_TTL_SECONDS = OAUTH_STATE_MAX_TTL_SECONDS;

/** What the callback is allowed to believe about a request it did not see start. */
export interface OAuthStatePayload {
  /** The admin who clicked Connect. The callback checks the session matches. */
  userId: string;
  workspaceId: string;
  projectId: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

/**
 * Parsed strictly: an unknown field, a missing field or a non-integer `exp` is
 * a rejected token, not a token with defaults filled in. This runs on
 * attacker-reachable input, so the schema is the boundary.
 */
const payloadSchema = z
  .object({
    userId: z.string().min(1),
    workspaceId: z.string().min(1),
    projectId: z.string().min(1),
    exp: z.number().int().positive(),
  })
  .strict();

/** Why a token was refused. Distinguished for logging, never for the user. */
export type OAuthStateFailure = "malformed" | "bad_signature" | "expired";

export type OAuthStateResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: OAuthStateFailure };

function signingKey(masterKeyHex: string): Promise<CryptoKey> {
  return deriveHmacKey(masterKeyHex, STATE_HKDF_INFO);
}

/**
 * Signs `{ userId, workspaceId, projectId }` with an expiry `ttlSeconds` from
 * `now`.
 *
 * @throws RangeError if `ttlSeconds` exceeds `OAUTH_STATE_MAX_TTL_SECONDS`.
 */
export async function createOAuthState(
  masterKeyHex: string,
  binding: Omit<OAuthStatePayload, "exp">,
  options: { now?: Date; ttlSeconds?: number } = {},
): Promise<string> {
  const { now = new Date(), ttlSeconds = OAUTH_STATE_TTL_SECONDS } = options;
  if (ttlSeconds <= 0 || ttlSeconds > OAUTH_STATE_MAX_TTL_SECONDS) {
    throw new RangeError(
      `OAuth state TTL must be 1..${OAUTH_STATE_MAX_TTL_SECONDS}s (asked for ${ttlSeconds}s)`,
    );
  }

  const payload: OAuthStatePayload = {
    ...binding,
    exp: Math.floor(now.getTime() / 1000) + ttlSeconds,
  };
  const encoded = bytesToBase64Url(te.encode(JSON.stringify(payload)));
  const message = `${STATE_VERSION}.${encoded}`;
  const key = await signingKey(masterKeyHex);
  const signature = bytesToBase64Url(await hmacSha256(key, message));
  return `${message}.${signature}`;
}

/**
 * Verifies a token and returns its binding.
 *
 * Order matters: **signature before payload**. The JSON is only parsed once
 * the MAC proves this Worker produced it, so a forged token can never reach
 * `JSON.parse` or the zod schema with attacker-chosen structure. Expiry is
 * checked last, because an expired token is still an authentic one and saying
 * so requires having authenticated it.
 */
export async function verifyOAuthState(
  masterKeyHex: string,
  token: string,
  options: { now?: Date } = {},
): Promise<OAuthStateResult> {
  const { now = new Date() } = options;

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [version, encoded, signature] = parts as [string, string, string];
  if (version !== STATE_VERSION) return { ok: false, reason: "malformed" };
  if (encoded === "" || signature === "") {
    return { ok: false, reason: "malformed" };
  }

  let expected: string;
  try {
    const key = await signingKey(masterKeyHex);
    expected = bytesToBase64Url(
      await hmacSha256(key, `${version}.${encoded}`),
    );
  } catch {
    // A malformed APP_MASTER_KEY. Refusing every token is the right failure —
    // it is not this function's job to decide the deployment is misconfigured.
    return { ok: false, reason: "bad_signature" };
  }
  // Constant-time: both sides are fixed-length base64url of a 32-byte tag, so
  // only a length mismatch (already a rejection) leaks anything.
  if (!timingSafeEqual(expected, signature)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: OAuthStatePayload;
  try {
    const json: unknown = JSON.parse(td.decode(base64UrlToBytes(encoded)));
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: "malformed" };
    payload = parsed.data;
  } catch {
    // Authentic signature over a body we cannot read: only reachable if a past
    // version of this code signed a different shape. Treat as malformed.
    return { ok: false, reason: "malformed" };
  }

  if (payload.exp * 1000 <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}
