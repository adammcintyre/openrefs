/**
 * The two badges the link-profile tables repeat on every row.
 *
 * Both follow the same rule: colour is a second channel, never the only one.
 * The score badge always prints its number, the follow badge always prints its
 * word, so the tables survive greyscale, colour-blindness, and a screenshot
 * pasted into a document that re-renders it in someone else's palette.
 */
import { scoreBand } from "../../../shared/backlinks";
import { Badge, cn } from "../ui";
import { EM_DASH } from "../domains/format";
import { bandLabel, formatScore, scoreVariant } from "./format";

/**
 * A 0–100 Domain Score or Page Score.
 *
 * `label` names which one it is, so the tooltip and the accessible name are
 * unambiguous in a table that shows both. The value is already normalised by
 * the Worker — nothing here scales it.
 */
export function ScoreBadge({
  score,
  label,
  className = "",
}: {
  score: number | null | undefined;
  /** "Domain Score" or "Page Score". */
  label: string;
  className?: string;
}) {
  const band = scoreBand(score);
  const text = formatScore(score);

  if (text === EM_DASH) {
    return (
      <span
        className={className}
        title={`${label} not reported for this row.`}
        aria-label={`${label} not reported`}
      >
        {EM_DASH}
      </span>
    );
  }

  return (
    <Badge
      variant={scoreVariant(band)}
      className={cn("tabular-nums", className)}
      title={`${label} ${text} of 100 — ${bandLabel(band)}.`}
    >
      {text}
    </Badge>
  );
}

/**
 * Whether one link passes authority.
 *
 * Three states, not two. `null` is "the provider did not say", which is not the
 * same claim as nofollow — treating it as one would quietly under-count a
 * profile's dofollow links, and this column is exactly where someone would go
 * looking for that number.
 */
export function DofollowBadge({ dofollow }: { dofollow: boolean | null | undefined }) {
  if (dofollow === null || dofollow === undefined) {
    return (
      <span
        className="text-muted-foreground"
        title="DataForSEO did not report a link attribute for this link."
      >
        {EM_DASH}
      </span>
    );
  }

  return dofollow ? (
    <Badge variant="success" title="Passes authority to the target.">
      Dofollow
    </Badge>
  ) : (
    <Badge variant="neutral" title="Marked nofollow, sponsored or ugc.">
      Nofollow
    </Badge>
  );
}
