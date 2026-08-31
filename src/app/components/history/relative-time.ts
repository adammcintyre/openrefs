/**
 * "3 days ago", for the search trail and the freshness chips.
 *
 * Pure and injectable (`now`) so the rounding rules can be pinned by tests
 * without freezing the clock. Two decisions worth stating:
 *
 *  - **Coarse on purpose.** These timestamps answer "is what I am looking at
 *    old?", not "when exactly". Minute precision past the first hour would
 *    imply the underlying data has a resolution it does not — a DataForSEO
 *    payload cached for three days is three days old whichever minute it
 *    landed on.
 *  - **A future timestamp is not an error.** Clock skew between a browser and
 *    the Worker is normal and small; anything up to the "just now" window reads
 *    as "just now" rather than as "in 4 seconds", which would look broken.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** The average Gregorian month, which is close enough at this resolution. */
const MONTH = 30.436_875 * DAY;
const YEAR = 365.2425 * DAY;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * An ISO 8601 timestamp as an age, or null when there is nothing to say.
 *
 * Null (rather than a placeholder) for absent and unparseable input, so callers
 * can drop the whole chip instead of rendering "Updated —", which reads as a
 * failure rather than as an absence.
 */
export function relativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;

  const elapsed = now.getTime() - parsed;
  // Future or sub-minute: clock skew, or genuinely a moment ago.
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), "hour");
  if (elapsed < WEEK) return plural(Math.floor(elapsed / DAY), "day");
  if (elapsed < MONTH) return plural(Math.floor(elapsed / WEEK), "week");
  if (elapsed < YEAR) return plural(Math.floor(elapsed / MONTH), "month");
  return plural(Math.floor(elapsed / YEAR), "year");
}

const EXACT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** The precise moment, for a tooltip behind the coarse label. Always UTC. */
export function exactTime(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined || iso === "") return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return `${EXACT.format(new Date(parsed))} UTC`;
}
