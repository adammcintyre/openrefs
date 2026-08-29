/**
 * Domain Score lookups for a batch of domains, via `POST /backlinks/scores`.
 *
 * One call scores a whole page of results — a SERP, a gap table — instead of
 * one request per row. Two things about that endpoint drive this file:
 *
 *  1. **The provider does not preserve input order.** It returns URL targets
 *     before bare domains, so results must be matched back by their `target`
 *     string. Matching by array index silently attributes one site's authority
 *     to another, which is why every read goes through `scoresByTarget` and
 *     nothing here ever indexes `items`.
 *  2. **The echoed target is not always the string we sent.** `www.` prefixes
 *     and schemes come and go, so both sides are normalised before comparison.
 *
 * Lives under `components/gap/` because that is this agent's file boundary for
 * the Phase 2 UI wave, not because it is gap-specific: it is a plain Backlinks
 * binding, and the Backlinks module is welcome to re-home it (see the merge
 * notes) — the pure half is what carries the tests.
 */
import { useQuery } from "@tanstack/react-query";

import type {
  BacklinksScoresResponse,
  TargetScore,
} from "../../../shared/backlinks";
import { BACKLINKS_SCORES_MAX_TARGETS } from "../../../shared/backlinks";
import { api } from "../../lib/api";

/**
 * The comparison form of a target.
 *
 * Scheme, `www.` and a trailing slash are noise — `https://www.example.com/`
 * and `example.com` are one site. A path is *not* noise: `example.com/pricing`
 * is a page-level target with its own score, so it stays.
 */
export function normalizeScoreTarget(
  target: string | null | undefined,
): string {
  if (target === null || target === undefined) return "";
  return target
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/**
 * The domains worth asking about: normalised, de-duplicated, blanks dropped,
 * and capped at what one request may carry.
 *
 * Order is preserved so the request is stable across renders (and therefore so
 * is the query key) rather than reshuffling with Set iteration on every pass.
 */
export function distinctScoreTargets(
  domains: ReadonlyArray<string | null | undefined>,
  max: number = BACKLINKS_SCORES_MAX_TARGETS,
): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];

  for (const domain of domains) {
    const normalized = normalizeScoreTarget(domain);
    if (normalized === "" || seen.has(normalized)) continue;
    seen.add(normalized);
    targets.push(normalized);
    if (targets.length >= max) break;
  }

  return targets;
}

/**
 * Response items to a lookup table, keyed by normalised target.
 *
 * A target the provider scored twice keeps the first score it actually
 * reported: a later `null` for the same host is "not reported again", not a
 * correction to zero.
 */
export function scoresByTarget(
  items: ReadonlyArray<TargetScore>,
): Map<string, number | null> {
  const scores = new Map<string, number | null>();

  for (const item of items) {
    const key = normalizeScoreTarget(item.target);
    if (key === "") continue;
    const existing = scores.get(key);
    if (existing !== undefined && existing !== null) continue;
    scores.set(key, item.domainScore);
  }

  return scores;
}

/**
 * One domain's score, or null when it was not in the batch or the provider had
 * nothing for it. Null renders as a dash — never as 0, which would read as
 * "this site has no authority" rather than "we do not know".
 */
export function lookupDomainScore(
  scores: ReadonlyMap<string, number | null> | undefined,
  domain: string | null | undefined,
): number | null {
  if (scores === undefined) return null;
  return scores.get(normalizeScoreTarget(domain)) ?? null;
}

/**
 * Scores for a batch of domains.
 *
 * Metered and cached server-side like every other DataForSEO read, so the
 * caller shows what it cost. `enabled` is the caller's "I have rows now" — the
 * request waits for the list it is meant to describe rather than firing on
 * mount with an empty batch.
 */
export function useDomainScores(
  workspaceId: string | null,
  targets: ReadonlyArray<string>,
  enabled = true,
) {
  return useQuery({
    queryKey: ["backlinks", "scores", workspaceId, targets.join(",")],
    queryFn: () =>
      api.post<BacklinksScoresResponse>("/backlinks/scores", {
        workspace: workspaceId ?? "",
        targets: [...targets],
      }),
    enabled: enabled && workspaceId !== null && targets.length > 0,
    // A billed call never retries itself — see the note in keywords/queries.ts.
    retry: false,
    staleTime: 60 * 60_000,
  });
}
