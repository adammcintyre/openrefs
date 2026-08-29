/**
 * A backlinks target is not a domain, and that difference is the whole reason
 * this file exists next to `components/domains/format.ts`.
 *
 * `normalizeDomainInput` over there deliberately throws away the path, because
 * asking DataForSEO's Labs endpoints about `example.com/pricing` returns a
 * fraction of the keywords the site actually ranks for. The Backlinks API is the
 * opposite: a page-level query ("who links to this one article") is a first
 * class thing to ask, so the path must survive intact.
 *
 * What is normalised here mirrors `normalizeBacklinksTarget` in
 * `src/worker/dataforseo/backlinks.ts` — a bare host is lowercased and loses
 * `www.` and any trailing slash or dot, while a URL is left alone apart from its
 * scheme and host. Mirroring matters because the string we put in `?target=` and
 * print in the page heading should be the string the query actually ran against,
 * not the one the user happened to paste.
 */

/** What kind of thing the user asked about. Drives labels, not behaviour. */
export type TargetKind = "domain" | "url";

/*
 * Both patterns are copied from the Worker's `targetParam` refine in
 * routes/backlinks.ts. Checking client-side means an obvious typo costs a
 * validation message instead of a round trip and a 422.
 */
const URL_TARGET = /^https?:\/\/\S+$/i;
const DOMAIN_TARGET = /^[a-z0-9.-]+\.[a-z]{2,}\/?$/i;

/**
 * Lowercase the scheme and host, drop the fragment, leave the path and query
 * exactly as typed — URL paths are case-sensitive and `?ref=Foo` is not the
 * same page as `?ref=foo`.
 *
 * An origin-only URL collapses to its bare host: `https://example.com/` and
 * `example.com` are the same question upstream, and the short form is the one
 * worth showing in a heading.
 */
function normalizeUrlTarget(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Unparseable. Hand it back untouched and let validation reject it with a
    // message, rather than mangling it into something that looks valid.
    return raw;
  }

  url.hash = "";
  const host = url.host.toLowerCase();
  const scheme = url.protocol.toLowerCase();
  const path = url.pathname === "/" ? "" : url.pathname;

  if (path === "" && url.search === "") return host;
  return `${scheme}//${host}${path}${url.search}`;
}

/**
 * Anything a user might paste, reduced to something the API accepts.
 *
 * The interesting case is `example.com/pricing`: a page was clearly meant, but
 * the Worker only accepts a path when a scheme comes with it. Adding `https://`
 * keeps the intent instead of silently querying the whole domain and reporting
 * a number that answers a different question.
 */
export function normalizeTarget(input: string): string {
  const trimmed = input.trim().replaceAll(/\s/g, "");
  if (trimmed === "") return "";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return normalizeUrlTarget(trimmed);
  }

  // No scheme: everything before the first /, ? or # is the host.
  const cut = trimmed.search(/[/?#]/);
  const host = (cut === -1 ? trimmed : trimmed.slice(0, cut))
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
  const rest = cut === -1 ? "" : trimmed.slice(cut);

  if (host === "") return "";
  if (rest === "" || rest === "/") return host;
  return normalizeUrlTarget(`https://${host}${rest}`);
}

/** True when the Worker's `targetParam` would accept this. */
export function isLikelyTarget(value: string): boolean {
  return URL_TARGET.test(value) || DOMAIN_TARGET.test(value);
}

/** Whether a normalised target names a whole host or one page. */
export function targetKind(value: string): TargetKind {
  return URL_TARGET.test(value) ? "url" : "domain";
}

/** The host of any target, for headings that must stay one line. */
export function targetHost(value: string): string {
  if (!URL_TARGET.test(value)) return value;
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

/**
 * A filename fragment that still means something in a downloads folder: the
 * host, plus the path when the target was a page, with everything a filesystem
 * dislikes flattened to dashes.
 */
export function targetSlug(value: string): string {
  const slug = value
    .replaceAll(/^https?:\/\//gi, "")
    .replaceAll(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug === "" ? "target" : slug.slice(0, 60).replace(/-+$/, "");
}
