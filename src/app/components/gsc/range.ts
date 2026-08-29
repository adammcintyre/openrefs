/**
 * The date window the reports run over, and remembering which one you picked.
 *
 * **Only `from` is ever sent.** The worker resolves an omitted `to` to its own
 * `freshTo` (`src/worker/gsc/reports.ts`), and its clock is the one that
 * decides what "finalised" means. Sending a `to` computed from the browser's
 * clock could only ever make the window *end early* — a machine a day slow
 * would silently drop the most recent day and quietly understate the period,
 * which is exactly the failure `GSC_DATA_LAG_DAYS` exists to prevent. Letting
 * the server end the window costs nothing and cannot be wrong.
 *
 * The default preset sends nothing at all: "last 28 complete days" is already
 * the server's default, so the common case needs no client date arithmetic.
 *
 * Whatever we ask for, the response reports the range it actually covered, and
 * that is what the UI renders. These functions decide what to *request*, never
 * what to display.
 */
import { GSC_DATA_LAG_DAYS, GSC_DEFAULT_RANGE_DAYS } from "../../../shared/gsc";

/** The presets, in the order the picker shows them. */
export const GSC_RANGE_PRESETS = [
  {
    id: "28d",
    label: "28 days",
    /** Inclusive of both ends, matching the server's own default. */
    days: GSC_DEFAULT_RANGE_DAYS,
    description: "The last 28 complete days.",
  },
  {
    id: "3m",
    label: "3 months",
    days: 90,
    description: "The last 90 complete days.",
  },
  {
    id: "6m",
    label: "6 months",
    days: 180,
    description: "The last 180 complete days.",
  },
] as const;

export type GscRangeId = (typeof GSC_RANGE_PRESETS)[number]["id"];

/** What a project shows before anyone has chosen anything. */
export const DEFAULT_GSC_RANGE: GscRangeId = "28d";

export function isGscRangeId(value: unknown): value is GscRangeId {
  return (
    typeof value === "string" &&
    GSC_RANGE_PRESETS.some((preset) => preset.id === value)
  );
}

export function gscRangePreset(id: GscRangeId) {
  return (
    GSC_RANGE_PRESETS.find((preset) => preset.id === id) ??
    GSC_RANGE_PRESETS[0]
  );
}

/* ------------------------------ date arithmetic ---------------------------- */

/** `YYYY-MM-DD` for a Date, read in UTC. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * The newest day Search Console is assumed to have finalised, from the
 * browser's clock.
 *
 * Only ever used to place the *start* of a window — see the file header. The
 * authoritative `freshTo` is the one on the response.
 */
export function clientFreshTo(now: Date): string {
  return toIsoDate(addDays(now, -GSC_DATA_LAG_DAYS));
}

/**
 * The query parameters for a preset.
 *
 * The default preset returns `{}` on purpose: no dates in the URL means the
 * server's definition of the default window, which is the same window, decided
 * by the clock that is actually authoritative.
 */
export function gscRangeRequest(
  id: GscRangeId,
  now: Date,
): { from?: string } {
  if (id === DEFAULT_GSC_RANGE) return {};
  const preset = gscRangePreset(id);
  const end = new Date(`${clientFreshTo(now)}T00:00:00Z`);
  // Inclusive of both ends, so N days back from the end is `end - (N - 1)`.
  return { from: toIsoDate(addDays(end, -(preset.days - 1))) };
}

/** The query-string fragment for a preset, ready to append to a report path. */
export function gscRangeQuery(id: GscRangeId, now: Date): string {
  const { from } = gscRangeRequest(id, now);
  return from === undefined ? "" : `&from=${encodeURIComponent(from)}`;
}

/* -------------------------------- persistence ------------------------------ */

/*
 * Per project, not per workspace: a workspace can hold a site with six years of
 * history and one launched last month, and the useful window for those two is
 * not the same. Keying by project means switching between them restores each
 * one's own answer instead of imposing whichever was looked at last.
 */
const KEY_PREFIX = "openrefs.searchConsole.range:";

/**
 * Validate a stored value before trusting it. Separate from localStorage so it
 * can be tested directly, and because a preset id written by an older build
 * must fall back to the default rather than reaching a request as a date.
 */
export function parseStoredGscRange(raw: string | null): GscRangeId | null {
  return isGscRangeId(raw) ? raw : null;
}

export function readLastGscRange(projectId: string | null): GscRangeId | null {
  if (projectId === null || projectId === "") return null;
  try {
    return parseStoredGscRange(
      globalThis.localStorage?.getItem(`${KEY_PREFIX}${projectId}`) ?? null,
    );
  } catch {
    // Private mode, a quota, or a browser policy. A preference is never worth
    // failing a render for.
    return null;
  }
}

export function writeLastGscRange(
  projectId: string | null,
  id: GscRangeId,
): void {
  if (projectId === null || projectId === "") return;
  try {
    globalThis.localStorage?.setItem(`${KEY_PREFIX}${projectId}`, id);
  } catch {
    /* Preference only — the module works without it. */
  }
}
