/**
 * The three opportunity rules (docs/specs/PHASE5.md), as pure functions.
 *
 * Pure on purpose. These are the only *opinions* in the Search Console module
 * — everything else reports what Google said — so they are the part most worth
 * being able to test exhaustively against fixture rows, and the part most
 * likely to be tuned later. No fetching, no KV, no D1: rows in, findings out.
 *
 * All three read Search Console's own metrics, which means:
 *  - `ctr` is a fraction (0–1), not a percentage;
 *  - `position` is a 1-based *average* over the window, so it is fractional
 *    and a query can sit at 10.4 without ever having ranked 10th;
 *  - a query's numbers are aggregated over the whole date range, so a rule
 *    fires on the window's behaviour, not on any single day's.
 */
import type {
  GscCannibalizationOpportunity,
  GscCannibalizedPage,
  GscLowCtrOpportunity,
  GscMetrics,
  GscOpportunityThresholds,
  GscQueryRow,
  GscStrikingDistanceOpportunity,
} from "../../shared/gsc";

/* -------------------------------------------------------------------------- */
/* Thresholds                                                                  */
/* -------------------------------------------------------------------------- */

/** Positions 5–20: page one's tail and page two. Inclusive at both ends. */
export const STRIKING_DISTANCE_MIN_POSITION = 5;
export const STRIKING_DISTANCE_MAX_POSITION = 20;

/** Only positions Google actually shows on page one can be under-clicked. */
export const LOW_CTR_MAX_POSITION = 10;

/** "Below half the expected curve" — docs/specs/PHASE5.md. */
export const LOW_CTR_RATIO = 0.5;

/** Each competing page must earn ≥ 20% of the query's clicks. */
export const CANNIBALIZATION_MIN_SHARE = 0.2;

/** …and there must be at least two of them, or nothing is competing. */
export const CANNIBALIZATION_MIN_PAGES = 2;

/**
 * Rows returned per list.
 *
 * The same 200 that caps every other table in OpenRefs (`MAX_LIMIT` in
 * lib/research.ts), for the same reason: nobody works through more than that,
 * and the lists are sorted so the 200 kept are the 200 worth having. A 5,000
 * row pull can otherwise yield well over a thousand striking-distance hits and
 * turn one response into a megabyte of JSON.
 */
export const OPPORTUNITY_LIMIT = 200;

/* -------------------------------------------------------------------------- */
/* Expected CTR curve                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Expected organic CTR by position, index 0 = position 1, as fractions.
 *
 * **Source: Backlinko, "We Analyzed 4 Million Google Search Results"** —
 * https://backlinko.com/google-ctr-stats — 1,312,881 pages across 12,166,560
 * queries. Chosen over the alternatives for one reason that matters here: it
 * is **aggregated Google Search Console data** ("we were able to get CTR data
 * from several different Google Search Console accounts"), so it measures the
 * same quantity, with the same denominator, as the `ctr` field these rules
 * compare it against. The dataset is from ~2022.
 *
 * Corroborated by Sistrix's 80-million-keyword GSC study
 * (https://www.sistrix.com/blog/why-almost-everything-you-knew-about-google-ctr-is-no-longer-valid/),
 * which agrees within about one percentage point at every position:
 * 28.5 / 15.7 / 11.0 / 8.0 / 7.2 / 5.1 / 4.0 / 3.2 / 2.8 / 2.5.
 *
 * Deliberately **not** clickstream data (seoClarity's study puts position 1 at
 * 8%, not 28%) — that counts zero-click sessions in its denominator and is not
 * the same measurement as Search Console's CTR, so mixing it in would compare
 * two different things.
 *
 * **Three caveats, all of which the ×0.5 threshold is there to absorb:**
 *
 *  1. The data predates AI Overviews. Every directional signal since points to
 *     lower top-of-page CTR, so this curve is, if anything, generous at
 *     positions 1–3 — which makes the rule *less* likely to fire, i.e. it errs
 *     toward silence rather than toward false alarms.
 *  2. Positions 8–10 are within noise of each other in every published study
 *     (Backlinko itself calls them "virtually the same"). Treat the tail as a
 *     floor, not a gradient.
 *  3. "Expected CTR" is genuinely site-specific: a brand query at position 3
 *     out-clicks a generic one at position 1. Fitting a per-property curve
 *     from the user's own data would be strictly better and is the obvious
 *     future improvement.
 *
 * Read the output as a prompt to look, never as a target. Position 1 earning
 * 15% rather than 27% is not automatically a problem.
 */
export const EXPECTED_CTR_BY_POSITION: readonly number[] = [
  0.276, // 1
  0.158, // 2
  0.11, // 3
  0.084, // 4
  0.063, // 5
  0.049, // 6
  0.039, // 7
  0.033, // 8
  0.027, // 9
  0.024, // 10
];

/**
 * The curve's value for a fractional average position.
 *
 * Rounds to the nearest whole position (`4.5` → position 5, half-up) because
 * the curve is defined per rank, and an average of 4.5 describes a query that
 * spent its time between ranks 4 and 5 — either bucket is defensible and
 * rounding is the conventional choice. Positions past the curve's end return
 * the last value rather than zero: below rank 10 the differences are inside
 * the noise, and returning 0 would make the ratio infinite and fire the rule
 * on every deep result.
 */
export function expectedCtr(position: number): number {
  if (!Number.isFinite(position) || position < 1) {
    return EXPECTED_CTR_BY_POSITION[0] as number;
  }
  const rank = Math.round(position);
  const index = Math.min(rank, EXPECTED_CTR_BY_POSITION.length) - 1;
  return EXPECTED_CTR_BY_POSITION[index] as number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The median of the set's impressions — the striking-distance rule's floor.
 *
 * A median rather than a fixed number because "enough impressions to bother
 * with" is entirely relative to the site: 50 impressions is noise for a news
 * publisher and a strong signal for a B2B site with 900 total. Using the
 * fetched set's own midpoint makes the rule self-scaling.
 *
 * Even-length sets average the two middle values (the standard definition).
 * An empty set has no median; 0 lets every row through, which is the right
 * behaviour for "there is nothing to compare against".
 */
export function medianImpressions(rows: readonly GscMetrics[]): number {
  if (rows.length === 0) return 0;
  const sorted = rows.map((row) => row.impressions).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** A query+page row, as the `dimensions: ["query", "page"]` pull returns it. */
export interface GscQueryPageRow extends GscMetrics {
  query: string;
  page: string;
}

/**
 * The best-performing page per query, by clicks then impressions.
 *
 * Gives the query-only rules something actionable to point at: "position 7,
 * 4,000 impressions" is a fact, "…on /guides/widgets" is a task. Ties break on
 * impressions so a pair of zero-click pages still resolves deterministically.
 */
export function topPageByQuery(
  rows: readonly GscQueryPageRow[],
): Map<string, string> {
  const best = new Map<string, GscQueryPageRow>();
  for (const row of rows) {
    const current = best.get(row.query);
    if (
      current === undefined ||
      row.clicks > current.clicks ||
      (row.clicks === current.clicks && row.impressions > current.impressions)
    ) {
      best.set(row.query, row);
    }
  }
  return new Map([...best].map(([query, row]) => [query, row.page]));
}

function metrics(row: GscMetrics): GscMetrics {
  return {
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
}

/* -------------------------------------------------------------------------- */
/* Rule 1 — striking distance                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Positions 5–20 with at-or-above-median impressions.
 *
 * The premise: demand is already proven (people are searching and Google is
 * showing the page), and the remaining gap is a few positions rather than a
 * whole content strategy. The impression floor is what separates "nearly
 * there" from the long tail of one-impression queries that sit at position 12
 * because they were shown once.
 *
 * Sorted by impressions descending — the size of the prize.
 */
export function findStrikingDistance(
  rows: readonly GscQueryRow[],
  pageByQuery: ReadonlyMap<string, string>,
  minImpressions: number,
): GscStrikingDistanceOpportunity[] {
  return rows
    .filter(
      (row) =>
        row.position >= STRIKING_DISTANCE_MIN_POSITION &&
        row.position <= STRIKING_DISTANCE_MAX_POSITION &&
        row.impressions >= minImpressions,
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, OPPORTUNITY_LIMIT)
    .map((row) => ({
      rule: "striking_distance" as const,
      query: row.query,
      page: pageByQuery.get(row.query) ?? null,
      ...metrics(row),
    }));
}

/* -------------------------------------------------------------------------- */
/* Rule 2 — low CTR                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Page-one positions earning less than half the expected clicks for their
 * rank.
 *
 * A ranking the site already has, being wasted — which makes it the cheapest
 * fix on the list: a title and description rewrite, no links and no new
 * content. Half the curve, rather than "below the curve", because the curve is
 * an industry average and being under it is the ordinary case for roughly half
 * of all queries.
 *
 * Zero-impression rows are excluded: their CTR is 0 by definition and says
 * nothing about the snippet.
 *
 * Sorted by impressions descending, so the biggest wasted rankings lead.
 */
export function findLowCtr(
  rows: readonly GscQueryRow[],
  pageByQuery: ReadonlyMap<string, string>,
): GscLowCtrOpportunity[] {
  return rows
    .filter((row) => row.position <= LOW_CTR_MAX_POSITION && row.impressions > 0)
    .map((row) => {
      const expected = expectedCtr(row.position);
      return { row, expected, ratio: row.ctr / expected };
    })
    .filter(({ ratio }) => ratio < LOW_CTR_RATIO)
    .sort((a, b) => b.row.impressions - a.row.impressions)
    .slice(0, OPPORTUNITY_LIMIT)
    .map(({ row, expected, ratio }) => ({
      rule: "low_ctr" as const,
      query: row.query,
      page: pageByQuery.get(row.query) ?? null,
      expectedCtr: expected,
      ctrRatio: ratio,
      ...metrics(row),
    }));
}

/* -------------------------------------------------------------------------- */
/* Rule 3 — cannibalization                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Queries where two or more pages each take ≥ 20% of the clicks.
 *
 * The site competing with itself: Google is unsure which page answers the
 * query, so it alternates, and neither page accumulates the engagement signals
 * that would push either up. The fix is editorial (consolidate, or
 * differentiate and internally link), which is why this list is separate from
 * the two ranking lists.
 *
 * **Only click-earning queries qualify.** A query with zero clicks has no
 * click distribution to split, so a share is undefined rather than zero — and
 * the impression-only version of this signal is far too noisy to act on.
 *
 * The headline metrics come from the query-level pull where available, because
 * Google aggregates impressions across pages correctly there; summing the
 * per-page rows would double-count a SERP that showed two of the site's pages
 * at once. The per-page sum is the fallback when the query-level pull has no
 * matching row.
 */
export function findCannibalization(
  queryPageRows: readonly GscQueryPageRow[],
  queryTotals: ReadonlyMap<string, GscMetrics>,
): GscCannibalizationOpportunity[] {
  const byQuery = new Map<string, GscQueryPageRow[]>();
  for (const row of queryPageRows) {
    const list = byQuery.get(row.query);
    if (list === undefined) byQuery.set(row.query, [row]);
    else list.push(row);
  }

  const found: GscCannibalizationOpportunity[] = [];

  for (const [query, pages] of byQuery) {
    if (pages.length < CANNIBALIZATION_MIN_PAGES) continue;

    const totalClicks = pages.reduce((sum, row) => sum + row.clicks, 0);
    if (totalClicks <= 0) continue;

    const competing: GscCannibalizedPage[] = pages
      .map((row) => ({
        page: row.page,
        shareOfClicks: row.clicks / totalClicks,
        ...metrics(row),
      }))
      .filter((page) => page.shareOfClicks >= CANNIBALIZATION_MIN_SHARE)
      .sort((a, b) => b.clicks - a.clicks);

    if (competing.length < CANNIBALIZATION_MIN_PAGES) continue;

    const headline = queryTotals.get(query) ?? sumMetrics(pages, totalClicks);

    found.push({
      rule: "cannibalization",
      query,
      // The strongest of the competing pages — the likely consolidation target.
      page: competing[0]?.page ?? null,
      pages: competing,
      ...metrics(headline),
    });
  }

  return found
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, OPPORTUNITY_LIMIT);
}

/**
 * Fallback headline metrics from the per-page rows alone. Impressions are
 * summed (an over-count when one SERP showed two pages, but the only figure
 * available) and position is click-weighted, which keeps a page that earned
 * nothing from dragging the headline down.
 */
function sumMetrics(
  pages: readonly GscQueryPageRow[],
  totalClicks: number,
): GscMetrics {
  const impressions = pages.reduce((sum, row) => sum + row.impressions, 0);
  const weight = totalClicks > 0 ? totalClicks : pages.length;
  const position =
    totalClicks > 0
      ? pages.reduce((sum, row) => sum + row.position * row.clicks, 0) / weight
      : pages.reduce((sum, row) => sum + row.position, 0) / (pages.length || 1);

  return {
    clicks: totalClicks,
    impressions,
    ctr: impressions > 0 ? totalClicks / impressions : 0,
    position,
  };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export interface OpportunityInput {
  /** `dimensions: ["query"]` — the set the median and rules 1–2 read. */
  queryRows: readonly GscQueryRow[];
  /** `dimensions: ["query", "page"]` — rule 3, and the page attribution. */
  queryPageRows: readonly GscQueryPageRow[];
}

export interface OpportunityOutput {
  strikingDistance: GscStrikingDistanceOpportunity[];
  lowCtr: GscLowCtrOpportunity[];
  cannibalization: GscCannibalizationOpportunity[];
  thresholds: GscOpportunityThresholds;
}

/**
 * Runs all three rules over one pair of pulls and reports the thresholds they
 * used, so the UI's explanation of each list comes from the computation rather
 * than from a second copy of these numbers in a React file.
 */
export function computeOpportunities({
  queryRows,
  queryPageRows,
}: OpportunityInput): OpportunityOutput {
  const minImpressions = medianImpressions(queryRows);
  const pageByQuery = topPageByQuery(queryPageRows);
  const queryTotals = new Map<string, GscMetrics>(
    queryRows.map((row) => [row.query, metrics(row)]),
  );

  return {
    strikingDistance: findStrikingDistance(queryRows, pageByQuery, minImpressions),
    lowCtr: findLowCtr(queryRows, pageByQuery),
    cannibalization: findCannibalization(queryPageRows, queryTotals),
    thresholds: {
      strikingDistance: {
        minPosition: STRIKING_DISTANCE_MIN_POSITION,
        maxPosition: STRIKING_DISTANCE_MAX_POSITION,
        minImpressions,
      },
      lowCtr: { maxPosition: LOW_CTR_MAX_POSITION, ratio: LOW_CTR_RATIO },
      cannibalization: {
        minShareOfClicks: CANNIBALIZATION_MIN_SHARE,
        minPages: CANNIBALIZATION_MIN_PAGES,
      },
    },
  };
}
