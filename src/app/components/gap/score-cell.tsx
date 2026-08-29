/**
 * Domain Score in a table cell: 0–100, banded.
 *
 * The number and the band are both shown for the same reason the difficulty
 * badge shows both — the digits are what you compare between rows, the colour
 * is what you skim, and neither is the only carrier of the meaning.
 *
 * Unknown is a dash, never a zero. A site the provider has not measured and a
 * brand-new site with no links are different claims, and 0 is a real score.
 */
import type { ScoreBand } from "../../../shared/backlinks";
import { scoreBand } from "../../../shared/backlinks";
import { EM_DASH } from "../domains/format";
import type { BadgeVariant } from "../ui";
import { Badge } from "../ui";

const BAND_VARIANT: Record<ScoreBand, BadgeVariant> = {
  "very-high": "success",
  high: "brand",
  medium: "warning",
  low: "neutral",
};

const BAND_LABEL: Record<ScoreBand, string> = {
  "very-high": "very high",
  high: "high",
  medium: "medium",
  low: "low",
};

export function DomainScoreCell({
  score,
  /** True while the batch call is still out, so "unknown" reads as "not yet". */
  loading = false,
}: {
  score: number | null | undefined;
  loading?: boolean;
}) {
  const band = scoreBand(score);

  if (band === null || score === null || score === undefined) {
    return (
      <span
        className="text-muted-foreground"
        title={
          loading
            ? "Fetching Domain Score…"
            : "DataForSEO reported no Domain Score for this site."
        }
      >
        {EM_DASH}
      </span>
    );
  }

  return (
    <Badge
      variant={BAND_VARIANT[band]}
      title={`Domain Score ${Math.round(score)} of 100 — ${BAND_LABEL[band]}`}
    >
      <span className="tabular-nums">{Math.round(score)}</span>
    </Badge>
  );
}
