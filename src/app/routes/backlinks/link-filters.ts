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
 */

/** What the inputs hold. Strings, because that is what an `<input>` gives you. */
export interface LinkFilterDraft {
  dofollowOnly: boolean;
  minDomainScore: string;
  anchor: string;
}

/** What the API takes. Keys absent when not filtering. */
export interface LinkFilters {
  /** Only ever `true` — see the file header. */
  dofollow?: true;
  /** 0–100 floor on the *linking* domain's Domain Score. */
  minDomainScore?: number;
  /** Substring the anchor text must contain. */
  anchor?: string;
}

export const EMPTY_LINK_DRAFT: LinkFilterDraft = {
  dofollowOnly: false,
  minDomainScore: "",
  anchor: "",
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

  return filters;
}

/** Applied filters back to a draft, so the row reopens showing what is on. */
export function toLinkFilterDraft(filters: LinkFilters): LinkFilterDraft {
  return {
    dofollowOnly: filters.dofollow === true,
    minDomainScore:
      filters.minDomainScore === undefined ? "" : String(filters.minDomainScore),
    anchor: filters.anchor ?? "",
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
    draft.minDomainScore.trim() === "" &&
    draft.anchor.trim() === ""
  );
}
