import { describe, expect, it } from "vitest";

import { BACKLINKS_SPAM_HIDE_THRESHOLD } from "../../../shared/backlinks";
import {
  EMPTY_LINK_DRAFT,
  activeLinkFilterCount,
  isLinkDraftEmpty,
  parseLinkFilterDraft,
  toLinkFilterDraft,
} from "./link-filters";

describe("parseLinkFilterDraft", () => {
  it("sends nothing when nothing is set", () => {
    expect(parseLinkFilterDraft(EMPTY_LINK_DRAFT)).toEqual({});
  });

  /**
   * The Worker's booleanParam reads `dofollow=false` as a real filter, which
   * would return *nofollow-only* links. "Off" must mean "no filter".
   */
  it("only ever sends dofollow as true", () => {
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, dofollowOnly: true }),
    ).toEqual({ dofollow: true });
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, dofollowOnly: false }),
    ).not.toHaveProperty("dofollow");
  });

  it("drops a zero floor — `>= 0` buys nothing and forks the cache", () => {
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, minDomainScore: "0" }),
    ).toEqual({});
  });

  it("clamps a score to 0–100 instead of earning a 422", () => {
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, minDomainScore: "400" }),
    ).toEqual({ minDomainScore: 100 });
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, minDomainScore: "-5" }),
    ).toEqual({});
  });

  it("rounds a fractional score — the scale is whole numbers", () => {
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, minDomainScore: "40.6" }),
    ).toEqual({ minDomainScore: 41 });
  });

  it("ignores a score that is not a number at all", () => {
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, minDomainScore: "abc" }),
    ).toEqual({});
  });

  it("trims anchor text and drops it when blank", () => {
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, anchor: "  templates  " }),
    ).toEqual({ anchor: "templates" });
    expect(parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, anchor: "   " })).toEqual(
      {},
    );
  });

  /**
   * One fixed ceiling, so the toggle has exactly two cache entries. Off sends
   * nothing at all — a `maxSpamScore` of 100 narrows nothing and would still
   * fork the server cache for the same rows.
   */
  it("turns Hide likely spam into one fixed ceiling", () => {
    expect(parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, hideSpam: true })).toEqual(
      { maxSpamScore: BACKLINKS_SPAM_HIDE_THRESHOLD },
    );
    expect(
      parseLinkFilterDraft({ ...EMPTY_LINK_DRAFT, hideSpam: false }),
    ).not.toHaveProperty("maxSpamScore");
  });
});

describe("toLinkFilterDraft", () => {
  it("round-trips an applied filter set back into the form", () => {
    const filters = {
      dofollow: true,
      minDomainScore: 40,
      anchor: "templates",
      maxSpamScore: BACKLINKS_SPAM_HIDE_THRESHOLD,
    } as const;
    expect(parseLinkFilterDraft(toLinkFilterDraft(filters))).toEqual(filters);
  });

  it("reopens empty for no filters", () => {
    expect(toLinkFilterDraft({})).toEqual(EMPTY_LINK_DRAFT);
  });

  it("reopens with the spam box ticked when it was on", () => {
    expect(
      toLinkFilterDraft({ maxSpamScore: BACKLINKS_SPAM_HIDE_THRESHOLD }).hideSpam,
    ).toBe(true);
  });
});

describe("activeLinkFilterCount", () => {
  it("counts what is on", () => {
    expect(activeLinkFilterCount({})).toBe(0);
    expect(activeLinkFilterCount({ dofollow: true, minDomainScore: 40 })).toBe(2);
    expect(
      activeLinkFilterCount({
        dofollow: true,
        maxSpamScore: BACKLINKS_SPAM_HIDE_THRESHOLD,
      }),
    ).toBe(2);
  });
});

describe("isLinkDraftEmpty", () => {
  it("treats whitespace as empty but a ticked box as not", () => {
    expect(isLinkDraftEmpty(EMPTY_LINK_DRAFT)).toBe(true);
    expect(isLinkDraftEmpty({ ...EMPTY_LINK_DRAFT, anchor: "  " })).toBe(true);
    expect(isLinkDraftEmpty({ ...EMPTY_LINK_DRAFT, dofollowOnly: true })).toBe(
      false,
    );
    expect(isLinkDraftEmpty({ ...EMPTY_LINK_DRAFT, hideSpam: true })).toBe(false);
  });
});
