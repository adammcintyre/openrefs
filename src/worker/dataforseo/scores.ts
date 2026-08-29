/**
 * Domain Score and Page Score — OpenRefs' 0–100 authority metric.
 *
 * DataForSEO's Backlinks API reports authority as `rank`, an integer on a
 * 0–1000 scale (documented on every backlinks endpoint that carries it). Users
 * read authority on a 0–100 scale, so every `rank` crossing into an API
 * response is normalised here and nowhere else:
 *
 *     score = round(rank / 10)
 *
 * Two rules this module exists to enforce, both from CLAUDE.md:
 *
 * 1. **The raw 0–1000 rank never appears in an API response.** It is an
 *    implementation detail of the upstream provider; publishing both scales
 *    would guarantee someone eventually compares one against the other. The
 *    wrappers in backlinks.ts convert at the boundary, so no route or shared
 *    type ever holds a `rank`.
 * 2. **The metric is called Domain Score (for a host) or Page Score (for a
 *    single URL).** The trademarked names of other vendors' authority metrics
 *    are banned in code, UI and docs (CLAUDE.md rule 2) — they are the same
 *    idea, they are not the same number, and using their names would be a
 *    claim we cannot make.
 *
 * Domain Score and Page Score are the same normalisation applied to a different
 * upstream field (`rank` on a domain vs `page_from_rank` on a page), which is
 * why there is one function and two names for it.
 */

/** The top of DataForSEO's `rank` scale on the Backlinks API. */
export const BACKLINKS_RANK_MAX = 1000;

/** The top of our published scale. */
export const SCORE_MAX = 100;

/**
 * `rank` (0–1000) → Domain/Page Score (0–100), or `null` when there is nothing
 * to convert.
 *
 * `null` in, `null` out — and that is a distinct answer from `0`. DataForSEO
 * returns no rank for a target it has never crawled, which means "we don't
 * know", whereas 0 means "crawled, no authority". Collapsing the two would
 * render an unknown domain as the worst possible score.
 *
 * Values outside the documented range are clamped rather than rejected: a
 * response we cannot map is still a response the user paid for, and a clamped
 * score is closer to the truth than a dropped column. Non-finite input (NaN,
 * Infinity — reachable if upstream ever sends a string that coerces badly)
 * yields `null`, because there is no honest number to show.
 */
export function toScore(rank: number | null | undefined): number | null {
  if (rank === null || rank === undefined) return null;
  if (!Number.isFinite(rank)) return null;
  const clamped = Math.min(Math.max(rank, 0), BACKLINKS_RANK_MAX);
  return Math.round(clamped / (BACKLINKS_RANK_MAX / SCORE_MAX));
}

/**
 * Named for the two things it is called in the product. Both delegate to
 * `toScore`; the aliases exist so call sites read as the metric they are
 * producing, and so a future divergence between the two (should DataForSEO ever
 * scale page rank differently from domain rank) has an obvious home.
 */
export const toDomainScore = toScore;
export const toPageScore = toScore;

/**
 * The inverse: a 0–100 score back to the 0–1000 rank, for **filters only**.
 *
 * The Backlinks API filters on its own scale, so "only show me links from
 * domains scoring 30+" has to travel as `["domain_from_rank", ">=", 300]`. This
 * is the one legitimate direction for the raw scale — it goes out in a request,
 * never back in a response.
 *
 * A score is coarser than a rank (each point covers ten ranks), so the boundary
 * is chosen deliberately: score × 10 is the *lowest* rank that rounds to that
 * score, which makes `>=` inclusive of the whole band the user asked for.
 * Rounding to the middle would silently drop half of it.
 */
export function fromScore(score: number): number {
  const clamped = Math.min(Math.max(score, 0), SCORE_MAX);
  return Math.round(clamped * (BACKLINKS_RANK_MAX / SCORE_MAX));
}
