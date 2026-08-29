import { describe, expect, it } from "vitest";

import type { AiEngineTimeline } from "../../../shared/ai";
import {
  citationLabel,
  describeRun,
  formatEstimate,
  formatRate,
  formatSpend,
  highlightSegments,
  mergeTimelines,
  safeHttpUrl,
  toPercent,
  totalSpend,
} from "./format";

/* -------------------------------- highlight -------------------------------- */

/** The plain text a caller would render, reassembled from the segments. */
const rejoin = (segments: { text: string }[]) =>
  segments.map((segment) => segment.text).join("");

/** Just the highlighted runs, in order. */
const matches = (segments: { text: string; match: boolean }[]) =>
  segments.filter((segment) => segment.match).map((segment) => segment.text);

describe("highlightSegments", () => {
  it("finds a term regardless of case and keeps the excerpt's own casing", () => {
    const segments = highlightSegments(
      "Try BrandPacks.com for templates.",
      ["brandpacks.com"],
    );

    expect(matches(segments)).toEqual(["BrandPacks.com"]);
    expect(rejoin(segments)).toBe("Try BrandPacks.com for templates.");
  });

  it("highlights every occurrence, not just the first", () => {
    const segments = highlightSegments(
      "BrandPacks is good. I like BrandPacks.",
      ["brandpacks"],
    );

    expect(matches(segments)).toEqual(["BrandPacks", "BrandPacks"]);
  });

  /*
   * The overlap case the contract guarantees will happen: the API sends both
   * the bare name and the full domain. Emitting a segment per raw hit would
   * wrap "brandpacks" inside "brandpacks.com" and render the text twice.
   */
  it("merges overlapping terms into one run rather than nesting them", () => {
    const segments = highlightSegments("Visit brandpacks.com today", [
      "brandpacks.com",
      "brandpacks",
    ]);

    expect(matches(segments)).toEqual(["brandpacks.com"]);
    expect(rejoin(segments)).toBe("Visit brandpacks.com today");
  });

  it("joins touching terms into a single highlighted phrase", () => {
    const segments = highlightSegments("brandpacks.com", [
      "brandpacks",
      ".com",
    ]);

    expect(matches(segments)).toEqual(["brandpacks.com"]);
  });

  /*
   * A term is put through indexOf, never a regex. Compiled as a pattern, the
   * dot in a domain is "any character" — which is how a near-miss domain gets
   * reported as a mention.
   */
  it("treats a dot as a literal, so a near-miss domain does not match", () => {
    const segments = highlightSegments("See brandpacksXcom for more", [
      "brandpacks.com",
    ]);

    expect(matches(segments)).toEqual([]);
    expect(segments).toEqual([
      { text: "See brandpacksXcom for more", match: false },
    ]);
  });

  it("survives a term containing regex metacharacters", () => {
    const segments = highlightSegments("a (b) c", ["(b)"]);
    expect(matches(segments)).toEqual(["(b)"]);
  });

  it("ignores empty and whitespace-only terms instead of looping forever", () => {
    const segments = highlightSegments("hello world", ["", "   "]);
    expect(segments).toEqual([{ text: "hello world", match: false }]);
  });

  it("returns the whole excerpt unhighlighted when nothing matches", () => {
    const segments = highlightSegments("no mention here", ["brandpacks"]);
    expect(segments).toEqual([{ text: "no mention here", match: false }]);
  });

  it("handles an empty excerpt", () => {
    expect(highlightSegments("", ["brandpacks"])).toEqual([]);
  });

  /*
   * A real payload, copied from a live Perplexity run against brandpacks.com
   * on 2026-08-29 (`mentionTerms: ["brandpacks.com"]`). Two things about it
   * would have been easy to get wrong from the type alone: the answer is
   * markdown, so the term arrives wrapped in asterisks that must stay outside
   * the mark; and the same term recurs later in the text, so a first-hit-only
   * implementation would highlight one of three.
   */
  it("marks a real mention inside markdown without swallowing the syntax", () => {
    const excerpt =
      "**brandpacks.com** is a website for **graphic design templates** " +
      "aimed at designers.[1][3] They sell editable templates. " +
      "Visit brandpacks.com for downloads.";

    const segments = highlightSegments(excerpt, ["brandpacks.com"]);

    expect(matches(segments)).toEqual(["brandpacks.com", "brandpacks.com"]);
    // The asterisks are the answer's own markdown and belong to the plain
    // runs either side, not to the highlight.
    expect(segments[0]).toEqual({ text: "**", match: false });
    expect(rejoin(segments)).toBe(excerpt);
  });

  /*
   * The other real shape: every snapshot from a run where the domain was not
   * mentioned arrives with `mentionTerms: []`. Observed on three of four live
   * snapshots, so this is the common case, not an edge case.
   */
  it("renders an unmentioned answer as one plain run", () => {
    const excerpt = "Some good options are Canva and Adobe Express.";
    expect(highlightSegments(excerpt, [])).toEqual([
      { text: excerpt, match: false },
    ]);
  });

  it("never drops or duplicates text, whatever the terms", () => {
    const excerpt =
      "BrandPacks.com and brandpacks and BRANDPACKS.COM, plus templatesbooth.com.";
    const segments = highlightSegments(excerpt, [
      "brandpacks",
      "brandpacks.com",
      "templatesbooth.com",
      "com",
    ]);

    expect(rejoin(segments)).toBe(excerpt);
  });
});

/* ---------------------------------- rates ---------------------------------- */

describe("formatRate", () => {
  it("renders a 0-1 rate as a percentage", () => {
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(0.5)).toBe("50%");
    expect(formatRate(0.333)).toBe("33.3%");
  });

  /*
   * The distinction the whole chart rests on: 0% is a measurement (we ran, you
   * were not mentioned), null is the absence of one.
   */
  it("keeps zero and 'never ran' apart", () => {
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(null)).toBe("—");
  });
});

describe("toPercent", () => {
  it("scales to 0-100 and preserves null", () => {
    expect(toPercent(0.25)).toBe(25);
    expect(toPercent(0)).toBe(0);
    expect(toPercent(null)).toBeNull();
  });
});

describe("mergeTimelines", () => {
  const timeline = (
    engine: AiEngineTimeline["engine"],
    points: Array<[string, number | null]>,
  ): AiEngineTimeline => ({
    engine,
    points: points.map(([date, mentionRate]) => ({
      date,
      runs: mentionRate === null ? 0 : 2,
      mentions: 0,
      citations: 0,
      mentionRate,
      citationRate: null,
    })),
    mentionRate: null,
    citationRate: null,
  });

  it("unions the dates of every engine, oldest first", () => {
    const rows = mergeTimelines([
      timeline("perplexity", [["2026-08-20", 0.5], ["2026-08-22", 1]]),
      timeline("chat_gpt", [["2026-08-22", 0]]),
    ]);

    expect(rows.map((row) => row.date)).toEqual(["2026-08-20", "2026-08-22"]);
    expect(rows[0]).toEqual({ date: "2026-08-20", perplexity: 50 });
    expect(rows[1]).toEqual({
      date: "2026-08-22",
      perplexity: 100,
      chat_gpt: 0,
    });
  });

  /*
   * An engine that did not run on a date is simply absent from that row, so
   * Recharts breaks the line. Writing 0 would draw a crash to the floor and
   * read as lost visibility.
   */
  it("leaves a gap rather than a zero where an engine did not run", () => {
    const rows = mergeTimelines([
      timeline("perplexity", [["2026-08-20", 0.5]]),
      timeline("chat_gpt", [["2026-08-21", 0.5]]),
    ]);

    expect(rows[0]?.chat_gpt).toBeUndefined();
    expect(rows[1]?.perplexity).toBeUndefined();
  });

  it("carries a null rate through as null, not as absent", () => {
    const rows = mergeTimelines([
      timeline("perplexity", [["2026-08-20", null]]),
    ]);

    expect(rows[0]).toEqual({ date: "2026-08-20", perplexity: null });
  });

  it("returns nothing for no timelines", () => {
    expect(mergeTimelines([])).toEqual([]);
  });
});

/* ---------------------------------- money ---------------------------------- */

describe("cost formatting", () => {
  /*
   * The two must never be interchangeable at a call site: one is a guess at a
   * bill dominated by a web-search fee, the other is what was charged.
   */
  it("hedges an estimate and states a real spend plainly", () => {
    expect(formatEstimate(0.028)).toBe("est. $0.028");
    expect(formatSpend(0.028)).toBe("$0.028");
  });

  it("keeps three decimals for the sub-cent prices this feature deals in", () => {
    // Two decimals would round a real Perplexity call to "$0.01".
    expect(formatSpend(0.006)).toBe("$0.006");
    expect(formatSpend(0.0006)).toBe("$0.001");
  });

  it("drops to two decimals once a figure is dollars", () => {
    expect(formatSpend(1.5)).toBe("$1.50");
    expect(formatSpend(12)).toBe("$12.00");
  });

  it("sums real snapshot costs without floating-point crumbs", () => {
    const snapshot = (costUsd: number) => ({ costUsd }) as never;
    expect(totalSpend([snapshot(0.006), snapshot(0.028), snapshot(0.012)])).toBe(
      0.046,
    );
  });
});

describe("describeRun", () => {
  /* A run bills per prompt x engine — the multiplier is the surprise. */
  it("names calls and prompts separately", () => {
    expect(describeRun(4, 12)).toBe("12 calls across 4 prompts");
    expect(describeRun(1, 1)).toBe("1 call across 1 prompt");
  });
});

/* --------------------------------- linking --------------------------------- */

describe("safeHttpUrl", () => {
  it("passes http and https through", () => {
    expect(safeHttpUrl("https://brandpacks.com/a")).toBe(
      "https://brandpacks.com/a",
    );
    expect(safeHttpUrl("http://example.com/")).toBe("http://example.com/");
  });

  /* A citation URL goes into an href; a javascript: value there would run. */
  it("refuses every other scheme", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
  });
});

describe("citationLabel", () => {
  it("prefers a title, then the host, then the raw URL", () => {
    expect(
      citationLabel({
        title: "Best template sites",
        host: "brandpacks.com",
        url: "https://brandpacks.com/a",
      }),
    ).toBe("Best template sites");

    expect(
      citationLabel({
        title: null,
        host: "brandpacks.com",
        url: "https://brandpacks.com/a",
      }),
    ).toBe("brandpacks.com");

    // Non-http(s) citations arrive with a null host and must still render.
    expect(
      citationLabel({ title: null, host: null, url: "ftp://example.com/x" }),
    ).toBe("ftp://example.com/x");
  });

  it("treats a blank title as no title", () => {
    expect(
      citationLabel({ title: "   ", host: "brandpacks.com", url: "u" }),
    ).toBe("brandpacks.com");
  });
});
