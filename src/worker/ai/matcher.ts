/**
 * Did the assistant talk about us, and did it link to us?
 *
 * This file answers those two questions and nothing else. It is pure — no
 * bindings, no network, no clock — because it is the part of AI Visibility that
 * is easiest to get subtly wrong and most expensive to be wrong about: every
 * mention-rate chart in the product is a count of what this returns, so a
 * matcher that says yes to `notbrandpacks.com` invents visibility that does not
 * exist, and one that says no to `www.BrandPacks.com/templates` erases
 * visibility that does.
 *
 * The two verdicts are deliberately independent:
 *
 *  - **mentioned** — the project's domain (or its derivable name) appears in
 *    the assistant's prose. Being talked about.
 *  - **cited** — the project's domain is the host of one of the response's
 *    source URLs. Being linked.
 *
 * An answer can do either without the other: assistants cite pages they never
 * name, and name brands they never link.
 */

/* -------------------------------------------------------------------------- */
/* Hosts                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A hostname reduced to the form two hosts can be compared in: lowercased,
 * trailing root dot removed, leading `www.` removed.
 *
 * `www` is stripped because it is not a subdomain anyone means: nobody reading
 * "www.brandpacks.com" in an answer thinks they were shown a different site
 * from brandpacks.com. Every *other* label is kept — see `isSameSite`.
 */
export function normalizeHost(host: string): string {
  const lower = host.trim().toLowerCase().replace(/\.+$/, "");
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/**
 * Whether `host` is the project's site — the domain itself, or something under
 * it.
 *
 * The suffix test is written as `.endsWith("." + root)` rather than
 * `.endsWith(root)`, and that dot is the entire near-miss defence:
 *
 *     isSameSite("blog.brandpacks.com", "brandpacks.com")  // true  — ours
 *     isSameSite("notbrandpacks.com",   "brandpacks.com")  // false — someone else's
 *     isSameSite("brandpacks.co",       "brandpacks.com")  // false — different TLD
 *
 * Subdomains count as us because they are us: a mention of shop.example.com is
 * a mention of example.com's business. The relationship is one-way — a project
 * registered as `blog.example.com` is not matched by a bare `example.com`,
 * because we cannot know that the rest of that site belongs to the same owner.
 */
export function isSameSite(host: string, domain: string): boolean {
  const candidate = normalizeHost(host);
  const root = normalizeHost(domain);
  if (candidate === "" || root === "") return false;
  return candidate === root || candidate.endsWith(`.${root}`);
}

/**
 * The host of a citation URL, or null when there is not one.
 *
 * Total by construction — citations arrive from a third party's JSON and this
 * must survive whatever is in there: `null`, a number, an empty string, a bare
 * `"brandpacks.com"` with no scheme, or `"javascript:alert(1)"`. Nothing here
 * throws and nothing here follows anything.
 *
 * Only `http`/`https` produce a host. A citation is a web page someone could
 * open; a `javascript:` or `data:` URL is not one, and treating its text as a
 * host is how a garbage string turns into a fake citation.
 */
export function hostFromUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const parsed = parseUrl(trimmed) ?? parseSchemeless(trimmed);
  if (parsed === null) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = normalizeHost(parsed.hostname);
  return host === "" ? null : host;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * A second attempt for `brandpacks.com/templates` — a citation that names a
 * page without a scheme.
 *
 * Gated on the string already looking like a host so that prose ("see their
 * site") cannot be promoted into a URL by prefixing `https://`. `new URL` is
 * still the parser; this only supplies the scheme it needs to run.
 */
function parseSchemeless(value: string): URL | null {
  if (/\s/.test(value)) return null;
  if (value.includes("://")) return null;
  if (!HOST_LIKE.test(value)) return null;
  return parseUrl(`https://${value}`);
}

/** A leading `host.tld`, the minimum for `parseSchemeless` to try. */
const HOST_LIKE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:[/:?#]|$)/i;

/* -------------------------------------------------------------------------- */
/* Hosts inside prose                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every host-shaped token in a block of text, in the order they appear, with
 * the character range each occupies.
 *
 * The ranges are not decoration: `mentionedInText` uses them to blank out other
 * people's domains before the name rule runs, which is what stops
 * "brandpacks.co" from counting as a mention of brandpacks.com.
 *
 * Scheme, port, path, query and fragment are all left out of the captured host
 * — `https://brandpacks.com:443/free?a=1#b` yields `brandpacks.com` — and a
 * trailing sentence period is not swallowed, because the last label must be
 * letters.
 */
export function extractHosts(
  text: string,
): { host: string; start: number; end: number }[] {
  const out: { host: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(HOST_TOKEN)) {
    const raw = match[1];
    if (raw === undefined || match.index === undefined) continue;
    // The capture group excludes any scheme, so offset past it.
    const start = match.index + match[0].length - raw.length;
    out.push({ host: normalizeHost(raw), start, end: start + raw.length });
  }
  return out;
}

/**
 * A hostname in running text.
 *
 * `(?<![\w@.-])` is the left guard and it carries the weight: without it, the
 * scan of "notbrandpacks.com" could start at "brandpacks.com" and report a
 * match on a domain that is not ours. It also keeps the local part of an email
 * address from being read as a label, and stops a match from starting halfway
 * through a longer host.
 *
 * The last label is `[a-z]{2,}` — letters only — so "3.14.2024" is not a host
 * and "brandpacks.com." keeps its sentence period.
 */
const HOST_TOKEN =
  /(?:https?:\/\/)?(?<![\w@.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?![\w-])/gi;

/* -------------------------------------------------------------------------- */
/* The name rule                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Shortest name we will look for in prose.
 *
 * Three characters is where a brand name stops being distinguishable from an
 * abbreviation an assistant might use for something else entirely, and a
 * false "mentioned" is worse than a missed one — it puts a tick in a chart
 * that someone will act on.
 */
export const MIN_DERIVABLE_NAME_LENGTH = 4;

/**
 * Second-level labels that are part of a public suffix rather than a name.
 *
 * This is the short, honest version of the Public Suffix List: enough to get
 * `example.co.uk` and `example.com.au` right, which covers the ccTLD shapes our
 * default markets (UK, US) actually use. It is applied only when the final
 * label is a two-letter country code, so `foo.co` (Colombia, used as a vanity
 * TLD) still yields the name "foo".
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  "co",
  "com",
  "net",
  "org",
  "gov",
  "edu",
  "ac",
  "sch",
  "ltd",
  "plc",
  "me",
  "or",
  "ne",
]);

/**
 * Names too generic to be evidence.
 *
 * If a project is `templates.com`, the token "templates" appears in nearly
 * every answer about templates whether or not the assistant has ever heard of
 * that site — so for these the name rule is switched off and only the domain
 * and citation rules speak. The list is short and deliberately about *shape*,
 * not taste: each entry is a word an English answer in this product's subject
 * area uses as a common noun.
 *
 * Being on this list costs a project nothing except the secondary signal; its
 * domain and its citations are still matched exactly as before.
 */
const GENERIC_NAMES = new Set([
  "shop",
  "store",
  "template",
  "templates",
  "design",
  "designs",
  "photo",
  "photos",
  "image",
  "images",
  "print",
  "prints",
  "free",
  "online",
  "best",
  "cheap",
  "download",
  "downloads",
  "site",
  "sites",
  "web",
  "website",
  "blog",
  "news",
  "mail",
  "email",
  "home",
  "cloud",
  "data",
  "info",
  "help",
  "guide",
  "guides",
  "tool",
  "tools",
  "app",
  "apps",
  "software",
  "digital",
  "media",
  "studio",
  "creative",
  "graphics",
  "booth",
  "party",
  "wedding",
  "business",
  "company",
  "group",
  "world",
  "global",
  "market",
  "search",
  "video",
  "music",
  "game",
  "games",
]);

/**
 * The brand name a domain clearly implies, or null when it does not imply one.
 *
 * **The rule, stated once so the UI and the docs can repeat it:** take the
 * domain, drop `www.`, drop the public suffix (the last label, or the last two
 * when they form a known country-code pair such as `co.uk`), and take the label
 * immediately to the left of it. That label is the name — everything further
 * left is a subdomain and everything to the right is a suffix.
 *
 *     brandpacks.com        → "brandpacks"
 *     www.brandpacks.com    → "brandpacks"
 *     blog.brandpacks.co.uk → "brandpacks"
 *     brand-packs.com       → "brand-packs"   (matches "brand packs" too)
 *     templates.com         → null            (too generic — see GENERIC_NAMES)
 *     ab.com                → null            (too short)
 *
 * Returns null rather than a bad guess, and a null simply means the answer text
 * is searched for the domain alone. The known limitation is the inverse of the
 * hyphen case: `brandpacks.com` cannot be split back into "brand packs", so an
 * answer that writes the brand with a space and never links it reads as not
 * mentioned. Splitting a single label on a guess would invent matches, and this
 * file's bias is the other way.
 */
export function derivableProjectName(domain: string): string | null {
  const host = normalizeHost(domain);
  const labels = host.split(".").filter((label) => label !== "");
  if (labels.length < 2) return null;

  const last = labels[labels.length - 1] as string;
  const secondLast = labels[labels.length - 2] as string;
  const suffixLabels =
    labels.length >= 3 && last.length === 2 && SECOND_LEVEL_SUFFIXES.has(secondLast)
      ? 2
      : 1;

  const name = labels[labels.length - 1 - suffixLabels];
  if (name === undefined) return null;
  if (name.replace(/-/g, "").length < MIN_DERIVABLE_NAME_LENGTH) return null;
  if (GENERIC_NAMES.has(name)) return null;
  // A label that is only digits is a number in prose, not a brand.
  if (/^\d+$/.test(name)) return null;
  return name;
}

/**
 * The name as a regex that also accepts the ways people write a hyphenated
 * brand: `brand-packs` matches "brand-packs", "brand packs" and "brandpacks",
 * in any case.
 *
 * `(?<![\w-])` / `(?![\w-])` rather than `\b` so that a hyphen counts as part
 * of a word: "brandpacks" must not match inside "super-brandpacks-clone".
 */
function namePattern(name: string): RegExp {
  const parts = name.split("-").map(escapeRegExp);
  return new RegExp(`(?<![\\w-])${parts.join("[\\s-]?")}(?![\\w-])`, "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* -------------------------------------------------------------------------- */
/* The verdicts                                                                */
/* -------------------------------------------------------------------------- */

/** How `mentioned` was decided, for the UI's "why is this ticked?" tooltip. */
export type MentionKind = "domain" | "name";

export interface TextMention {
  kind: MentionKind;
  /** The exact substring that matched, for highlighting in the excerpt. */
  text: string;
  /** Index into the text the matcher was given. */
  index: number;
}

/**
 * The first mention of the project in a block of prose, or null.
 *
 * Two passes, and the order matters. The domain pass wins because it is
 * unambiguous evidence. The name pass then runs over a copy of the text with
 * **every host that is not ours blanked out**, which is the only reason
 * "brandpacks.co" and "notbrandpacks.com" do not count: their text contains the
 * literal token "brandpacks", so a naive name search would match it, and the
 * near-miss test would fail for a reason nobody would guess from reading a
 * regex. Blanking preserves offsets, so the returned index still points into
 * the caller's original string.
 */
export function mentionedInText(
  text: string,
  domain: string,
): TextMention | null {
  if (text === "") return null;

  const hosts = extractHosts(text);
  for (const host of hosts) {
    if (isSameSite(host.host, domain)) {
      return {
        kind: "domain",
        text: text.slice(host.start, host.end),
        index: host.start,
      };
    }
  }

  const name = derivableProjectName(domain);
  if (name === null) return null;

  let masked = text;
  for (const host of hosts) {
    // Same length, so every later index is still the caller's index.
    masked =
      masked.slice(0, host.start) +
      " ".repeat(host.end - host.start) +
      masked.slice(host.end);
  }

  const match = namePattern(name).exec(masked);
  if (match === null) return null;
  return { kind: "name", text: text.slice(match.index, match.index + match[0].length), index: match.index };
}

/** One source URL from an AI response, normalised. */
export interface Citation {
  /** As the API gave it, so the UI can link exactly what was cited. */
  url: string;
  /** Parsed host, `www.` stripped. Null when the URL was not usable. */
  host: string | null;
  /** True when this citation points at the project's own site. */
  ours: boolean;
}

export interface AnswerMatch {
  /** The project's domain, or its derivable name, appears in the answer text. */
  mentioned: boolean;
  /** Null when `mentioned` is false. */
  mentionKind: MentionKind | null;
  /** Where the first mention starts in the answer text. -1 when there is none. */
  mentionIndex: number;
  /**
   * The substrings worth highlighting in the excerpt, deduplicated and
   * lowercased. The UI searches for these rather than trusting an offset,
   * because the excerpt is a window onto the answer, not the whole of it.
   */
  mentionTerms: string[];
  /** At least one citation URL's host is the project's site. */
  cited: boolean;
  /** Every citation, in the order given, with the garbage marked as unusable. */
  citations: Citation[];
  /** Just the citation URLs that point at us. */
  citedUrls: string[];
}

/**
 * The whole verdict for one AI answer.
 *
 * `citationUrls` is typed `readonly unknown[]` on purpose: it comes straight
 * out of a third-party response and this function is the boundary that makes it
 * safe. Entries that are not usable URLs are kept in `citations` with a null
 * host rather than dropped, so a response whose sources were all unparseable
 * shows up as "0 of 5 citations usable" instead of silently as "no citations".
 */
export function matchAnswer(input: {
  domain: string;
  answerText: string;
  citationUrls: readonly unknown[];
}): AnswerMatch {
  const { domain, answerText, citationUrls } = input;

  const mention = mentionedInText(answerText, domain);

  const citations: Citation[] = [];
  const citedUrls: string[] = [];
  for (const raw of citationUrls) {
    const url = typeof raw === "string" ? raw.trim() : "";
    const host = hostFromUrl(raw);
    const ours = host !== null && isSameSite(host, domain);
    if (url === "" && host === null) continue;
    citations.push({ url, host, ours });
    if (ours) citedUrls.push(url);
  }

  const terms = new Set<string>();
  if (mention !== null) terms.add(mention.text.toLowerCase());

  return {
    mentioned: mention !== null,
    mentionKind: mention?.kind ?? null,
    mentionIndex: mention?.index ?? -1,
    mentionTerms: [...terms],
    cited: citedUrls.length > 0,
    citations,
    citedUrls,
  };
}

/* -------------------------------------------------------------------------- */
/* Excerpts                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Longest excerpt stored in D1, per docs/specs/PHASE6.md. The full answer goes
 * to R2; this is what the drill-down renders without a blob fetch.
 */
export const RESPONSE_EXCERPT_MAX_CHARS = 2000;

/** Characters of lead-in kept before a mention, so it reads mid-sentence. */
const EXCERPT_LEAD_CHARS = 300;

/**
 * The slice of an answer worth keeping in D1.
 *
 * Centred on the mention rather than taken from the top, because the drill-down
 * exists to show *the mention* — and an assistant that names you in its ninth
 * paragraph would otherwise be filed with an excerpt that proves nothing. With
 * no mention, the opening is the useful part.
 *
 * An ellipsis marks each end that was cut, so nobody reads a mid-sentence start
 * as the model's own words.
 */
export function responseExcerpt(
  text: string,
  mentionIndex = -1,
  maxChars: number = RESPONSE_EXCERPT_MAX_CHARS,
): string {
  const limit = Math.max(1, maxChars);
  if (text.length <= limit) return text;

  const start =
    mentionIndex < 0
      ? 0
      : Math.max(0, Math.min(mentionIndex - EXCERPT_LEAD_CHARS, text.length - limit));

  const lead = start > 0 ? "…" : "";
  const room = limit - lead.length;
  const end = Math.min(text.length, start + room);
  const trail = end < text.length ? "…" : "";

  // `Math.max` guards the degenerate limit where the two ellipses are the whole
  // budget — a slice with `end` before `start` would otherwise read backwards.
  const body = text.slice(start, Math.max(start, end - trail.length));
  return `${lead}${body}${trail}`;
}
