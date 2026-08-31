/**
 * Password-reset lifetime and link construction (Phase 8c).
 *
 * The sibling of lib/invites.ts, with one deliberate difference: an invite is
 * deleted when redeemed, so "used" and "never existed" collapse into the same
 * state, whereas a reset row is kept and stamped. A password reset is an
 * account-takeover primitive, and someone clicking a link they already used —
 * or a link a *second* person is holding — should be told the link is dead
 * rather than shown a form that silently does nothing. Both states still
 * answer the same `reset_invalid` code outwards; the distinction exists so the
 * row survives to prove which happened.
 */

/** One hour, per docs/specs/PHASE8.md §8c. Short: this is a bearer key to an account. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export function passwordResetExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
}

/** The subset of a `password_resets` row that decides whether it still works. */
export interface ResetTokenState {
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * A reset is usable while it exists, has not been redeemed, and has not
 * reached its expiry. Exactly at `expiresAt` it is already dead, so a
 * zero-length window is never usable — the same boundary as `isInviteUsable`.
 */
export function isResetUsable(
  reset: ResetTokenState | undefined | null,
  now: Date = new Date(),
): boolean {
  if (reset === undefined || reset === null) return false;
  if (reset.usedAt !== null) return false;
  return reset.expiresAt.getTime() > now.getTime();
}

/**
 * The link that goes in the email. `origin` comes from the request URL rather
 * than config, so self-hosters get working links on whatever domain they run —
 * and so a deployment reachable on two hostnames mails back the one the user
 * actually asked from.
 */
export function buildResetUrl(origin: string, rawToken: string): string {
  return `${origin.replace(/\/+$/, "")}/reset/${encodeURIComponent(rawToken)}`;
}

/** The reset email. Plain text: it is one sentence and one link. */
export function resetEmailBody(resetUrl: string): string {
  return [
    "Someone asked to reset the password for your OpenRefs account.",
    "",
    "Open this link to choose a new one:",
    resetUrl,
    "",
    "The link stops working in one hour, and signs you out everywhere once used.",
    "If this wasn't you, ignore this email — nothing has changed.",
  ].join("\n");
}
