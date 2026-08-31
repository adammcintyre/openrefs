/**
 * The Backlinks tab's filter row, as data.
 *
 * These filters are **server-side**: DataForSEO applies them, so changing one is
 * a new billed query rather than a re-sift of rows already paid for. Hence an
 * explicit Apply, and hence a parsed shape that can go straight into a query key
 * with `undefined` for "not set" — an untouched field must not be able to fork
 * the cache.
 *
 * Two conversions here are load-bearing:
 *
 *  - **`dofollow` is only ever sent as true.** The Worker's `booleanParam`
 *    reads `dofollow=false` as a real filter, which would return *nofollow-only*
 *    links. "Dofollow only, off" means no filter at all, so the key is omitted.
 *  - **A minimum score of 0 is dropped.** `>= 0` matches every link ever
 *    crawled; sending it buys nothing and splits the cache in two.
 *  - **"Hide likely spam" is a ceiling, not a boolean.** It sends one fixed
 *    `maxSpamScore` (`BACKLINKS_SPAM_HIDE_THRESHOLD`) so the toggle has exactly
 *    two cache entries rather than one per value someone might type. Off sends
 *    nothing at all, because `maxSpamScore=100` would still exclude the links
 *    the provider scores above 100's worth of nothing and would fork the cache
 *    for no gain.
 */
import { BACKLINKS_SPAM_HIDE_THRESHOLD } from "../../../shared/backlinks";

/** What the inputs hold. Strings, because that is what an `<input>` gives you. */
export interface LinkFilterDraft {
  dofollowOnly: boolean;
  minDomainScore: string;
  anchor: string;
  hideSpam: boolean;
}

/** What the API takes. Keys absent when not filtering. */
export interface LinkFilters {
  /** Only ever `true` — see the file header. */
  dofollow?: true;
  /** 0–100 floor on the *linking* domain's Domain Score. */
  minDomainScore?: number;
  /** Substring the anchor text must contain. */
  anchor?: string;
  /**
   * 0–100 ceiling on the provider's spam score. Only ever
   * `BACKLINKS_SPAM_HIDE_THRESHOLD` — see the file header.
   */
  maxSpamScore?: number;
}

export const EMPTY_LINK_DRAFT: LinkFilterDraft = {
  dofollowOnly: false,
  minDomainScore: "",
  anchor: "",
  hideSpam: false,
};

export const EMPTY_LINK_FILTERS: LinkFilters = {};

/**
 * Draft to query params, dropping anything blank or meaningless.
 *
 * The score is clamped rather than rejected: someone who types 400 into a
 * 0–100 box means "only the very best", and the Worker would answer a 422 to a
 * value it could have understood.
 */
export function parseLinkFilterDraft(draft: LinkFilterDraft): LinkFilters {
  const filters: LinkFilters = {};

  if (draft.dofollowOnly) filters.dofollow = true;

  const raw = draft.minDomainScore.trim();
  if (raw !== "") {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      const clamped = Math.min(100, Math.max(0, Math.round(value)));
      if (clamped > 0) filters.minDomainScore = clamped;
    }
  }

  const anchor = draft.anchor.trim();
  if (anchor !== "") filters.anchor = anchor;

  if (draft.hideSpam) filters.maxSpamScore = BACKLINKS_SPAM_HIDE_THRESHOLD;

  return filters;
}

/** Applied filters back to a draft, so the row reopens showing what is on. */
export function toLinkFilterDraft(filters: LinkFilters): LinkFilterDraft {
  return {
    dofollowOnly: filters.dofollow === true,
    minDomainScore:
      filters.minDomainScore === undefined ? "" : String(filters.minDomainScore),
    anchor: filters.anchor ?? "",
    hideSpam: filters.maxSpamScore !== undefined,
  };
}

/** How many filters are on — drives the count badge next to "Filters". */
export function activeLinkFilterCount(filters: LinkFilters): number {
  return Object.values(filters).filter((value) => value !== undefined).length;
}

/** Every control at its default. Drives whether "Clear" has anything to do. */
export function isLinkDraftEmpty(draft: LinkFilterDraft): boolean {
  return (
    !draft.dofollowOnly &&
    !draft.hideSpam &&
    draft.minDomainScore.trim() === "" &&
    draft.anchor.trim() === ""
  );
}
