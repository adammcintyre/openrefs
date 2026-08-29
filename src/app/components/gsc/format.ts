/**
 * Formatting for Search Console numbers.
 *
 * Two of the four metrics are easy to render wrongly, and both mistakes are
 * silent — the page looks fine and the numbers are wrong:
 *
 *  - **`ctr` is a fraction**, exactly as Google returns it (`0.0423`), not a
 *    percentage. Printing it raw gives "0.04%" for a healthy 4.2% click-through
 *    rate, which reads as a catastrophe rather than a good result.
 *  - **`position` is 1-based and down-is-good.** It is an average, so it is
 *    fractional (8.4, not 8) and must never be rounded to an integer — the
 *    difference between 10.4 and 9.6 is the difference between page two and
 *    page one.
 *
 * Dates are the third trap. Search Console speaks `YYYY-MM-DD` with no time and
 * no zone; `new Date("2026-08-20")` parses that as UTC midnight, so formatting
 * it in a negative-offset local zone renders the day *before*. Everything here
 * formats in UTC for that reason.
 */

/** What an absent number renders as, everywhere in this module. */
export const EM_DASH = "—";

const NUMBER_FORMAT = new Intl.NumberFormat("en");

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "numeric",
  // See the file header: date-only strings are UTC midnight and must be read
  // back as UTC, or a viewer west of Greenwich sees yesterday.
  timeZone: "UTC",
});

/** Clicks and impressions — whole counts, thousands separated. */
export function formatGscCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  return NUMBER_FORMAT.format(Math.round(value));
}

/**
 * A CTR fraction as a percentage to one decimal place.
 *
 * One decimal is deliberate: CTRs live between roughly 0.1% and 30%, so whole
 * percents would collapse most of the useful range, and two decimals would
 * imply a precision that a 28-day sample of a few hundred impressions does not
 * have.
 */
export function formatGscCtr(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
    return EM_DASH;
  }
  return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Average position, one decimal.
 *
 * Position 0 is not a rank — Search Console uses it for slices where nothing
 * was ever shown — so it renders as "no data" rather than as an impossibly
 * good ranking above number one.
 */
export function formatGscPosition(value: number | null | undefined): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return EM_DASH;
  }
  return value.toFixed(1);
}

/** A share of clicks (0–1) as a whole percentage: shares are coarse by nature. */
export function formatGscShare(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
    return EM_DASH;
  }
  return `${Math.round(fraction * 100)}%`;
}

/** A `YYYY-MM-DD` date as "20 Aug 2026". Unparseable input passes through. */
export function formatGscDate(date: string | null | undefined): string {
  if (date === null || date === undefined || date === "") return EM_DASH;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return DATE_FORMAT.format(parsed);
}

/**
 * A Search Console property as a human would say it.
 *
 * Google's two property kinds are written very differently — `sc-domain:` for a
 * domain property, a full origin with a trailing slash for a URL-prefix one —
 * and neither reads well in a heading. The distinction still matters (a domain
 * property covers every subdomain and scheme), so it is kept as a separate
 * label rather than thrown away; see `gscPropertyKind`.
 */
export function formatGscProperty(property: string | null | undefined): string {
  if (property === null || property === undefined || property === "") {
    return EM_DASH;
  }
  if (property.startsWith("sc-domain:")) {
    return property.slice("sc-domain:".length);
  }
  return property.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** "Domain" or "URL prefix" — the coverage difference, kept visible. */
export function gscPropertyKind(property: string | null | undefined): string {
  if (property === null || property === undefined || property === "") return "";
  return property.startsWith("sc-domain:") ? "Domain" : "URL prefix";
}

/**
 * Google's `permissionLevel` enum in plain words.
 *
 * `siteUnverifiedUser` is the one that matters: those properties are listed by
 * the API but return no data, so the picker has to say why rather than letting
 * someone pick one and meet an empty report.
 */
export function formatGscPermission(level: string): string {
  switch (level) {
    case "siteOwner":
      return "Owner";
    case "siteFullUser":
      return "Full access";
    case "siteRestrictedUser":
      return "Restricted";
    case "siteUnverifiedUser":
      return "Unverified";
    default:
      return level;
  }
}

/** Unverified properties are listed by Google but have no data to give. */
export function isReadableGscSite(permissionLevel: string): boolean {
  return permissionLevel !== "siteUnverifiedUser";
}

/** "1 query" / "2 queries" — used in truncation notes and CSV counts. */
export function pluralGscRows(count: number, noun = "row"): string {
  const plural = noun === "query" ? "queries" : `${noun}s`;
  return `${NUMBER_FORMAT.format(count)} ${count === 1 ? noun : plural}`;
}
