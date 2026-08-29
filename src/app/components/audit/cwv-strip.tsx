/**
 * Core Web Vitals for the homepage, from one Lighthouse run.
 *
 * Homepage-only in v1 because Lighthouse is priced per run and one run costs
 * more than an entire 25-page crawl. The strip says so rather than letting the
 * reader assume these numbers describe the whole site.
 *
 * **Three states, and the middle one is the interesting one.**
 *
 *  - Scores present: four banded tiles.
 *  - `lighthouse: null` immediately after the crawl finishes: *normal*. The
 *    Lighthouse task is posted alongside the crawl and lands a little later, so
 *    the audit can be `done` with the CWV strip still in flight. Showing
 *    "unavailable" here would be wrong roughly every time. The strip waits out
 *    a grace period (`useLighthouseGrace` re-asks once) before it gives up.
 *  - `lighthouse: null` after the grace period: unavailable, with the Worker's
 *    own `lighthouseNote` as the reason. The crawl is the audit; losing this
 *    strip must not look like losing the other sixteen categories.
 */
import { Gauge, Loader } from "lucide-react";

import type { AuditSummary } from "../../../shared/audits";
import { Card } from "../ui";
import type { Band } from "./format";
import {
  BAND_CLASS,
  BAND_LABEL,
  clsBand,
  formatCls,
  formatMs,
  formatScore,
  interactionMetric,
  lcpBand,
  performanceBand,
} from "./format";

export function CoreWebVitalsStrip({
  summary,
  awaitingLighthouse,
}: {
  summary: AuditSummary;
  /** True while the strip is still inside its grace period — see the header. */
  awaitingLighthouse: boolean;
}) {
  const { lighthouse } = summary;

  if (lighthouse === null) {
    return awaitingLighthouse ? (
      <PendingCard />
    ) : (
      <UnavailableCard note={summary.lighthouseNote} />
    );
  }

  const interaction = interactionMetric(lighthouse);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="cwv-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="cwv-heading"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Core Web Vitals
        </h2>
        <p className="text-xs text-muted-foreground">
          {`Lighthouse, ${lighthouse.mobile ? "mobile" : "desktop"} — homepage only (${lighthouse.url})`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <VitalTile
          label="LCP"
          name="Largest Contentful Paint"
          value={formatMs(lighthouse.lcpMs)}
          band={lcpBand(lighthouse.lcpMs)}
          note="How long the biggest thing above the fold takes to appear. Good is 2.5s or less."
        />
        <VitalTile
          label="CLS"
          name="Cumulative Layout Shift"
          value={formatCls(lighthouse.cls)}
          band={clsBand(lighthouse.cls)}
          note="How much the page jumps around while it loads. Good is 0.10 or less."
        />
        <VitalTile
          label={interaction.label}
          name={interaction.kind === "inp" ? "Interaction to Next Paint" : "Total Blocking Time"}
          value={formatMs(interaction.ms)}
          band={interaction.band}
          note={interaction.note}
        />
        <VitalTile
          label="Performance"
          name="Lighthouse performance score"
          value={formatScore(lighthouse.performance)}
          band={performanceBand(lighthouse.performance)}
          note="Lighthouse's own 0–100 roll-up of the loading metrics. Good is 90 or above."
        />
      </div>
    </section>
  );
}

/**
 * One metric.
 *
 * The band appears as a word as well as a colour, and the explanation is real
 * text rather than a `title` alone — a tooltip is invisible to touch and to
 * most screen-reader modes, and "LCP 4.2s" means nothing without it.
 */
function VitalTile({
  label,
  name,
  value,
  band,
  note,
}: {
  label: string;
  name: string;
  value: string;
  band: Band;
  note: string;
}) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground" title={name}>
          {label}
        </p>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${BAND_CLASS[band]}`}
        >
          {BAND_LABEL[band]}
        </span>
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        <span className="sr-only">{`${name}: `}</span>
        {value}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
    </Card>
  );
}

function PendingCard() {
  return (
    <Card className="flex flex-col gap-2 p-5" role="status">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Loader className="size-4 animate-spin" aria-hidden="true" />
        Core Web Vitals still arriving
      </p>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        The crawl has finished. Lighthouse runs separately against the homepage
        and usually lands within a minute of it — this panel fills itself in.
      </p>
    </Card>
  );
}

function UnavailableCard({ note }: { note: string | null }) {
  return (
    <Card className="flex flex-col gap-2 p-5" role="status">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
        Core Web Vitals unavailable
      </p>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {note ??
          "Lighthouse did not return a result for this audit's homepage."}{" "}
        Everything else on this page is unaffected — the crawl is the audit, and
        it completed.
      </p>
    </Card>
  );
}
