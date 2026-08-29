/**
 * Formatting for domain-shaped data. Pure functions only — every table cell,
 * metric card and CSV row goes through here so the two never disagree.
 *
 * The rule that drives most of this file: `null` from the API means "not
 * reported", which is not the same claim as zero. A domain with no paid
 * presence and a domain DataForSEO simply did not measure must not render
 * identically, so null becomes an em dash everywhere and zero stays "0".
 */
import type { ResultMeta } from "../../../shared/api";

export const EM_DASH = "—";

const INTEGER = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const MONEY_2DP = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONEY_0DP = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Whole numbers with separators: keyword counts, positions, common keywords. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return INTEGER.format(value);
}

/**
 * Estimated traffic (DataForSEO's `etv`) arrives as a float. Nobody reads
 * "1,204.63 visits" as more precise than "1,205", and the decimals imply a
 * measurement this number is not, so it rounds.
 */
export function formatTraffic(value: number | null | undefined): string {
  return formatCount(
    value === null || value === undefined ? value : Math.round(value),
  );
}

/** Whole dollars — traffic value, where cents are noise. */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return MONEY_0DP.format(value);
}

/** Cents matter here: CPC is usually under a dollar. */
export function formatCpc(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return MONEY_2DP.format(value);
}

/**
 * The provenance chip next to every result set.
 *
 * Three states, not two: a cached read cost nothing and can be re-run fresh; a
 * live read cost real money and the amount is worth showing; and a live read
 * billed at zero (sandbox, or an endpoint DataForSEO does not charge for) is
 * neither, so it says so rather than claiming "$0.00 live" and looking broken.
 * Sub-cent costs render as "<$0.01" because rounding a real charge down to
 * "$0.00" reads as free.
 */
export function formatCostChip(meta: ResultMeta): string {
  if (meta.cached) return "cached";
  if (!Number.isFinite(meta.costUsd) || meta.costUsd <= 0) return "live · no charge";
  if (meta.costUsd < 0.01) return "<$0.01 live";
  return `${MONEY_2DP.format(meta.costUsd)} live`;
}

/** The chip's tooltip — the "why" behind the three words on screen. */
export function costChipTitle(meta: ResultMeta): string {
  return meta.cached
    ? "Served from this workspace's cache. No DataForSEO credits were spent."
    : `Fetched live from DataForSEO. Billed to your key: ${MONEY_2DP.format(
        Math.max(0, meta.costUsd),
      )}.`;
}

/**
 * Rolls several pages of an infinitely-loaded table into one chip's worth of
 * meta. "Cached" only holds if *every* page was — one live page means the user
 * was charged, and the total is what they were charged.
 */
export function aggregateMeta(pages: ReadonlyArray<ResultMeta>): ResultMeta | null {
  if (pages.length === 0) return null;
  return {
    costUsd: pages.reduce((total, page) => total + (page.costUsd || 0), 0),
    cached: pages.every((page) => page.cached),
  };
}

/**
 * A pasted URL to the bare hostname the API wants.
 *
 * The Worker normalises too (`normalizeDomain` in worker/lib/research.ts) and
 * this deliberately mirrors it: doing it client-side as well means the value we
 * put in `?target=` and print in the heading is the same string the query
 * actually ran against, instead of the URL the user happened to paste.
 * `example.com/pricing` is a *page* query upstream and returns a fraction of
 * the keywords, so dropping the path is a correctness fix, not tidiness.
 */
export function normalizeDomainInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^www\./, "")
    // Path, query and fragment all end the hostname.
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

/** Cheap client-side check so an obvious typo never costs a call. */
export function isLikelyDomain(value: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(value);
}

/**
 * The path half of a page URL, for the Top pages table.
 *
 * Full URLs in a table column are almost all shared prefix — twenty rows of
 * "https://example.com/…" tell you nothing and push the useful part off the
 * edge. The full URL stays available as the cell's title and link href.
 */
export function urlPath(url: string | null | undefined): string {
  if (url === null || url === undefined || url === "") return EM_DASH;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    // Not absolute — show whatever we were given rather than hiding the row.
    return url;
  }
}

/** `2026-03` to `Mar 2026` for chart axes; anything unparseable passes through. */
export function formatPeriod(period: string | null | undefined): string {
  if (period === null || period === undefined || period === "") return EM_DASH;
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (match === null) return period;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Month-over-month change for a MetricCard delta.
 *
 * Returns null rather than Infinity when the earlier month was zero or
 * missing: "up ∞%" is not a fact about a website.
 */
export function percentChange(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Signed percentage for a delta label: `+12.4%`, `-3.0%`, `0.0%`. */
export function formatPercentDelta(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
