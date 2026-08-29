/**
 * The competitor set, as rules rather than as UI.
 *
 * Every constraint here exists because breaking it wastes money or returns a
 * misleading table: the Worker runs **one upstream call per competitor** (two
 * in `all` mode), so a duplicate entry is a duplicate bill, and a competitor
 * that is really the target compares a domain against itself — the Worker
 * drops that one server-side, and a chip the user added but nothing analysed
 * is worse than a refusal at the point of adding.
 *
 * Pure string handling, no React, so the rules are testable on their own.
 */
import { GAP_MAX_COMPETITORS } from "../../../shared/gap";
import { isLikelyDomain, normalizeDomainInput } from "../domains/format";

export { GAP_MAX_COMPETITORS };

/** Why a domain could not join the set. */
export type CompetitorRejection =
  | "empty"
  | "invalid"
  | "duplicate"
  | "self"
  | "full";

export interface AddCompetitorResult {
  /** The set after the attempt — unchanged when `rejected` is set. */
  competitors: string[];
  /** The normalised domain that was added, or null. */
  added: string | null;
  rejected: CompetitorRejection | null;
}

/** What to put under the input when an add bounces. */
export function competitorRejectionMessage(
  rejection: CompetitorRejection,
): string {
  switch (rejection) {
    case "empty":
      return "Enter a competitor domain.";
    case "invalid":
      return "That doesn't look like a domain. Try example.com.";
    case "duplicate":
      return "That competitor is already in the list.";
    case "self":
      return "That's your own domain — competitors have to be someone else.";
    case "full":
      return `Up to ${GAP_MAX_COMPETITORS} competitors, because each one is another DataForSEO call.`;
  }
}

/**
 * Add one domain to the set.
 *
 * Returns a new array rather than mutating, so it drops straight into a
 * `useState` setter, and reports *why* on refusal so the form can say so
 * instead of silently doing nothing.
 */
export function addCompetitor(
  current: ReadonlyArray<string>,
  raw: string,
  target: string,
): AddCompetitorResult {
  const unchanged = [...current];
  const domain = normalizeDomainInput(raw);

  if (domain === "") {
    return { competitors: unchanged, added: null, rejected: "empty" };
  }
  if (!isLikelyDomain(domain)) {
    return { competitors: unchanged, added: null, rejected: "invalid" };
  }
  if (domain === normalizeDomainInput(target)) {
    return { competitors: unchanged, added: null, rejected: "self" };
  }
  if (current.includes(domain)) {
    return { competitors: unchanged, added: null, rejected: "duplicate" };
  }
  if (current.length >= GAP_MAX_COMPETITORS) {
    return { competitors: unchanged, added: null, rejected: "full" };
  }

  return {
    competitors: [...current, domain],
    added: domain,
    rejected: null,
  };
}

export function removeCompetitor(
  current: ReadonlyArray<string>,
  domain: string,
): string[] {
  return current.filter((entry) => entry !== domain);
}

/**
 * A comma- or whitespace-separated list to a valid set.
 *
 * Used for two things that must agree: reading `?competitors=` out of the URL,
 * and pasting several domains into the input at once. Total by design — a
 * hand-edited URL full of junk resolves to the usable part of itself rather
 * than to an error the user cannot clear.
 */
export function parseCompetitorList(
  raw: string,
  target = "",
): string[] {
  const normalizedTarget = normalizeDomainInput(target);
  const competitors: string[] = [];

  for (const entry of raw.split(/[,\s]+/)) {
    const domain = normalizeDomainInput(entry);
    if (domain === "" || !isLikelyDomain(domain)) continue;
    if (domain === normalizedTarget) continue;
    if (competitors.includes(domain)) continue;
    competitors.push(domain);
    if (competitors.length >= GAP_MAX_COMPETITORS) break;
  }

  return competitors;
}

/** True when there is a competitor set worth spending a call on. */
export function hasCompetitors(competitors: ReadonlyArray<string>): boolean {
  return competitors.length > 0;
}
