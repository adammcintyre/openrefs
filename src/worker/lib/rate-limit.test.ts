/**
 * The auth limiter, and in particular the per-IP dimension added in Phase 8c
 * (docs/BACKLOG.md, "Login rate limiting is per-email only").
 *
 * Three things here are load-bearing rather than incidental:
 *
 *  - Counters are keyed by hash. KV keys are readable in the dashboard, and
 *    neither "who has been trying to sign in" nor "who has been visiting"
 *    belongs there.
 *  - The two dimensions are independent. An email counter must not be moved by
 *    traffic from an IP, or a busy office would lock out one of its own users.
 *  - A successful sign-in forgives the *address only*. The IP keeps its count,
 *    because an attacker working a credential list will eventually land a real
 *    account, and forgiving the origin there would hand them a fresh budget at
 *    the exact moment the limiter was starting to bite.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "./crypto";
import {
  clearLoginAttempts,
  clientIp,
  FORGOT_EMAIL_RULE,
  FORGOT_IP_RULE,
  isLoginBlocked,
  isRateLimited,
  LOGIN_EMAIL_RULE,
  LOGIN_IP_RULE,
  rateLimitKey,
  recordAttempt,
  recordFailedLogin,
  type RateLimitRule,
} from "./rate-limit";

const EMAIL = "ada@example.com";
const IP = "203.0.113.7";

/**
 * KV double. `expirationTtl` is recorded because the window is what makes the
 * limiter release its grip; a put that dropped it would block an address
 * forever and no other assertion here would notice.
 */
class FakeKv {
  readonly store = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, value);
    this.ttls.set(key, options?.expirationTtl);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.ttls.delete(key);
  }
}

function fakeKv(): { kv: KVNamespace; fake: FakeKv } {
  const fake = new FakeKv();
  return { kv: fake as unknown as KVNamespace, fake };
}

/** Burns `times` attempts against one counter. */
async function burn(
  kv: KVNamespace,
  rule: RateLimitRule,
  dimension: "email" | "ip",
  value: string,
  times: number,
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await recordAttempt(kv, rule, dimension, value);
  }
}

describe("rateLimitKey", () => {
  it("stores a hash, never the address or the IP", async () => {
    const emailKey = await rateLimitKey(LOGIN_EMAIL_RULE, "email", EMAIL);
    const ipKey = await rateLimitKey(LOGIN_IP_RULE, "ip", IP);

    expect(emailKey).not.toContain(EMAIL);
    expect(emailKey).not.toContain("ada");
    expect(ipKey).not.toContain(IP);

    expect(emailKey).toBe(`rl:login:email:${await sha256Hex(EMAIL)}`);
    expect(ipKey).toBe(`rl:login:ip:${await sha256Hex(IP)}`);
  });

  it("separates the dimensions inside one scope", async () => {
    // Without the dimension segment, a value that happened to be both an email
    // and an IP would share a counter. More importantly, it documents which
    // half of a scope a key belongs to when read off a dashboard.
    const asEmail = await rateLimitKey(LOGIN_EMAIL_RULE, "email", "x");
    const asIp = await rateLimitKey(LOGIN_IP_RULE, "ip", "x");
    expect(asEmail).not.toBe(asIp);
  });

  it("separates scopes, so forgetting a password cannot lock out a login", async () => {
    const login = await rateLimitKey(LOGIN_EMAIL_RULE, "email", EMAIL);
    const forgot = await rateLimitKey(FORGOT_EMAIL_RULE, "email", EMAIL);
    expect(login).not.toBe(forgot);
  });
});

describe("isRateLimited / recordAttempt", () => {
  it("refuses only once the ceiling is reached", async () => {
    const { kv } = fakeKv();

    await burn(kv, FORGOT_EMAIL_RULE, "email", EMAIL, FORGOT_EMAIL_RULE.maxAttempts - 1);
    expect(await isRateLimited(kv, FORGOT_EMAIL_RULE, "email", EMAIL)).toBe(false);

    await recordAttempt(kv, FORGOT_EMAIL_RULE, "email", EMAIL);
    expect(await isRateLimited(kv, FORGOT_EMAIL_RULE, "email", EMAIL)).toBe(true);
  });

  it("refreshes the window on every attempt, so a steady stream stays blocked", async () => {
    const { kv, fake } = fakeKv();
    const key = await rateLimitKey(FORGOT_IP_RULE, "ip", IP);

    await recordAttempt(kv, FORGOT_IP_RULE, "ip", IP);
    expect(fake.ttls.get(key)).toBe(FORGOT_IP_RULE.windowSeconds);
  });

  it("treats a corrupted counter as zero rather than erroring", async () => {
    const { kv, fake } = fakeKv();
    fake.store.set(await rateLimitKey(LOGIN_EMAIL_RULE, "email", EMAIL), "not-a-number");

    expect(await isRateLimited(kv, LOGIN_EMAIL_RULE, "email", EMAIL)).toBe(false);
    await recordAttempt(kv, LOGIN_EMAIL_RULE, "email", EMAIL);
    expect(fake.store.get(await rateLimitKey(LOGIN_EMAIL_RULE, "email", EMAIL))).toBe("1");
  });
});

describe("login limiter", () => {
  it("blocks the address after its ceiling, per Phase 0", async () => {
    const { kv } = fakeKv();

    await burn(kv, LOGIN_EMAIL_RULE, "email", EMAIL, LOGIN_EMAIL_RULE.maxAttempts);
    expect(await isLoginBlocked(kv, EMAIL, null)).toBe(true);
  });

  it("blocks the origin after its (much higher) ceiling", async () => {
    const { kv } = fakeKv();

    // An IP is not a person: offices, schools and carrier NAT put many real
    // users behind one address, so this ceiling is five times the email one.
    expect(LOGIN_IP_RULE.maxAttempts).toBeGreaterThan(LOGIN_EMAIL_RULE.maxAttempts);

    await burn(kv, LOGIN_IP_RULE, "ip", IP, LOGIN_IP_RULE.maxAttempts);
    expect(await isLoginBlocked(kv, "someone-else@example.com", IP)).toBe(true);
  });

  it("catches the stuffing pattern one email counter never sees", async () => {
    const { kv } = fakeKv();

    // Every guess against a different address, so no email counter ever climbs
    // past one — this is the attack the per-IP dimension exists for.
    for (let i = 0; i < LOGIN_IP_RULE.maxAttempts; i++) {
      await recordFailedLogin(kv, `victim-${i}@example.com`, IP);
    }

    expect(await isRateLimited(kv, LOGIN_EMAIL_RULE, "email", "victim-0@example.com")).toBe(false);
    expect(await isLoginBlocked(kv, "victim-999@example.com", IP)).toBe(true);
  });

  it("counts one failure against both dimensions", async () => {
    const { kv, fake } = fakeKv();
    await recordFailedLogin(kv, EMAIL, IP);

    expect(fake.store.get(await rateLimitKey(LOGIN_EMAIL_RULE, "email", EMAIL))).toBe("1");
    expect(fake.store.get(await rateLimitKey(LOGIN_IP_RULE, "ip", IP))).toBe("1");
  });

  it("applies the email dimension alone when there is no client IP", async () => {
    const { kv, fake } = fakeKv();

    await recordFailedLogin(kv, EMAIL, null);
    // Exactly one counter written: nothing was bucketed under an "unknown" IP,
    // which would let one caller exhaust the limit for every visitor at once.
    expect(fake.store.size).toBe(1);
    expect(await isLoginBlocked(kv, EMAIL, null)).toBe(false);
  });

  it("forgives the address on success but NOT the origin", async () => {
    const { kv } = fakeKv();

    await burn(kv, LOGIN_EMAIL_RULE, "email", EMAIL, LOGIN_EMAIL_RULE.maxAttempts);
    await burn(kv, LOGIN_IP_RULE, "ip", IP, LOGIN_IP_RULE.maxAttempts);

    await clearLoginAttempts(kv, EMAIL);

    expect(await isRateLimited(kv, LOGIN_EMAIL_RULE, "email", EMAIL)).toBe(false);
    // The one that matters: a landed credential must not buy a fresh budget.
    expect(await isRateLimited(kv, LOGIN_IP_RULE, "ip", IP)).toBe(true);
    expect(await isLoginBlocked(kv, EMAIL, IP)).toBe(true);
  });
});

describe("forgot-password limiter", () => {
  it("rations mail far more tightly than sign-in attempts", async () => {
    // Every call here puts a message in someone else's inbox, so the ceiling
    // is a handful rather than a dozen.
    expect(FORGOT_EMAIL_RULE.maxAttempts).toBeLessThan(LOGIN_EMAIL_RULE.maxAttempts);
    expect(FORGOT_IP_RULE.maxAttempts).toBeLessThan(LOGIN_IP_RULE.maxAttempts);
  });

  it("counts email and IP separately", async () => {
    const { kv } = fakeKv();

    await burn(kv, FORGOT_EMAIL_RULE, "email", EMAIL, FORGOT_EMAIL_RULE.maxAttempts);
    expect(await isRateLimited(kv, FORGOT_EMAIL_RULE, "email", EMAIL)).toBe(true);
    // A different address from the same host is still fine — until the IP
    // ceiling, which is what stops address-hopping.
    expect(await isRateLimited(kv, FORGOT_EMAIL_RULE, "email", "bob@example.com")).toBe(false);
    expect(await isRateLimited(kv, FORGOT_IP_RULE, "ip", IP)).toBe(false);
  });
});

describe("clientIp", () => {
  const probe = new Hono().get("/", (c) => c.json({ ip: clientIp(c) }));

  async function ipFor(headers: Record<string, string>): Promise<string | null> {
    const res = await probe.request("/", { headers });
    const body = (await res.json()) as { ip: string | null };
    return body.ip;
  }

  it("reads Cloudflare's CF-Connecting-IP", async () => {
    expect(await ipFor({ "cf-connecting-ip": IP })).toBe(IP);
  });

  it("trims it", async () => {
    expect(await ipFor({ "cf-connecting-ip": `  ${IP} ` })).toBe(IP);
  });

  it("answers null when the header is missing or empty", async () => {
    // Null means "skip the IP dimension", not "bucket everyone together" —
    // failing open beats failing closed for every visitor at once.
    expect(await ipFor({})).toBeNull();
    expect(await ipFor({ "cf-connecting-ip": "   " })).toBeNull();
  });

  it("ignores X-Forwarded-For, which any client may forge", async () => {
    expect(await ipFor({ "x-forwarded-for": "198.51.100.1" })).toBeNull();
  });
});
