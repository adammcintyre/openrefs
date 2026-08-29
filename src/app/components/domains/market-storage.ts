/**
 * "The market I was last working in", remembered per workspace.
 *
 * Per workspace rather than globally because an agency's workspaces are often
 * one market each — restoring a US workspace to the UK because that is what the
 * user picked in a different tenant would be a small, repeated annoyance.
 *
 * Storage is best-effort: private mode, a storage quota, or a browser policy
 * can make every call here throw, and none of that is worth failing a page
 * render over. Every read falls back to the caller's default.
 */
import type { Market } from "../../routes/domain-overview/url-state";

const KEY_PREFIX = "openrefs.domainOverview.market:";

/**
 * Validate a stored blob before trusting it. Kept separate from localStorage
 * so it can be tested directly, and because "what shape is acceptable" is the
 * only interesting part: a stale entry written by an older build must not be
 * able to put a non-numeric location code into an API request.
 */
export function parseStoredMarket(raw: string | null): Market | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { location, language } = parsed as {
    location?: unknown;
    language?: unknown;
  };
  if (typeof location !== "number" || !Number.isInteger(location) || location <= 0) {
    return null;
  }
  if (typeof language !== "string" || !/^[a-z]{2,8}(-[a-z0-9]{2,8})?$/i.test(language)) {
    return null;
  }
  return { location, language: language.toLowerCase() };
}

export function readLastMarket(workspaceId: string | null): Market | null {
  if (workspaceId === null) return null;
  try {
    return parseStoredMarket(
      globalThis.localStorage?.getItem(`${KEY_PREFIX}${workspaceId}`) ?? null,
    );
  } catch {
    return null;
  }
}

export function writeLastMarket(workspaceId: string | null, market: Market): void {
  if (workspaceId === null) return;
  try {
    globalThis.localStorage?.setItem(
      `${KEY_PREFIX}${workspaceId}`,
      JSON.stringify(market),
    );
  } catch {
    /* Preference only — the page works without it. */
  }
}
