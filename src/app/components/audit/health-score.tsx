/**
 * The headline number: DataForSEO's OnPage score, 0–100.
 *
 * Called **Page Score** in the UI and nowhere near any other vendor's mark
 * (CLAUDE.md hard rule 2).
 *
 * The score is encoded three ways — the digits, the band word ("Good" / "Needs
 * work" / "Poor") and the colour — so it survives colour-blindness and a
 * greyscale print. The colour is never the only channel.
 */
import type { AuditComparison, AuditSummary } from "../../../shared/audits";
import { Badge, Card } from "../ui";
import {
  BAND_LABEL,
  BAND_TEXT_CLASS,
  DELTA_TONE_BADGE,
  deltaTone,
  formatScore,
  formatScoreDelta,
  scoreBand,
  scoreDelta,
} from "./format";

export function HealthScore({
  summary,
  previous,
}: {
  summary: AuditSummary;
  previous: AuditComparison | null;
}) {
  const band = scoreBand(summary.score);
  const delta = scoreDelta(summary.score, previous);
  /*
   * Score is up-is-good — the inverse of every issue count on this screen —
   * so the tone is read from the negated delta rather than from `deltaTone`
   * directly, which would paint a rising score red.
   */
  const tone = deltaTone(delta === null ? null : -delta);

  return (
    <Card className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Page Score</p>
        <p className="flex items-baseline gap-2">
          <span
            className={`text-5xl font-semibold tracking-tight tabular-nums ${BAND_TEXT_CLASS[band]}`}
          >
            {formatScore(summary.score)}
          </span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`font-medium ${BAND_TEXT_CLASS[band]}`}>
            {BAND_LABEL[band]}
          </span>
          {delta !== null ? (
            <Badge
              variant={DELTA_TONE_BADGE[tone]}
              title={`${formatScoreDelta(delta)} points against the previous audit.`}
            >
              {`${formatScoreDelta(delta)} vs previous`}
            </Badge>
          ) : null}
        </p>
      </div>

      {/*
        These three counts come from different parts of the crawl and are not
        arithmetic on each other. In a real 25-page audit of brandpacks.com,
        `pagesWithIssues` came back as 26 against 25 pages crawled — the issue
        sections count some resources the page total does not. Each carries its
        own explanation rather than being quietly reconciled into agreement,
        which would mean publishing a number DataForSEO never reported.
      */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Stat
          label="Pages crawled"
          value={summary.pagesCrawled}
          help={`Pages the crawler fetched, against a limit of ${summary.pagesLimit.toLocaleString("en")}.`}
        />
        <Stat
          label="Pages with issues"
          value={summary.pagesWithIssues}
          help="Distinct pages with at least one issue. Counted across the issue sections, so it need not match the crawled total exactly."
        />
        <Stat
          label="Issues found"
          value={summary.totalIssues}
          help="Every failing check on every page. One page failing three checks counts three times here."
        />
      </dl>
    </Card>
  );
}

function Stat({
  label,
  value,
  help,
}: {
  label: string;
  value: number;
  help: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground" title={help}>
        {label}
      </dt>
      <dd className="text-lg font-semibold tabular-nums text-foreground">
        {value.toLocaleString("en")}
        <span className="sr-only">{` — ${help}`}</span>
      </dd>
    </div>
  );
}
