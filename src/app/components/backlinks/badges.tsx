/**
 * The badges the link-profile tables repeat on every row.
 *
 * All of them follow the same rule: colour is a second channel, never the only
 * one. The score badge always prints its number, the follow badge always prints
 * its word, the spam badge prints both, so the tables survive greyscale,
 * colour-blindness, and a screenshot pasted into a document that re-renders it
 * in someone else's palette.
 */
import { scoreBand } from "../../../shared/backlinks";
import { Badge, cn } from "../ui";
import type { BadgeVariant } from "../ui";
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

/**
 * DataForSEO's own 0–100 spam estimate for one link or domain.
 *
 * **Not one of our metrics, and graded the opposite way round.** Domain Score
 * and Page Score are ours and high is good; this number is the provider's and
 * high is bad, which is exactly the confusion a shared colour ramp would
 * create. So it gets its own three-step grading, and the tooltip names the
 * source rather than letting it read as an OpenRefs judgement:
 *
 *  - **≤ 30** is the ordinary web. Muted, because most links live here and a
 *    warning colour on every row teaches people to ignore the column.
 *  - **31–60** is worth a look.
 *  - **> 60** is the bulk-comment and link-farm tier.
 *
 * `null` is "the provider did not score this link", which is not a claim that
 * it is clean — it renders as an em dash like every other unreported value.
 */
export function SpamBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return (
      <span
        className="text-muted-foreground"
        title="DataForSEO did not report a spam score for this row."
      >
        {EM_DASH}
      </span>
    );
  }

  const value = Math.round(score);
  const { variant, label } = spamGrade(value);

  return (
    <Badge
      variant={variant}
      className="tabular-nums"
      title={`DataForSEO spam score ${value} of 100 — ${label}. Their estimate, not an OpenRefs metric.`}
    >
      {value}
    </Badge>
  );
}

/** The three bands above, as a variant and a plain-English name. */
export function spamGrade(score: number): {
  variant: BadgeVariant;
  label: string;
} {
  if (score > 60) return { variant: "danger", label: "high spam signals" };
  if (score > 30) return { variant: "warning", label: "some spam signals" };
  return { variant: "neutral", label: "low spam signals" };
}

/**
 * What kind of link this is: `anchor`, `image`, `redirect`, `canonical`,
 * `alternate` or `meta`.
 *
 * The open set is deliberate — it is the provider's, and it is the answer to
 * "why does this link have no anchor text?" (it is an image, or a redirect).
 * Anything unrecognised is printed as it arrived rather than mapped to
 * "unknown", so a new provider type shows up as odd text instead of vanishing.
 */
export function LinkTypeBadge({ itemType }: { itemType: string | null | undefined }) {
  if (itemType === null || itemType === undefined || itemType.trim() === "") {
    return (
      <span
        className="text-muted-foreground"
        title="DataForSEO did not report a link type for this row."
      >
        {EM_DASH}
      </span>
    );
  }

  const type = itemType.trim().toLowerCase();
  return (
    <Badge variant="neutral" title={LINK_TYPE_TITLES[type] ?? `Link type: ${type}.`}>
      {type}
    </Badge>
  );
}

/**
 * What each provider link type actually means.
 *
 * There is no `iframe` here because there is no iframe in the provider's index:
 * the Backlinks API's `item_type` is only ever one of these six.
 */
const LINK_TYPE_TITLES: Record<string, string> = {
  anchor: "An ordinary text link.",
  image: "An image links here, so there is no anchor text to report.",
  redirect: "A redirect points here rather than a link on a page.",
  canonical: "A rel=canonical tag points here.",
  alternate: "A rel=alternate tag points here — usually a language or mobile variant.",
  meta: "A meta refresh points here.",
};
