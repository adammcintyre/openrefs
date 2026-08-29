/**
 * Presentation rules shared by every keyword surface.
 *
 * The one that matters most: **`null` is not zero.** DataForSEO returning no
 * value for a metric is a different fact from it returning 0, and the shared
 * types keep them distinct precisely so the UI can too. Everything null-ish
 * renders as an em dash; only a real 0 renders as "0".
 *
 * Locales are pinned to en-US rather than the browser's. These numbers sit
 * beside `$` amounts that come from DataForSEO in USD, and mixing a localised
 * thousands separator with a dollar sign reads as a conversion that never
 * happened. It also keeps the unit tests deterministic.
 */
import type { MonthlyVolumePoint } from "../../../shared/keywords";
import type { BadgeVariant } from "../ui";

/** What a metric renders as when the API did not report it. */
export const EM_DASH = "—";

const integerFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Whole numbers with thousands separators: search volume, result counts. */
export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return integerFormat.format(value);
}

/** Short form for tight spots — "12.4K". */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return compactFormat.format(value);
}

/** A bid or CPC in USD, to the cent. */
export function formatCpc(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * An API cost.
 *
 * Three decimals, not two: a single Labs call costs $0.011 and would round to
 * "$0.01", making two differently-priced actions look identical. Sub-tenth-cent
 * costs collapse to "< $0.001" rather than "$0.000", which would read as free.
 */
export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  if (value === 0) return "$0.000";
  if (value < 0.001) return "< $0.001";
  return `$${value.toFixed(3)}`;
}

/** A 0–1 probability as a percentage. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return `${Math.round(value * 100)}%`;
}

/** `YYYY-MM` to a chart-axis label: "2026-03" to "Mar 26". */
export function formatMonthLabel(period: string | null): string {
  if (period === null) return EM_DASH;
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;

  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${MONTHS[month - 1]} ${String(year).slice(2)}`;
}

/**
 * Monthly volume points in chronological order, oldest first.
 *
 * Charting these in wire order is not safe. Verified against the live API on
 * 2026-08-29, `/keywords/overview` returns `monthlySearches` NEWEST first
 * (2026-07 … 2025-08), while src/shared/keywords.ts documents the field as
 * "oldest first". Feeding that straight to a line chart draws twelve months of
 * history right-to-left: it looks perfectly normal and reads exactly backwards,
 * which is the worst kind of wrong.
 *
 * Sorting here is correct under either upstream order, so this stays right
 * however that discrepancy is eventually settled. `period` is `YYYY-MM`, so a
 * lexicographic compare is a chronological one. Points with no period sort
 * last rather than being dropped — an unusable date is not a reason to hide a
 * volume reading.
 */
export function sortMonthlyPoints(
  points: ReadonlyArray<MonthlyVolumePoint>,
): MonthlyVolumePoint[] {
  return [...points].sort((a, b) => {
    if (a.period === null) return b.period === null ? 0 : 1;
    if (b.period === null) return -1;
    return a.period.localeCompare(b.period);
  });
}

/** An ISO timestamp as a short absolute date. Invalid input passes through. */
export function formatDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return EM_DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/**
 * Keyword difficulty, 0–100, as a labelled band.
 *
 * The label carries the meaning rather than the colour alone: "72" tells a
 * newcomer nothing, and a red pill tells a colour-blind user nothing. Bands
 * follow the conventional quartile-ish split used across SEO tooling.
 */
export interface DifficultyBand {
  label: string;
  variant: BadgeVariant;
}

export function difficultyBand(value: number | null | undefined): DifficultyBand {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { label: EM_DASH, variant: "neutral" };
  }
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  if (clamped < 30) return { label: "Easy", variant: "success" };
  if (clamped < 50) return { label: "Medium", variant: "info" };
  if (clamped < 70) return { label: "Hard", variant: "warning" };
  return { label: "Very hard", variant: "danger" };
}

/**
 * Intent colour. Distinct hues per label so the column can be scanned, with
 * unknown labels falling through to neutral — DataForSEO owns this vocabulary
 * and may extend it, and a new label should render plainly rather than crash.
 */
export function intentVariant(intent: string | null | undefined): BadgeVariant {
  switch (intent) {
    case "transactional":
      return "success";
    case "commercial":
      return "warning";
    case "navigational":
      return "info";
    case "informational":
      return "brand";
    default:
      return "neutral";
  }
}

/** Sentence-cased intent for display; em dash when absent. */
export function formatIntent(intent: string | null | undefined): string {
  if (intent === null || intent === undefined || intent === "") return EM_DASH;
  return intent.charAt(0).toUpperCase() + intent.slice(1);
}

/**
 * A SERP feature type as a human label: "people_also_ask" to "People also ask".
 *
 * The overrides exist because the generic rule mangles acronyms — "ai_overview"
 * would sentence-case to "Ai overview". DataForSEO owns this vocabulary and
 * adds to it, so unknown types still fall through to the generic rule rather
 * than needing an entry here.
 */
const SERP_FEATURE_LABELS: Record<string, string> = {
  ai_overview: "AI overview",
  faq: "FAQ",
  google_flights: "Google Flights",
  google_hotels: "Google Hotels",
  google_news: "Google News",
  google_posts: "Google Posts",
  images: "Images",
  jobs: "Jobs",
  map: "Map",
  local_pack: "Local pack",
  paid: "Ads",
  top_stories: "Top stories",
  twitter: "X (Twitter)",
  video: "Video",
};

export function formatSerpFeature(feature: string): string {
  const override = SERP_FEATURE_LABELS[feature];
  if (override !== undefined) return override;

  const spaced = feature.replaceAll("_", " ").trim();
  if (spaced === "") return feature;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
