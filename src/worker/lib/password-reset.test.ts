/**
 * The pure half of the reset flow: how long a link lives, when it stops
 * working, and what goes in the mail. The route-level lifecycle (issue → use →
 * reuse, and the session wipe) is in src/worker/routes/auth.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  buildResetUrl,
  isResetUsable,
  passwordResetExpiresAt,
  PASSWORD_RESET_TTL_MS,
  resetEmailBody,
} from "./password-reset";

const NOW = new Date("2026-08-31T12:00:00.000Z");

describe("passwordResetExpiresAt", () => {
  it("is one hour out — this is a bearer key to an account", () => {
    expect(PASSWORD_RESET_TTL_MS).toBe(60 * 60 * 1000);
    expect(passwordResetExpiresAt(NOW).toISOString()).toBe(
      "2026-08-31T13:00:00.000Z",
    );
  });
});

describe("isResetUsable", () => {
  const live = { expiresAt: new Date(NOW.getTime() + 1000), usedAt: null };

  it("accepts an unused link inside its window", () => {
    expect(isResetUsable(live, NOW)).toBe(true);
  });

  it("rejects one that has been redeemed", () => {
    expect(isResetUsable({ ...live, usedAt: NOW }, NOW)).toBe(false);
  });

  it("rejects one past its expiry", () => {
    const dead = { expiresAt: new Date(NOW.getTime() - 1), usedAt: null };
    expect(isResetUsable(dead, NOW)).toBe(false);
  });

  it("treats the expiry instant itself as dead, so a zero-length window never works", () => {
    expect(isResetUsable({ expiresAt: NOW, usedAt: null }, NOW)).toBe(false);
  });

  it("rejects a missing row — an unknown token is just a dead one", () => {
    expect(isResetUsable(undefined, NOW)).toBe(false);
    expect(isResetUsable(null, NOW)).toBe(false);
  });
});

describe("buildResetUrl", () => {
  it("hangs the token off the request's own origin", () => {
    // From the request rather than config, so self-hosters get working links
    // on whatever domain they run.
    expect(buildResetUrl("https://openrefs.example", "abc123")).toBe(
      "https://openrefs.example/reset/abc123",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildResetUrl("https://openrefs.example/", "abc123")).toBe(
      "https://openrefs.example/reset/abc123",
    );
  });

  it("percent-encodes the token", () => {
    // randomToken() is base64url and needs none of this, but a token that
    // reached a URL unencoded would be a silently broken link, not an error.
    expect(buildResetUrl("https://openrefs.example", "a b/c")).toBe(
      "https://openrefs.example/reset/a%20b%2Fc",
    );
  });
});

describe("resetEmailBody", () => {
  const body = resetEmailBody("https://openrefs.example/reset/abc123");

  it("contains the link and says what using it costs", () => {
    expect(body).toContain("https://openrefs.example/reset/abc123");
    expect(body).toContain("one hour");
    // Signing out everywhere is a surprise if it is not announced.
    expect(body).toContain("signs you out everywhere");
  });

  it("tells a recipient who did not ask that they need do nothing", () => {
    // Anyone can type someone else's address into the form, so the mail has
    // to read as safe to ignore rather than as an alarm.
    expect(body).toContain("ignore this email");
  });
});
