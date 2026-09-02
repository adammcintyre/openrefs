/**
 * Domain Score as a dial — the at-a-glance authority read.
 *
 * Hand-rolled inline SVG rather than Recharts. One arc and one number is a
 * dozen lines of path maths; pulling in a charting library to draw it would
 * hand a headline card a code-split bundle it does not need, and would put the
 * one number people look at first behind a lazy chunk.
 *
 * **Nothing here decides what a score means.** The thresholds come from
 * `scoreBand()` in the shared types and the tones from
 * `components/backlinks/format`, which is the same pair `ScoreBadge` and the
 * Backlinks headline card read. A score must never wear one colour on this
 * screen and another on the link-profile table beside it, so this file imports
 * the mapping rather than owning a copy of it.
 *
 * Three encodings of the same fact, so colour is never the only channel: the
 * arc's sweep, the printed number, and the band in words underneath.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { scoreBand } from "../../../shared/backlinks";
import { bandLabel, formatScore, scoreTextClass, scoreVariant } from "../backlinks/format";
import { EM_DASH } from "../domains/format";
import { Badge, Skeleton, cn } from "../ui";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * The dial's geometry, in viewBox units.
 *
 * The stroke straddles the radius, so the drawing reaches `RADIUS + STROKE / 2`
 * either side of the centre: 84 ± 74.5 horizontally and up to y 9.5 at the top.
 * That is what sets the 168 × 100 box, with the bottom strip left for the end
 * labels.
 */
const CENTER_X = 84;
const CENTER_Y = 84;
const RADIUS = 68;
const STROKE = 13;
const VIEW_BOX = "0 0 168 100";

/** Half a circle, which is the whole track. */
const ARC_LENGTH = Math.PI * RADIUS;

/** Left-to-right over the top: the upper semicircle, drawn clockwise. */
const ARC_PATH = `M ${CENTER_X - RADIUS} ${CENTER_Y} A ${RADIUS} ${RADIUS} 0 0 1 ${CENTER_X + RADIUS} ${CENTER_Y}`;

/** The scale, and it is fixed — a Domain Score is 0–100 by definition. */
export const GAUGE_MIN = 0;
export const GAUGE_MAX = 100;

/** One line, in the tooltip, because the question is always the same one. */
export const SCORE_HELP =
  "0 to 100, from the backlinks index. The same scale used across OpenRefs.";

/** The score as the dial can draw it: clamped into range, never NaN. */
function sweepValue(score: number | null | undefined): number | null {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null;
  }
  return Math.min(GAUGE_MAX, Math.max(GAUGE_MIN, score));
}

export function ScoreGauge({
  score,
  target,
  label = "Domain Score",
  loading = false,
  unavailableNote,
  badge,
  footer,
  className = "",
}: {
  /** 0–100, or null when the index has nothing for this target. */
  score: number | null | undefined;
  /** The domain being scored. Named in the accessible label. */
  target: string;
  /** "Domain Score" or "Page Score" — whichever scale this is. */
  label?: string;
  loading?: boolean;
  /**
   * Replaces the "no data" line under an unscored dial, for the case where the
   * lookup failed rather than came back empty.
   */
  unavailableNote?: string;
  /** Provenance slot, top right — the same place a MetricCard puts one. */
  badge?: ReactNode;
  /** Anything that belongs under the dial, e.g. a link into Backlinks. */
  footer?: ReactNode;
  className?: string;
}) {
  const value = sweepValue(score);
  const band = scoreBand(value);
  const reducedMotion = useReducedMotion();

  /*
   * The sweep animates from empty on mount, which is why it is state rather
   * than the prop read straight into the attribute: the first paint has to
   * happen at zero for the transition to have anything to move from.
   *
   * With reduced motion it starts at its final value, so nothing moves at all —
   * the global rule in theme.css would flatten the transition to 0.01ms anyway,
   * but starting there means there is never a frame of empty dial to catch.
   */
  const [swept, setSwept] = useState(reducedMotion ? (value ?? 0) : 0);

  useEffect(() => {
    setSwept(value ?? 0);
  }, [value]);

  const known = value !== null;
  const dashOffset = ARC_LENGTH * (1 - (known ? swept : 0) / GAUGE_MAX);

  const reading = known
    ? `${formatScore(value)} out of ${GAUGE_MAX} — ${bandLabel(band)}`
    : "not reported";

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground" title={SCORE_HELP}>
          {label}
        </p>
        {badge}
      </div>

      {loading ? (
        /*
         * The same footprint as the dial, to the pixel: an identically sized
         * block and one caption line. A skeleton that is merely "about right"
         * makes the whole metrics row jump when the score lands.
         */
        <div className="mt-3 flex flex-col items-center">
          <Skeleton className="aspect-[168/100] w-full max-w-[168px]" />
          <Skeleton className="mt-2 h-5 w-28" />
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center">
          <div
            className={cn(
              "w-full max-w-[168px]",
              known ? scoreTextClass(band) : "text-muted-foreground",
            )}
            {...(known
              ? {
                  role: "meter",
                  "aria-valuenow": Math.round(value),
                  "aria-valuemin": GAUGE_MIN,
                  "aria-valuemax": GAUGE_MAX,
                  "aria-valuetext": reading,
                }
              : { role: "img" })}
            aria-label={`${label} for ${target}: ${reading}`}
          >
            <svg viewBox={VIEW_BOX} className="w-full" aria-hidden="true">
              {/* The track. Always drawn, so an unscored dial is visibly a
                  dial with nothing in it rather than a blank card. */}
              <path
                d={ARC_PATH}
                fill="none"
                strokeWidth={STROKE}
                strokeLinecap="round"
                className="stroke-border"
              />
              {known ? (
                <path
                  d={ARC_PATH}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={ARC_LENGTH}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset] duration-700 ease-out"
                />
              ) : null}

              <text
                x={CENTER_X}
                y={76}
                textAnchor="middle"
                fill="currentColor"
                className="text-[34px] font-semibold tabular-nums"
              >
                {known ? formatScore(value) : EM_DASH}
              </text>

              {/* The ends of the scale, so the arc reads as 0–100 without a
                  legend. Muted: they are chrome, not data. */}
              <text
                x={CENTER_X - RADIUS}
                y={99}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px] tabular-nums"
              >
                {GAUGE_MIN}
              </text>
              <text
                x={CENTER_X + RADIUS}
                y={99}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px] tabular-nums"
              >
                {GAUGE_MAX}
              </text>
            </svg>
          </div>

          {known ? (
            <Badge
              variant={scoreVariant(band)}
              className="mt-2"
              title={`${label} ${formatScore(value)} of ${GAUGE_MAX} — ${bandLabel(band)}.`}
            >
              {bandLabel(band)}
            </Badge>
          ) : (
            <p className="mt-2 text-center text-xs leading-relaxed text-muted-foreground">
              {unavailableNote ??
                "The backlinks index has no data for this domain."}
            </p>
          )}
        </div>
      )}

      {footer}
    </div>
  );
}
