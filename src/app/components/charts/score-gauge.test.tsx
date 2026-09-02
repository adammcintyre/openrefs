/**
 * The dial has one job beyond drawing an arc: agree with every other place a
 * score is coloured.
 *
 * A user reading 62 as green on the Domain Overview and as blue on the
 * link-profile table beside it would rightly conclude one of the two screens is
 * lying about what the number means. So the boundary cases are driven off
 * `SCORE_BANDS` — the shared constant — rather than off numbers typed into this
 * file, and the tone is asserted against what `ScoreBadge` actually renders for
 * the same score rather than against a class name copied out of it. Re-band the
 * scale and both halves move together or this suite fails.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SCORE_BANDS, scoreBand } from "../../../shared/backlinks";
import { ScoreBadge } from "../backlinks/badges";
import { bandLabel } from "../backlinks/format";
import { GAUGE_MAX, GAUGE_MIN, SCORE_HELP, ScoreGauge } from "./score-gauge";

const TARGET = "brandpacks.com";

function render(
  props: Partial<Parameters<typeof ScoreGauge>[0]> & { score: number | null },
): string {
  return renderToString(<ScoreGauge target={TARGET} {...props} />);
}

/**
 * The background token a rendered badge is wearing.
 *
 * The gauge's only tinted element is its band badge, so the first `bg-*` class
 * in either tree is the thing being compared. Comparing tokens rather than
 * hex values keeps the check honest in both themes at once — the pairing is
 * defined in theme.css, and both components ask for it by the same name.
 */
function tone(html: string): string | undefined {
  return /class="[^"]*\b(bg-[\w-]+)\b/.exec(html)?.[1];
}

describe("banding", () => {
  /**
   * Every threshold in the shared table, checked at the boundary and one point
   * under it. `scoreBand` is inclusive of `min`, so the band must be the new
   * one *at* the number and the old one just below.
   */
  it.each(SCORE_BANDS.filter((entry) => entry.min > GAUGE_MIN))(
    "changes band at $min",
    ({ min, band }) => {
      const at = render({ score: min });
      const below = render({ score: min - 1 });

      expect(at).toContain(bandLabel(band));
      expect(tone(at)).not.toBe(tone(below));
      expect(below).toContain(bandLabel(scoreBand(min - 1)));
    },
  );

  /** The lowest band has no threshold under it; the floor of the scale is it. */
  it("bands the bottom of the scale", () => {
    const html = render({ score: GAUGE_MIN });
    expect(html).toContain(bandLabel(scoreBand(GAUGE_MIN)));
    expect(html).toContain(`>${GAUGE_MIN}<`);
  });

  /**
   * The point of pinning this: the dial and the table badge are two renderings
   * of one fact and must never disagree about its colour.
   */
  it.each(SCORE_BANDS.map((entry) => entry.min))(
    "wears the same tone as ScoreBadge at %i",
    (score) => {
      const gauge = render({ score });
      const badge = renderToString(
        <ScoreBadge score={score} label="Domain Score" />,
      );
      expect(tone(gauge)).toBe(tone(badge));
    },
  );
});

describe("the number", () => {
  it("prints the score, rounded", () => {
    expect(render({ score: 61.7 })).toContain(">62<");
  });

  it("clamps a score the provider put out of range", () => {
    expect(render({ score: 140 })).toContain(`>${GAUGE_MAX}<`);
    expect(render({ score: -5 })).toContain(`>${GAUGE_MIN}<`);
  });

  it("says what the scale is, once, in the tooltip", () => {
    expect(render({ score: 40 })).toContain(SCORE_HELP);
  });
});

describe("accessibility", () => {
  it("is a meter carrying its value and its bounds", () => {
    const html = render({ score: 62 });
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="62"');
    expect(html).toContain(`aria-valuemin="${GAUGE_MIN}"`);
    expect(html).toContain(`aria-valuemax="${GAUGE_MAX}"`);
  });

  it("names the domain it is describing", () => {
    const html = render({ score: 62 });
    expect(html).toContain(`aria-label="Domain Score for ${TARGET}`);
  });

  /** The number, the band and the bounds — read out, not just drawn. */
  it("reads the band out loud rather than leaving it to the colour", () => {
    const html = render({ score: 62 });
    expect(html).toContain(`62 out of ${GAUGE_MAX} — ${bandLabel(scoreBand(62))}`);
  });

  it("takes a different label for a different scale", () => {
    expect(render({ score: 62, label: "Page Score" })).toContain(
      `aria-label="Page Score for ${TARGET}`,
    );
  });
});

describe("no score", () => {
  /**
   * Null is "the index has not measured this site", which is a different claim
   * from a score of zero — and zero is a real score a real site can have.
   */
  it.each([null, undefined, Number.NaN])("renders %s as an em dash", (score) => {
    const html = renderToString(
      <ScoreGauge score={score as number | null} target={TARGET} />,
    );
    expect(html).toContain("—");
    expect(html).not.toContain('aria-valuenow="0"');
  });

  it("explains itself rather than looking broken", () => {
    expect(render({ score: null })).toContain(
      "The backlinks index has no data for this domain",
    );
  });

  /** Not a meter: a meter with no value is a meter making something up. */
  it("stops being a meter when there is nothing to meter", () => {
    const html = render({ score: null });
    expect(html).not.toContain('role="meter"');
    expect(html).toContain('role="img"');
    expect(html).toContain(`aria-label="Domain Score for ${TARGET}: not reported"`);
  });

  /**
   * A failed lookup and an unmeasured domain look the same on the dial and must
   * not read the same in words — one is a fact about the site, the other is a
   * fact about the request.
   */
  it("says so when the lookup failed rather than came back empty", () => {
    const html = render({
      score: null,
      unavailableNote: "DataForSEO did not answer.",
    });
    expect(html).toContain("DataForSEO did not answer.");
    expect(html).not.toContain("has no data for this domain");
  });
});

describe("loading", () => {
  it("shows a placeholder, not a zero", () => {
    const html = render({ score: null, loading: true });
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("—");
    expect(html).not.toContain('role="meter"');
  });

  /**
   * The skeleton is the dial's own aspect ratio rather than a guessed height,
   * so the metrics row does not jump when the score lands.
   */
  it("reserves the dial's exact footprint", () => {
    expect(render({ score: null, loading: true })).toContain("aspect-[168/100]");
  });
});

describe("slots", () => {
  it("carries the provenance chip and the way out to Backlinks", () => {
    const html = renderToString(
      <ScoreGauge
        score={62}
        target={TARGET}
        badge={<span>Cached</span>}
        footer={<a href="/app/backlinks">View backlinks</a>}
      />,
    );
    expect(html).toContain("Cached");
    expect(html).toContain("View backlinks");
  });
});
