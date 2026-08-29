/**
 * The suggested prompts on the empty state, built from the project itself.
 *
 * A blank textarea is a bad first screen for this feature, because the thing
 * being asked for — "a question a buyer might type into an assistant" — is
 * unfamiliar phrasing even to people who know their own market. Three
 * one-click chips turn the empty state into a working example.
 *
 * **They are starting points, and the UI says so.** We know a project's name
 * and domain and nothing else; we cannot know that brandpacks.com sells design
 * templates. So every suggestion here is anchored on the brand, which is the
 * only fact available — while the empty-state copy points out that the prompts
 * worth tracking usually name a *category* rather than the brand, because an
 * assistant naming you in an answer to "what is <you>" measures very little.
 * Suggesting a category we invented would be worse: a confidently wrong guess
 * at someone's industry, bought at LLM prices.
 */

/** Everything a suggestion needs to know about the project. */
export interface StarterProjectFacts {
  name: string;
  domain: string;
}

/**
 * Longest brand fragment a suggestion will embed.
 *
 * Project names are capped at 120 characters upstream, so the templates below
 * cannot reach the 500-character prompt limit in practice. This makes that
 * unconditional rather than a consequence of a cap in another file: a chip
 * that cannot be saved is worse than a truncated one, because the only way to
 * discover it is a 422 on click.
 */
const BRAND_MAX_CHARS = 120;

/**
 * A human-readable brand name.
 *
 * The project name is what the user typed and is nearly always right. It falls
 * back to the domain with `www.` and the public suffix removed — "brandpacks"
 * out of "www.brandpacks.co.uk" — because a suggestion reading "Best
 * alternatives to brandpacks.co.uk" is a URL where a name should be.
 */
export function brandName(facts: StarterProjectFacts): string {
  return rawBrandName(facts).slice(0, BRAND_MAX_CHARS).trim();
}

function rawBrandName({ name, domain }: StarterProjectFacts): string {
  const trimmed = name.trim();
  if (trimmed !== "") return trimmed;

  const host = domain.trim().toLowerCase().replace(/^www\./, "");
  if (host === "") return "this site";

  /*
   * Take the label before the suffix. Two-part suffixes (.co.uk, .com.au) mean
   * "everything before the last dot" is wrong, so a known second level is
   * dropped as well. Not a public-suffix list — this only has to produce a
   * readable label, and being slightly conservative beats shipping a dependency
   * to title-case a chip.
   */
  const labels = host.split(".").filter((label) => label !== "");
  const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov"]);
  let end = labels.length - 1;
  if (end > 0 && SECOND_LEVEL.has(labels[end - 1] ?? "")) end -= 1;
  const label = labels[Math.max(0, end - 1)] ?? host;

  return label.replaceAll("-", " ");
}

/**
 * Three prompts to start from, in descending order of how much they teach.
 *
 * The first models the shape that actually matters — a question whose answer
 * is a *list*, where being absent is the finding. The others are brand
 * monitoring, which is the easier thing to want and the easier thing to read.
 */
export function starterPrompts(project: StarterProjectFacts): string[] {
  const brand = brandName(project);
  return [
    `Best alternatives to ${brand}`,
    `What are the top sites like ${brand}?`,
    `Is ${brand} any good? What do reviews say?`,
  ];
}
