/**
 * The two badges the quality pass added, and the one rule they both turn on:
 * a spam score is the *provider's* judgement and runs the opposite way to ours.
 *
 * Domain Score and Page Score are 0–100 where high is good. DataForSEO's spam
 * score is 0–100 where high is bad. Sharing a colour ramp between them would
 * paint the best link in a profile the same shade as the worst, so the grading
 * here is deliberately its own thing and is pinned at its boundaries.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BACKLINKS_SPAM_HIDE_THRESHOLD } from "../../../shared/backlinks";
import { LinkTypeBadge, SpamBadge, spamGrade } from "./badges";

describe("spamGrade", () => {
  /**
   * The muted band runs to 30, which is exactly where "Hide likely spam" cuts.
   * If these two ever disagree, the toggle would leave rows on screen that the
   * table is painting as clean, or hide rows it is painting as ordinary.
   */
  it("ends its quiet band where the hide toggle cuts", () => {
    expect(spamGrade(BACKLINKS_SPAM_HIDE_THRESHOLD).variant).toBe("neutral");
    expect(spamGrade(BACKLINKS_SPAM_HIDE_THRESHOLD + 1).variant).toBe("warning");
  });

  it("grades the three bands", () => {
    expect(spamGrade(0).variant).toBe("neutral");
    expect(spamGrade(30).variant).toBe("neutral");
    expect(spamGrade(31).variant).toBe("warning");
    expect(spamGrade(60).variant).toBe("warning");
    expect(spamGrade(61).variant).toBe("danger");
    expect(spamGrade(100).variant).toBe("danger");
  });

  it("names each band in words, so colour is never the only channel", () => {
    expect(spamGrade(5).label).toBe("low spam signals");
    expect(spamGrade(45).label).toBe("some spam signals");
    expect(spamGrade(90).label).toBe("high spam signals");
  });
});

describe("SpamBadge", () => {
  it("prints the number alongside the colour", () => {
    expect(renderToString(<SpamBadge score={72} />)).toContain(">72<");
  });

  it("rounds rather than implying decimal precision", () => {
    expect(renderToString(<SpamBadge score={29.6} />)).toContain(">30<");
  });

  /** Null is "not scored", which is not a claim that the link is clean. */
  it("renders an unreported score as an em dash", () => {
    const html = renderToString(<SpamBadge score={null} />);
    expect(html).toContain("—");
    expect(html).toContain("did not report a spam score");
  });

  /** The number is theirs; the tooltip has to say so. */
  it("attributes the score to DataForSEO", () => {
    expect(renderToString(<SpamBadge score={72} />)).toContain(
      "not an OpenRefs metric",
    );
  });
});

describe("LinkTypeBadge", () => {
  it("names the type and explains it", () => {
    const html = renderToString(<LinkTypeBadge itemType="image" />);
    expect(html).toContain(">image<");
    expect(html).toContain("no anchor text to report");
  });

  it("passes an unrecognised provider type through rather than hiding it", () => {
    expect(renderToString(<LinkTypeBadge itemType="sponsored" />)).toContain(
      ">sponsored<",
    );
  });

  it("renders a missing type as an em dash", () => {
    expect(renderToString(<LinkTypeBadge itemType={null} />)).toContain("—");
  });
});
