/**
 * Invite lifetime and link construction.
 *
 * Only `sha256Hex(token)` is stored, so an invite cannot be resent or recovered
 * from D1 — losing the link means issuing a new one. Redemption deletes the
 * row, which is what makes an accepted invite unusable a second time: "used"
 * and "never existed" are the same state on purpose.
 */

/** Seven days, per the brief. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function inviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

/**
 * An invite is usable while it exists and has not reached its expiry. Exactly
 * at `expiresAt` it is already dead, so a zero-length window is never usable.
 */
export function isInviteUsable(
  invite: { expiresAt: Date } | undefined | null,
  now: Date = new Date(),
): boolean {
  if (invite === undefined || invite === null) return false;
  return invite.expiresAt.getTime() > now.getTime();
}

/**
 * The link the inviter copies. `origin` comes from the request URL rather than
 * config so self-hosters get working links on whatever domain they run.
 */
export function buildInviteUrl(origin: string, rawToken: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${encodeURIComponent(rawToken)}`;
}
