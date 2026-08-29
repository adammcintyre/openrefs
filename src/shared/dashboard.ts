/**
 * Contract for `GET /api/v1/dashboard?workspace=<id>` — the numbers on the
 * workspace home screen.
 *
 * Six figures, every one of them read from tables we already own. Nothing here
 * calls DataForSEO: the dashboard is the first screen after login and must not
 * cost a fraction of a cent to look at, nor fail when a workspace has no
 * credentials configured yet.
 *
 * **Every field is nullable-by-emptiness rather than zero-filled where a zero
 * would lie.** A workspace tracking no keywords has `avgPosition: null` — there
 * is no average of nothing — while `top10Count: 0` is a true statement about a
 * real (empty) set. The UI must render null as "—" and 0 as "0"; showing 0 for
 * an unknown average is the one mistake this shape exists to prevent.
 */

/** GET /api/v1/dashboard?workspace=<id> */
export interface DashboardRollup {
  /** Tracked keywords across every project in the workspace. */
  trackedKeywords: number;

  /**
   * Mean latest position across tracked keywords that currently rank.
   *
   * Keywords with no snapshot (never checked) and keywords whose latest
   * snapshot is `null` (checked, not in the top 100) are both excluded rather
   * than counted as 100 — inventing a position for an absent one would drag
   * the average toward a number nobody measured. Null when nothing ranks.
   * Rounded to one decimal.
   */
  avgPosition: number | null;

  /** Tracked keywords whose latest position is 1–10. A count, so 0 is honest. */
  top10Count: number;

  /** Keyword collections in the workspace. */
  collections: number;

  /**
   * DataForSEO spend for the current UTC calendar month — the same window and
   * the same `api_usage` sum the spend cap enforces, so this number and the
   * cap's own accounting can never disagree.
   */
  monthSpendUsd: number;

  /**
   * OnPage score (0–100) of the most recent completed audit in the workspace,
   * across all projects. Null when no audit has finished yet.
   */
  latestAuditScore: number | null;
}
