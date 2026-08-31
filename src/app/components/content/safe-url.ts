/**
 * Third-party URLs are about to become `href` attributes, so their scheme is
 * checked rather than trusted.
 *
 * Every URL in this module came from a SERP — data DataForSEO scraped from
 * Google, which we did not author and cannot vouch for. A `javascript:` value
 * reaching an `href` is script execution on our origin, with the user's session
 * cookie; `data:` URLs can carry HTML that runs in the same position. So the
 * rule is an allowlist of two schemes, not a denylist of the ones we thought of.
 *
 * The same check exists inside `components/serp-panel.tsx`, which is not
 * exported. This copy is the one Content Discovery uses, and unlike that one it
 * is tested.
 */

/** The URL if it is safe to link to, otherwise null. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === "") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/**
 * The path a row displays under its title, e.g. `/blog/photo-booths`.
 *
 * The bare host is dropped because the domain has its own column beside it, and
 * repeating it in every row costs the horizontal space the title needs. A root
 * URL shows "/" rather than an empty cell, so the row still reads as a page.
 * Anything unparseable falls back to the raw string: showing the odd URL is
 * better than showing a blank where a result was.
 */
export function displayPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}
