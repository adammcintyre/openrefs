/**
 * Login throttling, backed by KV.
 *
 * The counter is keyed by `sha256Hex(email)`, never the address itself: KV keys
 * show up in dashboards and logs, and a list of who has been trying to sign in
 * is exactly the kind of thing that should not be readable there.
 *
 * KV is eventually consistent, so this is a deterrent rather than a hard limit —
 * a distributed attacker can race a few extra attempts through. That is the
 * accepted trade for staying on the free plan (no Durable Objects).
 */

import { sha256Hex } from "./crypto";

export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

export async function loginAttemptsKey(email: string): Promise<string> {
  return `rl:login:${await sha256Hex(email)}`;
}

/** True once the caller has burned every attempt in the current window. */
export async function isLoginBlocked(
  kv: KVNamespace,
  email: string,
): Promise<boolean> {
  const raw = await kv.get(await loginAttemptsKey(email));
  if (raw === null) return false;
  const attempts = Number.parseInt(raw, 10);
  return Number.isFinite(attempts) && attempts >= LOGIN_MAX_ATTEMPTS;
}

/**
 * Counts one failed attempt and refreshes the TTL, so a steady stream of
 * guesses keeps the block alive rather than aging out mid-attack.
 */
export async function recordFailedLogin(
  kv: KVNamespace,
  email: string,
): Promise<void> {
  const key = await loginAttemptsKey(email);
  const raw = await kv.get(key);
  const previous = raw === null ? 0 : Number.parseInt(raw, 10);
  const next = (Number.isFinite(previous) ? previous : 0) + 1;
  await kv.put(key, String(next), { expirationTtl: LOGIN_WINDOW_SECONDS });
}

/** A successful sign-in clears the record for that address. */
export async function clearLoginAttempts(
  kv: KVNamespace,
  email: string,
): Promise<void> {
  await kv.delete(await loginAttemptsKey(email));
}
