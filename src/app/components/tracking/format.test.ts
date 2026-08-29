import { describe, expect, it } from "vitest";

import type {
  RankSnapshot,
  TrackedKeywordRow,
} from "../../../shared/tracking";
import {
  averagePosition,
  changeTitle,
  changeTone,
  formatAveragePosition,
  formatBestPosition,
  formatChange,
  formatCostHint,
  formatDay,
  formatLastChecked,
  formatPosition,
  netChange7d,
  parseKeywordLines,
  pluralKeywords,
  positionState,
  rankingPath,
  topTenCount,
} from "./format";

function snapshot(position: number | null, date = "2026-08-20"): RankSnapshot {
  return { date, position, url: null, serpFeatures: [] };
}

function row(overrides: Partial<TrackedKeywordRow> = {}): TrackedKeywordRow {
  return {
    id: "id-1",
    keyword: "photo booth templates",
    device: "desktop",
    locationCode: 2826,
    languageCode: "en",
    createdAt: "2026-08-01T00:00:00.000Z",
    latest: null,
    previous: null,
    change1d: null,
    change7d: null,
    change30d: null,
    bestPosition: null,
    aiOverview: false,
    series: [],
    ...overrides,
  };
}

/* ----------------------------- position states ----------------------------- */

describe("positionState", () => {
  /*
   * The distinction the whole table hangs on. `latest === null` means no check
   * has completed; `latest.position === null` means a check completed and found
   * nothing in the top 100. They are different facts and must render
   * differently.
   */
  it("separates never-checked from checked-and-unranked", () => {
    expect(positionState(null)).toEqual({ kind: "awaiting" });
    expect(positionState(snapshot(null))).toEqual({
      kind: "unranked",
      date: "2026-08-20",
    });
  });

  it("reports a real position", () => {
    expect(positionState(snapshot(7))).toEqual({
      kind: "ranked",
      position: 7,
      date: "2026-08-20",
    });
  });
});

describe("formatPosition", () => {
  it("says so in words when nothing has been checked yet", () => {
    expect(formatPosition(null)).toBe("Awaiting first check");
  });

  it("reserves the dash for a measured absence", () => {
    expect(formatPosition(snapshot(null))).toBe("—");
  });

  it("renders position 1 as a number, not as falsy-empty", () => {
    expect(formatPosition(snapshot(1))).toBe("1");
  });
});

describe("formatBestPosition", () => {
  it("dashes when a keyword has never ranked", () => {
    expect(formatBestPosition(null)).toBe("—");
  });

  it("renders a best position", () => {
    expect(formatBestPosition(3)).toBe("3");
  });
});

/* --------------------------------- changes --------------------------------- */

describe("formatChange", () => {
  it("always signs a movement", () => {
    expect(formatChange(5)).toBe("+5");
    expect(formatChange(-5)).toBe("-5");
  });

  it("renders no movement as zero and no baseline as a dash", () => {
    expect(formatChange(0)).toBe("0");
    expect(formatChange(null)).toBe("—");
  });
});

describe("changeTitle", () => {
  it("agrees with a one-day window", () => {
    expect(changeTitle(2, 1)).toBe("Up 2 places over 1 day.");
    expect(changeTitle(-1, 1)).toBe("Down 1 place over 1 day.");
  });

  it("pluralises longer windows", () => {
    expect(changeTitle(5, 7)).toBe("Up 5 places over 7 days.");
    expect(changeTitle(0, 30)).toBe("Unchanged over 30 days.");
  });

  it("explains a missing baseline rather than claiming no movement", () => {
    expect(changeTitle(null, 7)).toBe(
      "No observation from 7 days ago to compare against.",
    );
  });
});

describe("changeTone", () => {
  /*
   * Positive is green. The Worker already applied down-is-good, so a +5 here
   * is a keyword that climbed five places. Re-inverting would paint every
   * improvement red — the single most likely way to get this screen wrong.
   */
  it("colours an improvement up and a decline down", () => {
    expect(changeTone(5)).toBe("up");
    expect(changeTone(-5)).toBe("down");
  });

  it("treats zero and null as flat", () => {
    expect(changeTone(0)).toBe("flat");
    expect(changeTone(null)).toBe("flat");
  });
});

/* ---------------------------------- dates ---------------------------------- */

describe("formatDay", () => {
  /*
   * `lastCheckedAt` is a UTC-midnight, day-grained timestamp. Formatted in a
   * timezone behind UTC it would render as the previous day — so this must be
   * pinned to UTC regardless of where the test or the user runs.
   */
  it("renders UTC midnight as that day, not the one before", () => {
    expect(formatDay("2026-08-20T00:00:00.000Z")).toBe("20 Aug 2026");
  });

  it("accepts a bare YYYY-MM-DD", () => {
    expect(formatDay("2026-08-20")).toBe("20 Aug 2026");
  });

  it("never includes a clock time", () => {
    expect(formatDay("2026-08-20T00:00:00.000Z")).not.toMatch(/\d\d:\d\d/);
  });

  it("dashes on null or unparseable input", () => {
    expect(formatDay(null)).toBe("—");
    expect(formatDay("")).toBe("—");
    expect(formatDay("nonsense")).toBe("—");
  });
});

describe("formatLastChecked", () => {
  it("says a project has never been checked", () => {
    expect(formatLastChecked(null)).toBe("Not checked yet");
  });

  it("otherwise renders the day", () => {
    expect(formatLastChecked("2026-08-20T00:00:00.000Z")).toBe("20 Aug 2026");
  });
});

/* ------------------------------- ranking URLs ------------------------------ */

/*
 * `rankingPath` is `urlPath` from components/domains, re-exported. Its own
 * behaviour is covered by that module's tests; what is worth pinning here is
 * the re-export itself — the tracking table renders a null URL for every
 * keyword that did not rank, and a dash is the only correct answer for it.
 */
describe("rankingPath", () => {
  it("keeps the path and drops the host every row shares", () => {
    expect(rankingPath("https://brandpacks.com/templates/photo-booth")).toBe(
      "/templates/photo-booth",
    );
  });

  it("dashes when the domain did not rank", () => {
    expect(rankingPath(null)).toBe("—");
  });
});

/* --------------------------------- metrics --------------------------------- */

describe("topTenCount", () => {
  it("counts positions 1 to 10 inclusive", () => {
    const rows = [
      row({ latest: snapshot(1) }),
      row({ latest: snapshot(10) }),
      row({ latest: snapshot(11) }),
    ];
    expect(topTenCount(rows)).toBe(2);
  });

  it("excludes unranked and unchecked keywords", () => {
    expect(topTenCount([row({ latest: null }), row({ latest: snapshot(null) })])).toBe(0);
  });
});

describe("averagePosition", () => {
  it("averages the keywords that currently rank", () => {
    const rows = [row({ latest: snapshot(2) }), row({ latest: snapshot(8) })];
    expect(averagePosition(rows)).toBe(5);
  });

  /*
   * Unranked keywords are excluded, not counted as 100. Substituting a number
   * for "absent" would make the average *improve* when a keyword dropped out
   * of the top 100 and was replaced by a worse-but-present one.
   */
  it("excludes unranked keywords instead of scoring them 100", () => {
    const rows = [row({ latest: snapshot(4) }), row({ latest: snapshot(null) })];
    expect(averagePosition(rows)).toBe(4);
  });

  it("is null when nothing ranks", () => {
    expect(averagePosition([row({ latest: null })])).toBeNull();
    expect(averagePosition([])).toBeNull();
  });
});

describe("formatAveragePosition", () => {
  it("shows one decimal place", () => {
    expect(formatAveragePosition(5)).toBe("5.0");
    expect(formatAveragePosition(4.25)).toBe("4.3");
  });

  it("dashes when there is no average", () => {
    expect(formatAveragePosition(null)).toBe("—");
  });
});

describe("netChange7d", () => {
  it("sums the comparable deltas and counts them", () => {
    const rows = [
      row({ change7d: 4 }),
      row({ change7d: -1 }),
      row({ change7d: null }),
    ];
    expect(netChange7d(rows)).toEqual({ net: 3, comparable: 2 });
  });

  it("reports zero comparable rows rather than a confident zero net", () => {
    expect(netChange7d([row({ change7d: null })])).toEqual({
      net: 0,
      comparable: 0,
    });
  });
});

/* ---------------------------------- money ---------------------------------- */

describe("formatCostHint", () => {
  /*
   * One keyword costs $0.006. At two decimal places that rounds to "$0.01" at
   * best and "$0.00" at worst — and a hint that says a paid check is free is
   * the one rounding error worth four extra characters to avoid.
   */
  it("keeps sub-cent estimates visible instead of rounding them to free", () => {
    expect(formatCostHint(0.006)).toBe("$0.0060");
    expect(formatCostHint(0.0006)).toBe("$0.0006");
  });

  it("uses two decimals once the figure is a cent or more", () => {
    // A three-keyword check: 3 × $0.006.
    expect(formatCostHint(0.018)).toBe("$0.02");
    expect(formatCostHint(0.6)).toBe("$0.60");
    expect(formatCostHint(1.5)).toBe("$1.50");
  });

  it("handles nothing to spend", () => {
    expect(formatCostHint(0)).toBe("$0.00");
    expect(formatCostHint(Number.NaN)).toBe("$0.00");
  });
});

describe("pluralKeywords", () => {
  it("agrees with its count", () => {
    expect(pluralKeywords(1)).toBe("1 keyword");
    expect(pluralKeywords(2)).toBe("2 keywords");
    expect(pluralKeywords(0)).toBe("0 keywords");
  });

  it("groups thousands", () => {
    expect(pluralKeywords(1200)).toBe("1,200 keywords");
  });
});

/* ------------------------------ keyword input ------------------------------ */

describe("parseKeywordLines", () => {
  it("takes one keyword per line, trimmed", () => {
    expect(parseKeywordLines("photo booth\n  strip templates  ").keywords).toEqual(
      ["photo booth", "strip templates"],
    );
  });

  it("drops blank lines without counting them", () => {
    const parsed = parseKeywordLines("a\n\n   \nb\n");
    expect(parsed.keywords).toEqual(["a", "b"]);
    expect(parsed.lines).toBe(2);
  });

  it("handles Windows line endings", () => {
    expect(parseKeywordLines("a\r\nb").keywords).toEqual(["a", "b"]);
  });

  /*
   * The route lowercases before its unique index sees the value, so these are
   * one keyword. Reporting them as two would promise an add that then comes
   * back as `skipped`.
   */
  it("de-duplicates case-insensitively and says how many repeated", () => {
    const parsed = parseKeywordLines("Photo Booth\nphoto booth\nstrips");
    expect(parsed.keywords).toEqual(["photo booth", "strips"]);
    expect(parsed.lines).toBe(3);
    expect(parsed.duplicates).toBe(1);
  });

  it("reports no duplicates for a clean list", () => {
    expect(parseKeywordLines("a\nb\nc").duplicates).toBe(0);
  });

  it("returns nothing for empty input", () => {
    expect(parseKeywordLines("")).toEqual({
      keywords: [],
      lines: 0,
      duplicates: 0,
    });
    expect(parseKeywordLines("   \n  ").keywords).toEqual([]);
  });
});
