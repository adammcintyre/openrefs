/**
 * Masking for values that must be recognisable to their owner but useless to
 * anyone else. Used for the DataForSEO login shown on the workspace settings
 * screen — the password has no masked form at all, because it is never read
 * back out of D1 for display.
 */

/**
 * Keeps the first two characters of the local part and the whole domain:
 * "test@brandpacks.com" -> "te***@brandpacks.com".
 *
 * The domain survives because it is the part that tells an operator *which*
 * account is wired up, and it is not the secret half. Short local parts reveal
 * less rather than being padded, so "a@b.com" -> "a***@b.com".
 */
export function maskLogin(login: string): string {
  const trimmed = login.trim();
  if (trimmed === "") return "";

  const at = trimmed.lastIndexOf("@");
  // No "@", or an address starting with one: treat the whole value as opaque.
  if (at <= 0) return `${trimmed.slice(0, 2)}***`;

  // Slice the local part, not the whole string — otherwise a one-character
  // local part ("a@b.com") would carry the "@" into the revealed prefix.
  return `${trimmed.slice(0, at).slice(0, 2)}***${trimmed.slice(at)}`;
}
