/**
 * Shared crypto primitives for OpenRefs. WebCrypto only, so the same code runs
 * in Cloudflare Workers, Node 20+, and vitest without polyfills.
 *
 * Owned by the orchestrator (hand-reviewed). Consumers:
 *  - auth: password hashing, session / API-key / invite tokens
 *  - workspace settings + DataForSEO client: AES-GCM credential storage
 *
 * Formats produced here are persisted in D1 — treat them as frozen. Both carry
 * their own parameters, so algorithms can be upgraded without a migration:
 *  - password hash:    pbkdf2$sha256$<iterations>$<salt b64>$<hash b64>
 *  - encrypted secret: v1$<iv b64>$<ciphertext b64>
 */

const te = new TextEncoder();
const td = new TextDecoder();

/* ----------------------------- encoding ---------------------------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex length must be even");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error("invalid hex");
    out[i] = byte;
  }
  return out;
}

/* ------------------------------ tokens ------------------------------------ */

/**
 * URL-safe random token for sessions, API keys and invite links. The raw value
 * goes to the client; only `sha256Hex(token)` is ever stored.
 */
export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Constant-time comparison for equal-purpose strings (token hashes). Length is
 * the only thing an attacker can learn.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = te.encode(a);
  const bb = te.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

/* ------------------------- password hashing ------------------------------- */

/**
 * The Cloudflare Workers runtime refuses PBKDF2 above 100,000 iterations
 * (NotSupportedError) — this is the platform maximum, not a tunable. Do not
 * raise it: local dev (workerd via the Vite plugin) does NOT enforce the cap,
 * so a higher value passes every local test and then 500s in production.
 * The stored format records its iteration count, so existing hashes keep
 * verifying if this constant ever changes.
 */
export const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH_BYTES = 32;
const SALT_BYTES = 16;

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    PBKDF2_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Non-default `iterations` is for tests only. */
export async function hashPassword(
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, iterations);
  return [
    "pbkdf2",
    "sha256",
    String(iterations),
    bytesToBase64(salt),
    bytesToBase64(hash),
  ].join("$");
}

/**
 * Verifies against the iteration count recorded in `stored`, so old hashes
 * keep working if PBKDF2_ITERATIONS is raised later. Returns false (never
 * throws) on malformed input.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") {
    return false;
  }
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) {
    return false;
  }
  let salt: Uint8Array;
  let expected: Uint8Array;
  let actual: Uint8Array;
  try {
    salt = base64ToBytes(parts[3] ?? "");
    expected = base64ToBytes(parts[4] ?? "");
    // deriveBits itself can reject (e.g. a stored hash above the runtime's
    // iteration cap) — an unverifiable hash is a failed login, not a 500.
    actual = await pbkdf2(password, salt, iterations);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

/* ------------------- AES-256-GCM secrets at rest --------------------------- */

const IV_BYTES = 12;

async function importMasterKey(masterKeyHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(masterKeyHex);
  if (raw.length !== 32) {
    throw new Error("APP_MASTER_KEY must be 32 bytes of hex (64 characters)");
  }
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(
  masterKeyHex: string,
  plaintext: string,
): Promise<string> {
  const key = await importMasterKey(masterKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    te.encode(plaintext),
  );
  return ["v1", bytesToBase64(iv), bytesToBase64(new Uint8Array(ct))].join("$");
}

/** Throws on tampering (GCM auth failure), wrong key, or unknown format. */
export async function decryptSecret(
  masterKeyHex: string,
  stored: string,
): Promise<string> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("unrecognized secret format");
  }
  const key = await importMasterKey(masterKeyHex);
  const iv = base64ToBytes(parts[1] ?? "");
  const ct = base64ToBytes(parts[2] ?? "");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return td.decode(pt);
}

/* ---------------- keyed MACs derived from the master key ------------------- */

/**
 * An HMAC-SHA256 key derived from `APP_MASTER_KEY` for one named purpose.
 *
 * **Why derive rather than use the master key directly.** `APP_MASTER_KEY` is
 * already the AES-256-GCM key that encrypts every secret at rest. Using the
 * same 32 bytes as an HMAC key would mean one key doing two cryptographic jobs
 * — an attacker with a signing oracle would be probing the same material that
 * protects the DataForSEO and Google credentials. HKDF gives each purpose an
 * independent key that reveals nothing about the master or about its siblings.
 *
 * The derivation is HKDF-SHA256 (RFC 5869) over the raw 32 master bytes, with
 * an **empty salt** and the purpose string as `info`. An empty salt is the
 * RFC's documented default and is safe here because the input keying material
 * is already a uniformly random 256-bit key rather than a low-entropy
 * password; `info` is what separates the purposes, so two callers passing
 * different `info` can never derive the same key.
 *
 * `info` is part of the derivation, so changing a purpose string invalidates
 * every token signed under the old one. Version them (`...:v1`) and treat a
 * change as a rotation.
 */
export async function deriveHmacKey(
  masterKeyHex: string,
  info: string,
): Promise<CryptoKey> {
  const raw = hexToBytes(masterKeyHex);
  if (raw.length !== 32) {
    throw new Error("APP_MASTER_KEY must be 32 bytes of hex (64 characters)");
  }
  const ikm = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0) as BufferSource,
      info: te.encode(info) as BufferSource,
    },
    ikm,
    256,
  );
  return crypto.subtle.importKey("raw", bits, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

/** Raw HMAC-SHA256 tag over `message`, using a key from `deriveHmacKey`. */
export async function hmacSha256(
  key: CryptoKey,
  message: string,
): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign("HMAC", key, te.encode(message));
  return new Uint8Array(sig);
}

/* ------------------------------ base64url --------------------------------- */

/**
 * base64url (RFC 4648 §5) — the alphabet URLs and OAuth `state` need, since
 * standard base64's `+`, `/` and `=` all have to be percent-encoded otherwise.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Inverse of `bytesToBase64Url`. Throws on characters outside the alphabet. */
export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error("not base64url");
  }
  const b64 = value.replaceAll("-", "+").replaceAll("_", "/");
  // atob wants the padding back; the length mod 4 says how much was stripped.
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return base64ToBytes(b64 + pad);
}
