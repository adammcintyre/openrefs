import { describe, expect, it } from "vitest";

import { INVITE_TTL_MS, buildInviteUrl, inviteExpiresAt, isInviteUsable } from "./invites";

const NOW = new Date("2026-08-29T12:00:00.000Z");

describe("inviteExpiresAt", () => {
  it("is seven days after issue", () => {
    expect(inviteExpiresAt(NOW).toISOString()).toBe("2026-09-05T12:00:00.000Z");
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("isInviteUsable", () => {
  it("accepts an invite inside its window", () => {
    expect(isInviteUsable({ expiresAt: inviteExpiresAt(NOW) }, NOW)).toBe(true);
  });

  it("rejects one that has expired", () => {
    const expired = new Date(NOW.getTime() - 1);
    expect(isInviteUsable({ expiresAt: expired }, NOW)).toBe(false);
  });

  it("rejects one expiring exactly now — the window is half-open", () => {
    expect(isInviteUsable({ expiresAt: NOW }, NOW)).toBe(false);
  });

  it("rejects a missing invite, so 'used' and 'never existed' look identical", () => {
    expect(isInviteUsable(undefined, NOW)).toBe(false);
    expect(isInviteUsable(null, NOW)).toBe(false);
  });

  it("is still usable one millisecond before expiry", () => {
    const edge = new Date(NOW.getTime() + INVITE_TTL_MS - 1);
    expect(isInviteUsable({ expiresAt: inviteExpiresAt(NOW) }, edge)).toBe(true);
  });
});

describe("buildInviteUrl", () => {
  it("builds an /invite/<token> link on the request origin", () => {
    expect(buildInviteUrl("https://openrefs.adamm.io", "tok123")).toBe(
      "https://openrefs.adamm.io/invite/tok123",
    );
  });

  it("does not double up the slash when the origin has a trailing one", () => {
    expect(buildInviteUrl("http://localhost:5173/", "tok123")).toBe(
      "http://localhost:5173/invite/tok123",
    );
  });

  it("escapes tokens so the path cannot be broken out of", () => {
    expect(buildInviteUrl("https://example.com", "a/b?c=d")).toBe(
      "https://example.com/invite/a%2Fb%3Fc%3Dd",
    );
  });
});
