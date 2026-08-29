import { describe, expect, it } from "vitest";

import type { DofollowSplit } from "../../../shared/backlinks";
import { scoreBand } from "../../../shared/backlinks";
import {
  bandLabel,
  dofollowTitle,
  formatAnchor,
  formatDofollow,
  formatRatio,
  formatScore,
  formatSeen,
  scoreTextClass,
  scoreVariant,
  seenDate,
  variantForScore,
} from "./format";

const NO_SPLIT: DofollowSplit = {
  dofollowPages: null,
  nofollowPages: null,
  dofollowRatio: null,
};

describe("formatScore", () => {
  it("rounds, and never scales — the value arrives 0–100", () => {
    expect(formatScore(63.4)).toBe("63");
    expect(formatScore(100)).toBe("100");
    expect(formatScore(0)).toBe("0");
  });

  it("distinguishes zero from not reported", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(null)).toBe("—");
    expect(formatScore(undefined)).toBe("—");
    expect(formatScore(Number.NaN)).toBe("—");
  });
});

describe("score bands", () => {
  /** The thresholds live in shared/backlinks.ts; this pins what we do with them. */
  it("maps each band to a distinct badge variant", () => {
    expect(variantForScore(85)).toBe("success");
    expect(variantForScore(60)).toBe("brand");
    expect(variantForScore(35)).toBe("info");
    expect(variantForScore(10)).toBe("neutral");
    expect(variantForScore(null)).toBe("neutral");
  });

  it("never paints a low score as an error", () => {
    expect(scoreVariant(scoreBand(2))).not.toBe("danger");
    expect(scoreVariant(scoreBand(2))).not.toBe("warning");
  });

  it("names every band, including the unknown one", () => {
    expect(bandLabel(scoreBand(85))).toBe("very high authority");
    expect(bandLabel(null)).toBe("authority not reported");
  });

  it("gives the headline number a colour in every band", () => {
    for (const score of [85, 60, 35, 10, null]) {
      expect(scoreTextClass(scoreBand(score))).toMatch(/^text-/);
    }
  });
});

describe("formatRatio", () => {
  it("renders a 0–1 fraction as a whole percentage", () => {
    expect(formatRatio(0.6234)).toBe("62%");
    expect(formatRatio(1)).toBe("100%");
  });

  it("does not turn a missing ratio into 0%", () => {
    expect(formatRatio(null)).toBe("—");
    expect(formatRatio(undefined)).toBe("—");
    expect(formatRatio(0)).toBe("0%");
  });

  it("clamps values outside 0–1 rather than printing 140%", () => {
    expect(formatRatio(1.4)).toBe("100%");
    expect(formatRatio(-0.2)).toBe("0%");
  });
});

describe("dofollow", () => {
  it("says nothing rather than something wrong when nothing was reported", () => {
    expect(formatDofollow(NO_SPLIT)).toBe("—");
    expect(formatDofollow(null)).toBe("—");
    expect(dofollowTitle(NO_SPLIT)).toContain("did not report");
  });

  it("shows the arithmetic behind a derived share", () => {
    const split: DofollowSplit = {
      dofollowPages: 30,
      nofollowPages: 20,
      dofollowRatio: 0.6,
    };
    expect(formatDofollow(split)).toBe("60%");
    expect(dofollowTitle(split)).toContain("30 dofollow of 50");
  });
});

describe("formatSeen", () => {
  it("keeps the date and drops the time from a provider timestamp", () => {
    // "en", matching every other Intl formatter in the app.
    expect(formatSeen("2024-03-11 08-22-14 +00:00")).toBe("Mar 11, 2024");
  });

  it("reads the date in UTC, not in the viewer's timezone", () => {
    // A timestamp just after midnight UTC must not slide to the previous day
    // for anyone west of Greenwich.
    expect(formatSeen("2024-01-01 00-30-00 +00:00")).toBe("Jan 1, 2024");
  });

  it("passes an unrecognised shape through instead of blanking the cell", () => {
    expect(formatSeen("whenever")).toBe("whenever");
  });

  it("is an em dash for nothing at all", () => {
    expect(formatSeen(null)).toBe("—");
    expect(formatSeen("")).toBe("—");
  });
});

describe("seenDate", () => {
  it("extracts a sortable ISO date for the CSV", () => {
    expect(seenDate("2024-03-11 08-22-14 +00:00")).toBe("2024-03-11");
    expect(seenDate("whenever")).toBeNull();
    expect(seenDate(null)).toBeNull();
  });
});

describe("formatAnchor", () => {
  it("collapses the whitespace anchors arrive with", () => {
    expect(formatAnchor("  free   brand\npacks ")).toBe("free brand packs");
  });

  /**
   * Live check against brandpacks.com: the largest anchor group comes back as
   * `anchor: null` with 25,825 backlinks — image links, which genuinely have
   * no anchor text. An em dash there would call the biggest group in the table
   * "missing data".
   */
  it("labels an absent anchor rather than implying missing data", () => {
    expect(formatAnchor("")).toBe("(no anchor text)");
    expect(formatAnchor("   ")).toBe("(no anchor text)");
    expect(formatAnchor(null)).toBe("(no anchor text)");
  });

  it("still uses an em dash when the field was never provided at all", () => {
    expect(formatAnchor(undefined)).toBe("—");
  });
});
