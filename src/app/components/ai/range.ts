/**
 * The results window.
 *
 * Snapshots are day-grained and the API takes `from`/`to` as `YYYY-MM-DD`, so
 * every date here is computed in **UTC**. Building the range from a local
 * `new Date()` would, west of UTC, ask for a window ending yesterday and
 * silently hide a run that happened this morning.
 */

/** The windows the picker offers, longest last. */
export const RESULT_WINDOWS = [
  { id: "7", days: 7, label: "Last 7 days" },
  { id: "30", days: 30, label: "Last 30 days" },
  { id: "90", days: 90, label: "Last 90 days" },
] as const;

export type ResultWindowId = (typeof RESULT_WINDOWS)[number]["id"];

/**
 * The default. Matches `AI_RESULTS_DEFAULT_DAYS`, and is the right default for
 * a feature that runs weekly: 30 days would show four points.
 */
export const DEFAULT_WINDOW: ResultWindowId = "90";

export function isResultWindowId(value: unknown): value is ResultWindowId {
  return (
    typeof value === "string" &&
    RESULT_WINDOWS.some((window) => window.id === value)
  );
}

/** `YYYY-MM-DD` in UTC. */
export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `{ from, to }` for a window, inclusive of today.
 *
 * `days` counts back from today *inclusive*, so a 7-day window is today plus
 * the six before it — the reading of "last 7 days" that matches what a person
 * counting on a calendar would get.
 */
export function windowRange(
  windowId: ResultWindowId,
  today = new Date(),
): { from: string; to: string } {
  const days =
    RESULT_WINDOWS.find((window) => window.id === windowId)?.days ?? 90;

  const to = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    ),
  );
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));

  return { from: toIsoDay(from), to: toIsoDay(to) };
}
