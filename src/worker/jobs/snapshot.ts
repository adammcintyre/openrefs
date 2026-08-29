/**
 * Turning a SERP into one row of `rank_snapshots`: does this result belong to
 * the project's site, and if so, where did the site rank?
 *
 * Pure and binding-free so the matching rules can be tested exhaustively —
 * they are the part of rank tracking most likely to be quietly wrong, and a
 * quietly wrong answer here looks exactly like a genuine ranking change.
 */

/**
 * A SERP row, structurally. Deliberately not `OrganicSerpItem`: this file
 * cares about three fields, and typing it that way keeps the tests free of the
 * DataForSEO wrappers.
 */
export interface RankableItem {
  /** `rank_group` — the organic ranking. */
  position: number | null;
  url: string | null;
  domain: string | null;
}

/** What one keyword's check produced. */
export interface SnapshotPosition {
  /**
   * Best organic position for the project's site, or **null for "not in the
   * results we fetched"** — which at depth 100 means "not in the top 100".
   * Never 0: zero would read as a ranking, and "unranked" is not a rank.
   */
  position: number | null;
  /** The ranking URL, or null when nothing ranked. */
  url: string | null;
}

/**
 * A hostname reduced to the form two sites are compared in: lowercased, no
 * trailing dot, no leading `www.`.
 *
 * `www.` is stripped because `www.example.com` and `example.com` are the same
 * site to everyone except a string comparison — the single most common way a
 * rank tracker reports a phantom "not ranking".
 */
export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** The host of a URL, or null if it will not parse. */
export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Whether a result belongs to the project's site.
 *
 * Subdomains count — `shop.example.com` is the project's traffic and its
 * ranking — so the test is "equal, or a label-boundary suffix". The boundary
 * is what stops `notexample.com` and `example.com.au` matching `example.com`,
 * which a bare `endsWith` would wave through.
 */
export function isProjectDomain(
  itemDomain: string | null,
  itemUrl: string | null,
  projectDomain: string,
): boolean {
  const target = normalizeHost(projectDomain);
  if (target === "") return false;

  // `domain` is the documented field; the URL host is the fallback for the
  // occasional row that omits it.
  const raw =
    itemDomain !== null && itemDomain.trim() !== ""
      ? itemDomain
      : itemUrl === null
        ? null
        : hostFromUrl(itemUrl);
  if (raw === null) return false;

  const host = normalizeHost(raw);
  return host === target || host.endsWith(`.${target}`);
}

/**
 * The project's best (numerically lowest) organic position on this SERP.
 *
 * A matching row with no `rank_group` is skipped rather than treated as a
 * ranking: it tells us the page appeared, but not where, and inventing a
 * position from it would corrupt the series. If every match is like that, the
 * result is the same as no match — `position: null`.
 */
export function bestPositionFor(
  items: readonly RankableItem[],
  projectDomain: string,
): SnapshotPosition {
  let best: SnapshotPosition = { position: null, url: null };

  for (const item of items) {
    if (item.position === null) continue;
    if (!isProjectDomain(item.domain, item.url, projectDomain)) continue;
    if (best.position !== null && item.position >= best.position) continue;
    best = { position: item.position, url: item.url };
  }

  return best;
}
