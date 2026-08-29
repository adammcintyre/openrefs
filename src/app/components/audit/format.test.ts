import { describe, expect, it } from "vitest";

import type {
  AuditCategory,
  AuditCategoryResult,
  AuditComparison,
  AuditLighthouse,
  AuditSeverity,
} from "../../../shared/audits";
import { AUDIT_CATEGORIES } from "../../../shared/audits";
import {
  categoryDelta,
  clsBand,
  deltaTitle,
  deltaTone,
  formatAuditTime,
  formatCls,
  formatCount,
  formatDelta,
  formatMs,
  formatScore,
  formatScoreDelta,
  interactionMetric,
  isInFlight,
  lcpBand,
  partitionCategories,
  performanceBand,
  pluralPages,
  scoreBand,
  scoreDelta,
  severityRank,
  sortByImpact,
  tbtBand,
} from "./format";

function category(
  id: AuditCategory,
  severity: AuditSeverity,
  affectedPages: number,
): AuditCategoryResult {
  return {
    category: id,
    label: id,
    description: "",
    severity,
    affectedPages,
    checks: [],
  };
}

function lighthouse(patch: Partial<AuditLighthouse>): AuditLighthouse {
  return {
    url: "https://example.com/",
    mobile: true,
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    lcpMs: null,
    cls: null,
    inpMs: null,
    fcpMs: null,
    tbtMs: null,
    speedIndexMs: null,
    ...patch,
  };
}

/* -------------------------------------------------------------------------- */

describe("severityRank", () => {
  it("ranks error above warning above notice", () => {
    expect(severityRank("error")).toBeLessThan(severityRank("warning"));
    expect(severityRank("warning")).toBeLessThan(severityRank("notice"));
  });
});

describe("sortByImpact", () => {
  it("puts severity before volume", () => {
    // 3 pages returning 5xx outrank 200 pages missing an OG tag.
    const rows = sortByImpact([
      category("social_tags", "notice", 200),
      category("indexability", "error", 3),
      category("titles", "warning", 40),
    ]);
    expect(rows.map((row) => row.category)).toEqual([
      "indexability",
      "titles",
      "social_tags",
    ]);
  });

  it("breaks severity ties on affected pages, descending", () => {
    const rows = sortByImpact([
      category("titles", "warning", 4),
      category("h1", "warning", 19),
      category("content", "warning", 11),
    ]);
    expect(rows.map((row) => row.affectedPages)).toEqual([19, 11, 4]);
  });

  it("does not mutate its input", () => {
    const input = [
      category("social_tags", "notice", 1),
      category("indexability", "error", 1),
    ];
    sortByImpact(input);
    expect(input[0]?.category).toBe("social_tags");
  });
});

describe("partitionCategories", () => {
  /**
   * The bug this function exists to prevent: an audit always returns all 17
   * categories, and the empty ones carry severity `notice`. Rendering them in
   * the same table buries the one real error under sixteen grey rows.
   */
  it("keeps clean categories out of the issues table", () => {
    const all = AUDIT_CATEGORIES.map((id) =>
      id === "indexability"
        ? category(id, "error", 3)
        : category(id, "notice", 0),
    );

    const { failing, clean } = partitionCategories(all);

    expect(failing).toHaveLength(1);
    expect(failing[0]?.category).toBe("indexability");
    expect(clean).toHaveLength(AUDIT_CATEGORIES.length - 1);
  });

  it("sorts the failing set by impact and leaves the clean set in taxonomy order", () => {
    const { failing, clean } = partitionCategories([
      category("titles", "warning", 4),
      category("slow_pages", "notice", 0),
      category("indexability", "error", 1),
      category("core_web_vitals", "notice", 0),
    ]);

    expect(failing.map((row) => row.category)).toEqual([
      "indexability",
      "titles",
    ]);
    expect(clean.map((row) => row.category)).toEqual([
      "slow_pages",
      "core_web_vitals",
    ]);
  });

  it("handles an audit that found nothing at all", () => {
    const all = AUDIT_CATEGORIES.map((id) => category(id, "notice", 0));
    const { failing, clean } = partitionCategories(all);
    expect(failing).toHaveLength(0);
    expect(clean).toHaveLength(17);
  });
});

/* -------------------------------------------------------------------------- */

const PREVIOUS: AuditComparison = {
  auditId: "audit-1",
  createdAt: "2026-08-01T10:00:00.000Z",
  score: 82.5,
  categoryCounts: { titles: 11, indexability: 0 },
};

describe("categoryDelta", () => {
  it("subtracts the previous count", () => {
    expect(categoryDelta(category("titles", "warning", 4), PREVIOUS)).toBe(-7);
    expect(categoryDelta(category("indexability", "error", 3), PREVIOUS)).toBe(3);
  });

  it("reports no change as 0, not as absent", () => {
    expect(categoryDelta(category("titles", "warning", 11), PREVIOUS)).toBe(0);
  });

  it("returns null when there is no previous audit", () => {
    expect(categoryDelta(category("titles", "warning", 4), null)).toBeNull();
    expect(categoryDelta(category("titles", "warning", 4), undefined)).toBeNull();
  });

  /**
   * A category the previous rollup does not carry predates that audit. Treating
   * the gap as zero would claim "+4" for a category that was never measured.
   */
  it("returns null for a category the previous audit did not have", () => {
    expect(categoryDelta(category("h1", "warning", 4), PREVIOUS)).toBeNull();
  });

  it("ignores a non-numeric previous count", () => {
    const broken = {
      ...PREVIOUS,
      categoryCounts: { titles: Number.NaN },
    } as AuditComparison;
    expect(categoryDelta(category("titles", "warning", 4), broken)).toBeNull();
  });
});

describe("deltaTone", () => {
  it("treats fewer issues as better", () => {
    expect(deltaTone(-7)).toBe("better");
    expect(deltaTone(3)).toBe("worse");
    expect(deltaTone(0)).toBe("flat");
    expect(deltaTone(null)).toBe("flat");
  });
});

describe("formatDelta", () => {
  it("always shows a sign so the chip cannot read as a page count", () => {
    expect(formatDelta(3)).toBe("+3");
    expect(formatDelta(0)).toBe("0");
    expect(formatDelta(null)).toBe("—");
  });

  it("uses a real minus sign, not a hyphen", () => {
    expect(formatDelta(-7)).toBe("−7");
  });
});

describe("deltaTitle", () => {
  it("explains the direction in words", () => {
    expect(deltaTitle(-1, "Titles")).toContain("1 page fewer");
    expect(deltaTitle(3, "Titles")).toContain("3 pages more");
    expect(deltaTitle(0, "Titles")).toContain("Unchanged");
    expect(deltaTitle(null, "Titles")).toContain("No previous audit");
  });
});

describe("scoreDelta", () => {
  /** Score is the one up-is-good number on the screen. */
  it("is positive when the score improved", () => {
    expect(scoreDelta(90, PREVIOUS)).toBe(7.5);
    expect(scoreDelta(80, PREVIOUS)).toBe(-2.5);
  });

  it("is null when either side is missing", () => {
    expect(scoreDelta(null, PREVIOUS)).toBeNull();
    expect(scoreDelta(90, null)).toBeNull();
    expect(scoreDelta(90, { ...PREVIOUS, score: null })).toBeNull();
  });

  it("formats to at most one decimal", () => {
    expect(formatScoreDelta(7.5)).toBe("+7.5");
    expect(formatScoreDelta(-2)).toBe("−2");
    expect(formatScoreDelta(0)).toBe("0");
    expect(formatScoreDelta(null)).toBe("—");
  });
});

/* -------------------------------------------------------------------------- */

describe("scoreBand", () => {
  it("bands on 90 and 70", () => {
    expect(scoreBand(100)).toBe("good");
    expect(scoreBand(90)).toBe("good");
    expect(scoreBand(89.9)).toBe("fair");
    expect(scoreBand(70)).toBe("fair");
    expect(scoreBand(69.9)).toBe("poor");
    expect(scoreBand(0)).toBe("poor");
  });

  it("distinguishes an unmeasured score from a bad one", () => {
    expect(scoreBand(null)).toBe("unknown");
    expect(scoreBand(undefined)).toBe("unknown");
    expect(scoreBand(Number.NaN)).toBe("unknown");
    expect(scoreBand(0)).not.toBe("unknown");
  });
});

describe("core web vitals bands", () => {
  it("uses the published LCP thresholds", () => {
    expect(lcpBand(2500)).toBe("good");
    expect(lcpBand(2501)).toBe("fair");
    expect(lcpBand(4000)).toBe("fair");
    expect(lcpBand(4001)).toBe("poor");
    expect(lcpBand(null)).toBe("unknown");
  });

  it("uses the published CLS thresholds", () => {
    expect(clsBand(0.1)).toBe("good");
    expect(clsBand(0.11)).toBe("fair");
    expect(clsBand(0.25)).toBe("fair");
    expect(clsBand(0.26)).toBe("poor");
    expect(clsBand(0)).toBe("good");
  });

  it("bands TBT on Lighthouse's lab gates, not INP's", () => {
    expect(tbtBand(200)).toBe("good");
    expect(tbtBand(201)).toBe("fair");
    expect(tbtBand(600)).toBe("fair");
    expect(tbtBand(601)).toBe("poor");
  });

  it("inverts for the performance score, where higher is better", () => {
    expect(performanceBand(90)).toBe("good");
    expect(performanceBand(89)).toBe("fair");
    expect(performanceBand(50)).toBe("fair");
    expect(performanceBand(49)).toBe("poor");
    expect(performanceBand(null)).toBe("unknown");
  });
});

describe("interactionMetric", () => {
  /**
   * `inpMs` is null on every run we make, so the fallback is the normal path.
   * The label has to change with it — TBT under an "INP" heading would be a
   * different measurement wearing a familiar name.
   */
  it("falls back to TBT and relabels when INP is absent", () => {
    const metric = interactionMetric(lighthouse({ tbtMs: 340 }));
    expect(metric.kind).toBe("tbt");
    expect(metric.label).toBe("TBT (lab)");
    expect(metric.ms).toBe(340);
    expect(metric.band).toBe("fair");
  });

  it("prefers INP when field data actually carried it", () => {
    const metric = interactionMetric(lighthouse({ inpMs: 120, tbtMs: 900 }));
    expect(metric.kind).toBe("inp");
    expect(metric.label).toBe("INP");
    expect(metric.ms).toBe(120);
    expect(metric.band).toBe("good");
  });

  it("reports nothing measured when both are missing", () => {
    const metric = interactionMetric(lighthouse({}));
    expect(metric.kind).toBe("tbt");
    expect(metric.ms).toBeNull();
    expect(metric.band).toBe("unknown");
  });

  it("has no metric at all without a Lighthouse run", () => {
    expect(interactionMetric(null).kind).toBe("none");
  });
});

/* -------------------------------------------------------------------------- */

describe("number formatting", () => {
  it("renders null as an em dash and zero as zero", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234)).toBe("1,234");
  });

  it("switches milliseconds to seconds past a second", () => {
    expect(formatMs(480)).toBe("480 ms");
    expect(formatMs(999)).toBe("999 ms");
    expect(formatMs(1000)).toBe("1.0 s");
    expect(formatMs(2480)).toBe("2.5 s");
    expect(formatMs(null)).toBe("—");
  });

  it("gives CLS two decimals", () => {
    expect(formatCls(0.081)).toBe("0.08");
    expect(formatCls(0)).toBe("0.00");
    expect(formatCls(null)).toBe("—");
  });

  it("only shows a decimal on a score that has one", () => {
    expect(formatScore(94)).toBe("94");
    expect(formatScore(94.4)).toBe("94.4");
    expect(formatScore(null)).toBe("—");
  });

  it("pluralises pages", () => {
    expect(pluralPages(1)).toBe("1 page");
    expect(pluralPages(0)).toBe("0 pages");
    expect(pluralPages(1500)).toBe("1,500 pages");
  });
});

describe("formatAuditTime", () => {
  it("keeps the clock time — an audit is a moment, not a day", () => {
    expect(formatAuditTime("2026-08-29T14:32:00.000Z")).toMatch(/29 Aug 2026/);
  });

  it("degrades to an em dash rather than Invalid Date", () => {
    expect(formatAuditTime(null)).toBe("—");
    expect(formatAuditTime("")).toBe("—");
    expect(formatAuditTime("not a date")).toBe("—");
  });
});

describe("isInFlight", () => {
  it("treats pending and running as one waiting state", () => {
    expect(isInFlight("pending")).toBe(true);
    expect(isInFlight("running")).toBe(true);
    expect(isInFlight("done")).toBe(false);
    expect(isInFlight("failed")).toBe(false);
  });
});
