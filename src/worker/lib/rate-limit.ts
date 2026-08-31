/**
 * Attempt throttling for the public auth routes, backed by KV.
 *
 * Every counter is keyed by `sha256Hex(value)`, never the value itself: KV keys
 * show up in dashboards and logs, and neither a list of who has been trying to
 * sign in nor a list of visitors' IP addresses should be readable there.
 *
 * KV is eventually consistent, so this is a deterrent rather than a hard limit —
 * a distributed attacker can race a few extra attempts through. That is the
 * accepted trade for staying on the free plan (no Durable Objects).
 *
 * ## Two dimensions
 *
 * Each protected route counts against **both** an identity (the email address)
 * and an origin (the client IP), and either one tripping is enough to refuse.
 * They catch different attacks and neither subsumes the other:
 *
 *  - per-email stops one account being ground down from a botnet;
 *  - per-IP stops one host working through a stolen credential list, where
 *    every guess is against a different address and no email counter ever
 *    climbs. (Phase 8c; closes the standing per-IP item in docs/BACKLOG.md.)
 *
 * The IP ceilings are deliberately much higher than the email ones, because an
 * IP is not a person: an office, a school, a VPN exit or a mobile carrier NAT
 * can put hundreds of legitimate users behind one address, and a limit tight
 * enough to be interesting would lock all of them out together.
 */

import type { Context } from "hono";

import { sha256Hex } from "./crypto";

/** One counter's identity and ceiling. */
export interface RateLimitRule {
  /** KV key namespace — the route family being protected. */
  readonly scope: string;
  /** Attempts allowed inside the window before the rule refuses. */
  readonly maxAttempts: number;
  /** Sliding window, refreshed by each recorded attempt. */
  readonly windowSeconds: number;
}

/** What a counter is keyed on. Part of the KV key, so the two never collide. */
export type RateLimitDimension = "email" | "ip";

const FIFTEEN_MINUTES = 15 * 60;
const ONE_HOUR = 60 * 60;

/**
 * Login, per email. Unchanged from Phase 0 — ten failed attempts in fifteen
 * minutes, counting failures only.
 */
export const LOGIN_EMAIL_RULE: RateLimitRule = {
  scope: "login",
  maxAttempts: 10,
  windowSeconds: FIFTEEN_MINUTES,
};

/**
 * The per-email login ceiling, spelled out for the public API document, which
 * quotes both numbers to callers (src/worker/openapi.ts). They are re-exported
 * rather than read off the rule at the call site so that document keeps
 * compiling against a named constant if these rules are ever restructured
 * again.
 */
export const LOGIN_MAX_ATTEMPTS = LOGIN_EMAIL_RULE.maxAttempts;
export const LOGIN_WINDOW_SECONDS = LOGIN_EMAIL_RULE.windowSeconds;

/**
 * Login, per IP. Fifty failures in fifteen minutes: far beyond a shared office
 * fumbling its passwords, far below a useful credential-stuffing run.
 */
export const LOGIN_IP_RULE: RateLimitRule = {
  scope: "login",
  maxAttempts: 50,
  windowSeconds: FIFTEEN_MINUTES,
};

/**
 * Password reset, per email. Counts *requests*, not failures — unlike login,
 * every call here is "successful" from the caller's side, and the thing being
 * rationed is mail landing in someone else's inbox. Three in fifteen minutes
 * covers a real person clicking resend; beyond that it is mailbombing.
 */
export const FORGOT_EMAIL_RULE: RateLimitRule = {
  scope: "forgot",
  maxAttempts: 3,
  windowSeconds: FIFTEEN_MINUTES,
};

/**
 * Password reset, per IP. Ten an hour, which one host cannot turn into a
 * mailbombing service by simply varying the address each time.
 */
export const FORGOT_IP_RULE: RateLimitRule = {
  scope: "forgot",
  maxAttempts: 10,
  windowSeconds: ONE_HOUR,
};

/**
 * `rl:<scope>:<dimension>:<sha256 of the value>`.
 *
 * The dimension segment is what keeps an email counter and an IP counter
 * apart inside one scope. It is new in Phase 8c: the Phase-0 login counter was
 * `rl:login:<hash>` with no dimension, so deploying this resets whatever login
 * counters are in flight at that moment. The window is fifteen minutes and the
 * limiter is a deterrent, so the cost is one short spell of leniency, once.
 */
export async function rateLimitKey(
  rule: RateLimitRule,
  dimension: RateLimitDimension,
  value: string,
): Promise<string> {
  return `rl:${rule.scope}:${dimension}:${await sha256Hex(value)}`;
}

/** True once this value has burned every attempt in the current window. */
export async function isRateLimited(
  kv: KVNamespace,
  rule: RateLimitRule,
  dimension: RateLimitDimension,
  value: string,
): Promise<boolean> {
  const raw = await kv.get(await rateLimitKey(rule, dimension, value));
  if (raw === null) return false;
  const attempts = Number.parseInt(raw, 10);
  return Number.isFinite(attempts) && attempts >= rule.maxAttempts;
}

/**
 * Counts one attempt and refreshes the TTL, so a steady stream of attempts
 * keeps the block alive rather than aging out mid-attack.
 */
export async function recordAttempt(
  kv: KVNamespace,
  rule: RateLimitRule,
  dimension: RateLimitDimension,
  value: string,
): Promise<void> {
  const key = await rateLimitKey(rule, dimension, value);
  const raw = await kv.get(key);
  const previous = raw === null ? 0 : Number.parseInt(raw, 10);
  const next = (Number.isFinite(previous) ? previous : 0) + 1;
  await kv.put(key, String(next), { expirationTtl: rule.windowSeconds });
}

export async function clearAttempts(
  kv: KVNamespace,
  rule: RateLimitRule,
  dimension: RateLimitDimension,
  value: string,
): Promise<void> {
  await kv.delete(await rateLimitKey(rule, dimension, value));
}

/* ------------------------------- client IP -------------------------------- */

/**
 * Cloudflare's header for the real client address. It is set by the edge on
 * every request and *overwritten* if a client sends its own, which is what
 * makes it trustworthy — unlike `X-Forwarded-For`, which anyone may forge.
 */
export const CLIENT_IP_HEADER = "cf-connecting-ip";

/**
 * The caller's IP, or null when the header is absent.
 *
 * Null means "do not apply the IP dimension" rather than "bucket everyone
 * together". A shared `unknown` bucket would let one caller exhaust the limit
 * for every visitor at once, turning a missing header into a denial of service
 * against the whole deployment; skipping fails open on a header that only
 * Cloudflare can set, and leaves the per-email limiter — which never depends on
 * it — doing its job.
 */
export function clientIp(c: Context): string | null {
  const raw = c.req.header(CLIENT_IP_HEADER)?.trim();
  return raw === undefined || raw === "" ? null : raw;
}

/* ------------------------------ login helpers ------------------------------ */

/**
 * True when either the address or the origin has been blocked. A null `ip`
 * checks the email dimension alone.
 */
export async function isLoginBlocked(
  kv: KVNamespace,
  email: string,
  ip: string | null,
): Promise<boolean> {
  if (await isRateLimited(kv, LOGIN_EMAIL_RULE, "email", email)) return true;
  if (ip === null) return false;
  return isRateLimited(kv, LOGIN_IP_RULE, "ip", ip);
}

/** Counts one failed sign-in against both dimensions. */
export async function recordFailedLogin(
  kv: KVNamespace,
  email: string,
  ip: string | null,
): Promise<void> {
  await recordAttempt(kv, LOGIN_EMAIL_RULE, "email", email);
  if (ip !== null) await recordAttempt(kv, LOGIN_IP_RULE, "ip", ip);
}

/**
 * A successful sign-in clears the record for that address — and deliberately
 * **not** for the IP.
 *
 * Someone working through a stolen credential list will land a valid account
 * eventually; if that reset the origin's counter, the limiter would hand the
 * attacker a fresh budget at the exact moment it was proving useful. The
 * address is the thing the caller has just proved they own, so it is the only
 * thing forgiven.
 */
export async function clearLoginAttempts(
  kv: KVNamespace,
  email: string,
): Promise<void> {
  await clearAttempts(kv, LOGIN_EMAIL_RULE, "email", email);
}
