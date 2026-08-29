/**
 * Geometry for the inline rank sparkline. No React, no SVG — string and number
 * in, coordinates out, so the part that is easy to get wrong is the part that
 * is easy to test.
 *
 * Three things make a rank sparkline different from a generic one:
 *
 * 1. **The y axis is inverted.** Position 1 is the best result on the page and
 *    100 is the worst, so the *smallest* value has to sit at the *top*. SVG's y
 *    already grows downward, which means mapping position straight to y — no
 *    `height - y` flip — is what draws an improving rank as a line that climbs.
 *    Getting this backwards produces a chart that is confidently upside down
 *    and still looks plausible, which is exactly why it is pinned by tests.
 *
 * 2. **The series is sparse.** Only days that were actually checked appear
 *    (see `RankPoint` in src/shared/tracking.ts). Points are therefore placed
 *    by *date*, not by array index: a week-long gap in checking has to read as
 *    a week-long gap, not as one step like every other pair.
 *
 * 3. **`position: null` is a measurement, not a hole.** It means "checked, and
 *    not in the top 100". There is no y coordinate that honestly represents
 *    that — drawing it at the bottom would invent a rank of 100 — so it breaks
 *    the line into separate segments instead.
 */

/** The subset of `RankPoint` this file needs. Structural, so it accepts one. */
export interface SparklineDatum {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  /** Null means "checked, and nowhere in the top 100". */
  position: number | null;
}

/** One placed point, carrying its source values for tooltips and labels. */
export interface PlottedPoint {
  x: number;
  y: number;
  date: string;
  position: number;
}

export interface SparklineGeometry {
  /**
   * Contiguous runs of ranked points, in order. A run of one is kept — a lone
   * measurement between two unranked days is still worth a dot.
   */
  segments: PlottedPoint[][];
  /** Every ranked point, flattened. Empty when nothing has ever ranked. */
  points: PlottedPoint[];
  /** The newest ranked point, for the end-cap dot. Null when there is none. */
  last: PlottedPoint | null;
  /** Best and worst positions actually plotted, for an accessible summary. */
  bestPosition: number | null;
  worstPosition: number | null;
}

export interface SparklineBox {
  width: number;
  height: number;
  /**
   * Inset on every side, in px. The stroke is centred on the path, so without
   * this the top and bottom points are clipped in half by the viewBox.
   */
  padding?: number;
}

/** Parses `YYYY-MM-DD` as UTC midnight. NaN for anything unparseable. */
function dayValue(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * Maps a value onto a pixel range, collapsing a degenerate domain to the
 * middle of the range.
 *
 * Centring rather than pinning to an edge is deliberate: a keyword that has
 * held position 4 all month has min === max, and a flat line drawn along the
 * very top of the box reads as "at the ceiling" when it means "unchanged".
 */
function scale(
  value: number,
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): number {
  if (domainMax === domainMin) return (rangeMin + rangeMax) / 2;
  const t = (value - domainMin) / (domainMax - domainMin);
  return rangeMin + t * (rangeMax - rangeMin);
}

/**
 * Places a sparse rank series inside a box.
 *
 * The x domain spans every point in the series, unranked ones included: those
 * are days that were genuinely checked, and dropping them would silently
 * compress the timeline whenever a keyword fell out of the top 100. The y
 * domain covers only the ranked points, because they are the only ones with a
 * position to plot.
 */
export function sparklineGeometry(
  series: ReadonlyArray<SparklineDatum>,
  box: SparklineBox,
): SparklineGeometry {
  const padding = box.padding ?? 2;
  const left = padding;
  const right = Math.max(padding, box.width - padding);
  const top = padding;
  const bottom = Math.max(padding, box.height - padding);

  const dated = series.filter((point) => Number.isFinite(dayValue(point.date)));
  const empty: SparklineGeometry = {
    segments: [],
    points: [],
    last: null,
    bestPosition: null,
    worstPosition: null,
  };
  if (dated.length === 0) return empty;

  const days = dated.map((point) => dayValue(point.date));
  const dayMin = Math.min(...days);
  const dayMax = Math.max(...days);

  const positions = dated
    .map((point) => point.position)
    .filter((position): position is number => position !== null);
  if (positions.length === 0) return empty;

  const bestPosition = Math.min(...positions);
  const worstPosition = Math.max(...positions);

  const segments: PlottedPoint[][] = [];
  let current: PlottedPoint[] = [];

  for (const [index, point] of dated.entries()) {
    if (point.position === null) {
      // A measured "not in the top 100" ends the run rather than joining it.
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }

    current.push({
      x: scale(days[index] ?? dayMin, dayMin, dayMax, left, right),
      // No flip: position grows downward and so does SVG y, so the best
      // position lands at the top. See the file header.
      y: scale(point.position, bestPosition, worstPosition, top, bottom),
      date: point.date,
      position: point.position,
    });
  }
  if (current.length > 0) segments.push(current);

  const points = segments.flat();
  return {
    segments,
    points,
    last: points.at(-1) ?? null,
    bestPosition,
    worstPosition,
  };
}

/** An SVG `points` attribute for one segment. */
export function toPolylinePoints(segment: ReadonlyArray<PlottedPoint>): string {
  return segment
    .map((point) => `${round(point.x)},${round(point.y)}`)
    .join(" ");
}

/** Two decimals is well below a device pixel and keeps the markup readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
