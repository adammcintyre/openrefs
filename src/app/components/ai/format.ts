/**
 * Presentation rules for AI Visibility, kept out of JSX so the ones that are
 * easy to render plausibly and wrongly can be pinned by tests.
 *
 * Four of them carry real risk:
 *
 * 1. **A pre-run cost is an estimate; a post-run cost is a fact.** `AI_ENGINES
 *    [id].estimatedCostUsd` is a guess at a token bill plus a web-search fee
 *    that dominates it, and two of the four engine figures are extrapolated
 *    rather than measured (see src/shared/ai.ts). `snapshot.costUsd` is what
 *    DataForSEO actually charged. They are formatted by two different
 *    functions here so a screen cannot quietly print one where it means the
 *    other — `formatEstimate` says "est.", `formatSpend` never does.
 *
 * 2. **Highlighting must search, never seek.** The excerpt is a *window* onto
 *    a longer answer, so any offset computed against the full response points
 *    at the wrong characters — or past the end. The contract says to search
 *    case-insensitively for `mentionTerms`, and `highlightSegments` does
 *    exactly that, with no regex anywhere near a term (see its own note).
 *
 * 3. **A rate of null is not a rate of zero.** `mentionRate` is null on a day
 *    an engine did not run. Coercing it to 0 draws a line plunging to the
 *    floor and reads as "you lost all your mentions" when the truth is "no
 *    measurement exists". Nulls stay null and the chart leaves a gap.
 *
 * 4. **Mentioned and cited are different claims.** An assistant can describe
 *    your site without linking it, and can link it without naming it. Nothing
 *    here derives one from the other.
 */
import type {
  AiEngineId,
  AiEngineTimeline,
  AiSnapshot,
} from "../../../shared/ai";
import { AI_ENGINES } from "../../../shared/ai";

/* --------------------------------- money ---------------------------------- */

/**
 * A USD figure at a readable precision.
 *
 * Sub-cent amounts are the norm here — a Perplexity call is $0.006 — so two
 * decimals would round most of this product's prices to "$0.01" or "$0.00".
 * Anything under a cent keeps three decimals; a dollar or more drops to two,
 * where a tenth of a cent is noise.
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return `$${amount.toFixed(3)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

/**
 * A cost we have not incurred yet. Always hedged, always labelled.
 *
 * The "est." is not politeness. DataForSEO bills the LLM provider's token cost
 * plus its web-search charge straight through, and the search charge is the
 * bulk of it — the same ChatGPT model costs 35× more with a search than
 * without. A number printed here without a hedge is a number a user will
 * reasonably treat as a price.
 */
export function formatEstimate(amount: number): string {
  return `est. ${formatUsd(amount)}`;
}

/** A cost already charged. `snapshot.costUsd` — never hedged, never "≈". */
export function formatSpend(amount: number): string {
  return formatUsd(amount);
}

/** The real total across a set of snapshots. */
export function totalSpend(snapshots: ReadonlyArray<AiSnapshot>): number {
  const total = snapshots.reduce((sum, snapshot) => sum + snapshot.costUsd, 0);
  return Math.round(total * 1_000_000) / 1_000_000;
}

/* --------------------------------- engines --------------------------------- */

/** The badge label for an engine id, falling back to the id itself. */
export function engineLabel(engine: AiEngineId): string {
  return AI_ENGINES[engine]?.label ?? engine;
}

/**
 * Engine ids in the order the picker and the legend should show them.
 *
 * `AI_ENGINES` is declared cheapest first and the add-prompt dialog quotes a
 * price against every checkbox, so cheapest-first is also the order that puts
 * the affordable choice under the cursor.
 */
export const ENGINE_ORDER: readonly AiEngineId[] = Object.values(AI_ENGINES).map(
  (engine) => engine.id,
);

/* ---------------------------------- rates ---------------------------------- */

/**
 * A 0–1 rate as a percentage string, or an em dash when there is no rate.
 *
 * Null means "nothing ran", which is not 0% — see the file header.
 */
export function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${formatPercentValue(rate * 100)}%`;
}

/** One decimal, but only when the decimal says something. */
function formatPercentValue(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** A 0–1 rate on the chart's 0–100 scale, preserving null. */
export function toPercent(rate: number | null): number | null {
  if (rate === null) return null;
  return Math.round(rate * 1000) / 10;
}

/**
 * The per-engine timelines merged into the row-per-date shape Recharts wants.
 *
 * Engines run independently, so their point sets do not line up: Perplexity may
 * have Monday and Thursday where ChatGPT has only Thursday. The union of every
 * date becomes the x axis, and an engine with no run on a date gets `null` —
 * not 0 — so the line breaks rather than dropping to the floor.
 */
export interface MentionRateDatum extends Record<string, unknown> {
  date: string;
}

export function mergeTimelines(
  timelines: ReadonlyArray<AiEngineTimeline>,
): MentionRateDatum[] {
  const byDate = new Map<string, MentionRateDatum>();

  for (const timeline of timelines) {
    for (const point of timeline.points) {
      let row = byDate.get(point.date);
      if (row === undefined) {
        row = { date: point.date };
        byDate.set(point.date, row);
      }
      row[timeline.engine] = toPercent(point.mentionRate);
    }
  }

  // ISO dates sort correctly as strings, oldest first — which is the direction
  // a trend is read in.
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* -------------------------------- highlight -------------------------------- */

/** A run of excerpt text, flagged as a mention match or not. */
export interface ExcerptSegment {
  text: string;
  match: boolean;
}

interface Range {
  start: number;
  end: number;
}

/**
 * Split an excerpt into plain and highlighted runs.
 *
 * **No regular expressions.** A term is arbitrary third-party-adjacent text —
 * a domain, a brand name — and domains are full of dots. Compiled into a
 * pattern, `brandpacks.com` would match `brandpacksXcom`, and a term
 * containing `(` would throw. Plain `indexOf` over lowercased copies cannot be
 * confused by either, and needs no escaping to get right.
 *
 * **Ranges are merged.** Terms overlap constantly in practice — the contract
 * sends both `brandpacks.com` and `brandpacks` — and emitting one segment per
 * raw hit would wrap the same characters twice, producing nested marks and
 * duplicated text. Overlapping and touching ranges collapse into one.
 *
 * The returned segments always concatenate back to exactly the input, so the
 * caller can render them in order and be certain nothing was dropped or
 * doubled.
 */
export function highlightSegments(
  excerpt: string,
  terms: ReadonlyArray<string>,
): ExcerptSegment[] {
  if (excerpt === "") return [];

  const haystack = excerpt.toLowerCase();
  const ranges: Range[] = [];

  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    // An empty term matches at every index; left in, it would never terminate.
    if (term === "") continue;

    let from = 0;
    for (;;) {
      const index = haystack.indexOf(term, from);
      if (index === -1) break;
      ranges.push({ start: index, end: index + term.length });
      // Past this hit rather than one character on: self-overlapping matches
      // ("aa" inside "aaa") would only ever extend a range the merge below is
      // about to join anyway.
      from = index + term.length;
    }
  }

  if (ranges.length === 0) return [{ text: excerpt, match: false }];

  ranges.sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end) {
      // Touching counts as overlapping: adjacent terms should read as one
      // highlighted phrase, not two marks with an invisible seam.
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }

  const segments: ExcerptSegment[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      segments.push({ text: excerpt.slice(cursor, range.start), match: false });
    }
    segments.push({ text: excerpt.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < excerpt.length) {
    segments.push({ text: excerpt.slice(cursor), match: false });
  }

  return segments;
}

/* ---------------------------------- dates ---------------------------------- */

/**
 * One formatter for every date this module prints, matching the one rank
 * tracking uses — same locale, same UTC pinning, same never-a-clock-time rule.
 *
 * **UTC** because snapshots are one row per prompt per engine per *day*:
 * rendering `2026-08-27` in the viewer's timezone shows the 26th anywhere west
 * of UTC. **A fixed locale** because the alternative (`undefined`) makes the
 * rendered output depend on the machine, which is untestable and inconsistent
 * with every other date in the app.
 */
const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A `YYYY-MM-DD` snapshot date. */
export function formatDay(day: string): string {
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return day;
  return DAY_FORMAT.format(new Date(parsed));
}

/**
 * An ISO timestamp as a day.
 *
 * `lastRunAt` is a real moment rather than a day bucket, but it is still shown
 * as a date: the useful fact is which day an answer was bought, and a clock
 * time would imply a precision the weekly cadence does not have.
 */
export function formatLastRun(iso: string | null): string {
  if (iso === null) return "Never run";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "Never run";
  return DAY_FORMAT.format(new Date(parsed));
}

/* --------------------------------- counting -------------------------------- */

export function pluralPrompts(count: number): string {
  return `${count} ${count === 1 ? "prompt" : "prompts"}`;
}

export function pluralCitations(count: number): string {
  return `${count} ${count === 1 ? "citation" : "citations"}`;
}

/**
 * "12 calls across 4 prompts" — what a run is about to buy.
 *
 * A run bills per prompt × engine, not per prompt, and that multiplier is the
 * whole reason the estimate is bigger than people expect.
 */
export function describeRun(promptCount: number, callCount: number): string {
  const calls = `${callCount} ${callCount === 1 ? "call" : "calls"}`;
  return `${calls} across ${pluralPrompts(promptCount)}`;
}

/* ------------------------------ safe link-ing ------------------------------ */

/**
 * Only http(s) becomes a link — the same discipline SerpPanel applies, and for
 * the same reason: a citation URL is third-party data on its way into an
 * `href`, where a `javascript:` value would be script execution on our origin.
 *
 * The contract already sets `host` to null for anything that is not http(s),
 * but this re-checks rather than trusting that flag to have been derived the
 * way we assume. Anything rejected renders as plain text.
 */
export function safeHttpUrl(url: string): string | null {
  if (url === "") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** What to show as a citation's visible text: its host, title, or the raw URL. */
export function citationLabel(citation: {
  host: string | null;
  title: string | null;
  url: string;
}): string {
  const title = citation.title?.trim() ?? "";
  if (title !== "") return title;
  if (citation.host !== null && citation.host !== "") return citation.host;
  return citation.url;
}
