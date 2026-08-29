/**
 * Presentation rules for rank tracking, kept away from JSX so the ones that
 * are easy to get subtly wrong can be pinned by tests.
 *
 * Three of them carry real risk of being rendered plausibly and wrongly:
 *
 * 1. **"Never checked" and "not in the top 100" are different states.** The
 *    contract in src/shared/tracking.ts distinguishes `latest === null` (no
 *    observation exists) from `latest.position === null` (an observation that
 *    found nothing in the top 100). Collapsing them into one dash would tell a
 *    user their brand-new keyword does not rank, minutes before the first
 *    check has even run.
 *
 * 2. **A positive change is an improvement, and is already computed that way.**
 *    The Worker returns `older - newer`, so 8 → 3 arrives as `+5`. Position is
 *    a down-is-good metric, but that inversion has *already been applied*;
 *    re-applying it here would paint every gain red. Positive is green, full
 *    stop.
 *
 * 3. **`lastCheckedAt` is a day, not a moment.** Snapshots are one row per
 *    keyword per day and the Worker widens that date to UTC midnight at the
 *    boundary. Formatting it in the viewer's timezone would show "23:00" and,
 *    west of UTC, the previous day's date. Everything here formats in UTC and
 *    never prints a clock time.
 */
import type {
  RankSnapshot,
  TrackedKeywordRow,
} from "../../../shared/tracking";

/* ------------------------------- positions -------------------------------- */

export type PositionState =
  /** No snapshot at all — the check has not run yet. */
  | { kind: "awaiting" }
  /** Checked, and the domain was nowhere in the top 100. */
  | { kind: "unranked"; date: string }
  | { kind: "ranked"; position: number; date: string };

export function positionState(latest: RankSnapshot | null): PositionState {
  if (latest === null) return { kind: "awaiting" };
  if (latest.position === null) {
    return { kind: "unranked", date: latest.date };
  }
  return { kind: "ranked", position: latest.position, date: latest.date };
}

/**
 * The position cell's text.
 *
 * "—" is reserved for a measured absence. An unchecked keyword gets words,
 * because a dash there would be a claim we have not earned.
 */
export function formatPosition(latest: RankSnapshot | null): string {
  const state = positionState(latest);
  if (state.kind === "awaiting") return "Awaiting first check";
  if (state.kind === "unranked") return "—";
  return String(state.position);
}

/** Longer form for the cell's `title`, where there is room to explain. */
export function positionTitle(latest: RankSnapshot | null): string {
  const state = positionState(latest);
  if (state.kind === "awaiting") {
    return "No check has completed for this keyword yet.";
  }
  if (state.kind === "unranked") {
    return `Checked ${formatDay(state.date)}: not in the top 100.`;
  }
  return `Position ${state.position} on ${formatDay(state.date)}.`;
}

export function formatBestPosition(best: number | null): string {
  return best === null ? "—" : String(best);
}

/* -------------------------------- changes --------------------------------- */

/**
 * A signed delta. Positive is an improvement — see rule 2 in the file header —
 * and the sign is always shown so "+2" can never be read as a position.
 */
export function formatChange(change: number | null): string {
  if (change === null) return "—";
  if (change === 0) return "0";
  return change > 0 ? `+${change}` : String(change);
}

export type ChangeTone = "up" | "down" | "flat";

export function changeTone(change: number | null): ChangeTone {
  if (change === null || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}

/** Tailwind classes per tone. Colour is a second channel, never the only one. */
export const CHANGE_TONE_CLASS: Record<ChangeTone, string> = {
  up: "text-success",
  down: "text-danger",
  flat: "text-muted-foreground",
};

/** What the delta means in words, for the cell's `title` and for a11y. */
export function changeTitle(change: number | null, days: number): string {
  if (change === null) {
    return `No observation from ${days} day${days === 1 ? "" : "s"} ago to compare against.`;
  }
  const window = `${days} day${days === 1 ? "" : "s"}`;
  if (change === 0) return `Unchanged over ${window}.`;
  const places = Math.abs(change);
  const direction = change > 0 ? "Up" : "Down";
  return `${direction} ${places} place${places === 1 ? "" : "s"} over ${window}.`;
}

/* --------------------------------- dates ---------------------------------- */

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  // Snapshots are day-grained; the viewer's timezone must not shift the date.
  timeZone: "UTC",
});

/** `YYYY-MM-DD` or an ISO timestamp as a plain date. Never a clock time. */
export function formatDay(value: string | null): string {
  if (value === null || value === "") return "—";
  const iso = value.length === 10 ? `${value}T00:00:00Z` : value;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  return DAY_FORMAT.format(new Date(parsed));
}

/** The header's "last checked", including the never-checked case. */
export function formatLastChecked(lastCheckedAt: string | null): string {
  return lastCheckedAt === null ? "Not checked yet" : formatDay(lastCheckedAt);
}

/* ------------------------------ ranking URLs ------------------------------- */

/*
 * The ranking-URL column reuses `urlPath` from components/domains/format.ts
 * rather than growing its own copy: "show the path, keep the full URL in the
 * title" is the same problem the Top pages table already solved, down to the
 * em dash for a missing value. Re-exported here so the tracking table imports
 * its formatting from one place.
 */
export { urlPath as rankingPath } from "../domains/format";

/* -------------------------------- metrics --------------------------------- */

/** Keywords currently in the top 10. Unranked and unchecked do not count. */
export function topTenCount(rows: ReadonlyArray<TrackedKeywordRow>): number {
  return rows.filter(
    (row) => row.latest !== null && row.latest.position !== null && row.latest.position <= 10,
  ).length;
}

/**
 * Mean position across the keywords that currently rank.
 *
 * Null when none do. Unranked keywords are excluded rather than counted as
 * 100: substituting a number for "absent" would make the average improve every
 * time a keyword fell out of the top 100 and was replaced by a worse-but-
 * present one, which is the opposite of what happened.
 */
export function averagePosition(
  rows: ReadonlyArray<TrackedKeywordRow>,
): number | null {
  const positions = rows
    .map((row) => row.latest?.position ?? null)
    .filter((position): position is number => position !== null);
  if (positions.length === 0) return null;
  const total = positions.reduce((sum, position) => sum + position, 0);
  return total / positions.length;
}

export function formatAveragePosition(average: number | null): string {
  return average === null ? "—" : average.toFixed(1);
}

/**
 * Net movement over 7 days: the sum of every comparable Δ7d.
 *
 * Positive means the tracked set improved on balance. Keywords with no
 * baseline contribute nothing rather than zero — they are unmeasured, not
 * unmoved — so `comparable` is reported alongside, and the card says so.
 */
export function netChange7d(rows: ReadonlyArray<TrackedKeywordRow>): {
  net: number;
  comparable: number;
} {
  let net = 0;
  let comparable = 0;
  for (const row of rows) {
    if (row.change7d === null) continue;
    net += row.change7d;
    comparable += 1;
  }
  return { net, comparable };
}

/* --------------------------------- money ---------------------------------- */

/**
 * A cost hint. Sub-cent figures are the norm here (a 3-keyword check is
 * $0.018), so this keeps enough precision to avoid rounding an estimate to
 * "$0.00" and implying the check is free.
 */
export function formatCostHint(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** Plural-safe "N keywords". */
export function pluralKeywords(count: number): string {
  return `${count.toLocaleString("en")} keyword${count === 1 ? "" : "s"}`;
}

/* ------------------------------ keyword input ------------------------------ */

export interface ParsedKeywords {
  /** What will actually be sent: trimmed, lowercased, de-duplicated. */
  keywords: string[];
  /** Non-empty lines typed, before de-duplication. */
  lines: number;
  /** How many lines were dropped as repeats of an earlier one. */
  duplicates: number;
}

/**
 * The Add-keywords textarea, one keyword per line.
 *
 * Mirrors what the route does to the list (trim, lowercase, de-duplicate)
 * rather than approximating it, so the count shown next to the button is the
 * count that will be added. `duplicates` exists so the dialog can say "3 of
 * these are repeats" *before* the user submits — the server would report them
 * as `skipped` afterwards, which is a worse moment to find out.
 *
 * Case-insensitive because the route lowercases: "Photo Booth" and
 * "photo booth" are one tracked keyword, not two.
 */
export function parseKeywordLines(input: string): ParsedKeywords {
  const seen = new Set<string>();
  const keywords: string[] = [];
  let lines = 0;

  for (const raw of input.split(/\r?\n/)) {
    const keyword = raw.trim().toLowerCase();
    if (keyword === "") continue;
    lines += 1;
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    keywords.push(keyword);
  }

  return { keywords, lines, duplicates: lines - keywords.length };
}
