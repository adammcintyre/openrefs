/**
 * Formatting for link-profile data. Pure functions only, for the same reason
 * `components/domains/format.ts` is: the table cell, the metric card and the
 * CSV row must never disagree about what a number means.
 *
 * Generic formatting (counts, money, the cost chip, periods) is imported from
 * the domains module rather than re-written here. What is genuinely local:
 *
 *  - **Scores are already 0–100.** The Worker converted the provider's raw
 *    0–1000 rank once, in `dataforseo/scores.ts`. Nothing on this side divides,
 *    scales or re-bands anything; `scoreBand()` from the shared types is the
 *    single source of the thresholds.
 *  - **Dofollow figures are derived and often null.** The provider publishes
 *    nofollow counts and totals but never a dofollow count, so a null ratio
 *    means "not computable", which is neither 0% nor 100% and must not render
 *    as either.
 */
import type { BadgeVariant } from "../ui";
import type { DofollowSplit, ScoreBand } from "../../../shared/backlinks";
import { scoreBand } from "../../../shared/backlinks";
import { EM_DASH, formatCount } from "../domains/format";

const PERCENT = new Intl.NumberFormat("en", {
  style: "percent",
  maximumFractionDigits: 0,
});

const DAY = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * A 0–100 score as it appears on screen.
 *
 * Rounded, because a Domain Score of "63.4" implies a precision the underlying
 * estimate does not have, and because the whole point of the 0–100 scale is
 * that it fits in a badge.
 */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return String(Math.round(value));
}

/**
 * The badge colour for a score band.
 *
 * A four-step ramp of distinct hues rather than a good/bad red-green axis: a
 * low-authority linking domain is a fact about the web, not an error, and
 * painting it red would tell users to go delete their own backlinks. Every
 * variant pairs a `*-subtle` background with its measured `*-on-subtle` text,
 * and the number itself is always rendered beside the colour, so nothing here
 * depends on colour alone.
 */
export function scoreVariant(band: ScoreBand | null): BadgeVariant {
  switch (band) {
    case "very-high":
      return "success";
    case "high":
      return "brand";
    case "medium":
      return "info";
    case "low":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Convenience for the common `scoreVariant(scoreBand(n))` pairing. */
export function variantForScore(value: number | null | undefined): BadgeVariant {
  return scoreVariant(scoreBand(value));
}

/**
 * Text colour for the one place a score is rendered large rather than in a
 * badge: the headline Domain Score card.
 *
 * These are the solid semantic tokens, each measured at 6:1 or better against
 * `--surface` in both themes, so the number clears AA at any size. The band is
 * also named in a badge beside it — the colour is reinforcement, not the
 * message.
 */
export function scoreTextClass(band: ScoreBand | null): string {
  switch (band) {
    case "very-high":
      return "text-success";
    case "high":
      return "text-primary";
    case "medium":
      return "text-info";
    case "low":
      return "text-foreground";
    default:
      return "text-muted-foreground";
  }
}

/** Plain-English band name, for tooltips and screen readers. */
export function bandLabel(band: ScoreBand | null): string {
  switch (band) {
    case "very-high":
      return "very high authority";
    case "high":
      return "high authority";
    case "medium":
      return "medium authority";
    case "low":
      return "low authority";
    default:
      return "authority not reported";
  }
}

/** A 0–1 ratio as a whole percentage. Null stays an em dash, never "0%". */
export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return PERCENT.format(Math.max(0, Math.min(1, value)));
}

/** The dofollow share of a split, formatted. */
export function formatDofollow(split: DofollowSplit | null | undefined): string {
  return formatRatio(split?.dofollowRatio);
}

/**
 * The tooltip behind a dofollow percentage — the counts it was derived from, or
 * an explanation of why there is no percentage at all.
 *
 * Worth spelling out: users who know the Backlinks API know it does not report
 * a dofollow count, and users who do not will otherwise read a missing number
 * as a bug.
 */
export function dofollowTitle(split: DofollowSplit | null | undefined): string {
  if (split?.dofollowRatio === null || split?.dofollowRatio === undefined) {
    return "DataForSEO did not report enough to derive a dofollow share for this row.";
  }
  return `Derived: ${formatCount(split.dofollowPages)} dofollow of ${formatCount(
    (split.dofollowPages ?? 0) + (split.nofollowPages ?? 0),
  )} referring pages.`;
}

/**
 * `yyyy-mm-dd hh-mm-ss +00:00` — the provider's timestamp shape — as a date.
 *
 * Only the date half is kept: "first seen" is a crawl artefact accurate to
 * roughly a day, and a time of day implies otherwise. Anything unparseable
 * passes through so a shape change shows up as odd text rather than as a
 * silently empty column.
 */
export function formatSeen(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return EM_DASH;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (match === null) return value;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return value;
  return DAY.format(date);
}

/** The date half of a provider timestamp, for CSV cells that must sort. */
export function seenDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value.trim());
  return match === null ? null : match[0];
}

/**
 * Anchor text, made safe to put in a table row.
 *
 * Anchors are arbitrary strings scraped off other people's pages: they arrive
 * with newlines, runs of whitespace, and sometimes nothing at all. An empty
 * anchor is a real and common thing (image links, bare URLs), and saying so is
 * more useful than an em dash that reads as missing data.
 */
export function formatAnchor(value: string | null | undefined): string {
  if (value === null || value === undefined) return EM_DASH;
  const collapsed = value.replaceAll(/\s+/g, " ").trim();
  return collapsed === "" ? "(empty anchor)" : collapsed;
}
