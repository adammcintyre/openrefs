import { ArrowRight, KeyRound } from "lucide-react";

import { TrendLineChart } from "../components/charts";
import { Badge } from "../components/ui/badge";
import { Card, CardDescription, CardTitle } from "../components/ui/card";
import { MetricCard } from "../components/ui/metric-card";
import { PageHeader } from "../components/ui/page-header";
import { DATAFORSEO_SIGNUP_URL } from "../lib/constants";

/**
 * Every number on this screen is invented. Each one is badged "Sample" in the
 * UI rather than only noted here — a plausible unlabelled figure on a
 * dashboard is indistinguishable from a real one.
 */
const SAMPLE_TRAFFIC = [
  { month: "Sep", site: 12400, competitor: 18100 },
  { month: "Oct", site: 13150, competitor: 18400 },
  { month: "Nov", site: 12980, competitor: 19250 },
  { month: "Dec", site: 14320, competitor: 19010 },
  { month: "Jan", site: 15870, competitor: 19680 },
  { month: "Feb", site: 16240, competitor: 20130 },
  { month: "Mar", site: 17910, competitor: 20040 },
  { month: "Apr", site: 18630, competitor: 21120 },
  { month: "May", site: 19480, competitor: 21390 },
  { month: "Jun", site: 21050, competitor: 21770 },
  { month: "Jul", site: 22380, competitor: 21940 },
  { month: "Aug", site: 23610, competitor: 22180 },
];

const TRAFFIC_SERIES = [
  { dataKey: "site", name: "Your site" },
  { dataKey: "competitor", name: "Tracked competitor" },
];

function SampleBadge() {
  return <Badge variant="warning">Sample</Badge>;
}

export function Dashboard() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Dashboard"
        description="Workspace activity, recent research and spend at a glance."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Tracked keywords"
          value="128"
          badge={<SampleBadge />}
          delta={{ value: 12, label: "+12", caption: "vs. last month" }}
        />
        <MetricCard
          label="Average position"
          value="14.2"
          badge={<SampleBadge />}
          // Falling rank numbers are an improvement, so the polarity inverts.
          polarity="down-is-good"
          delta={{ value: -1.8, label: "−1.8", caption: "vs. last month" }}
        />
        <MetricCard
          label="Referring domains"
          value="1,284"
          badge={<SampleBadge />}
          delta={{ value: 38, label: "+38", caption: "last 30 days" }}
        />
        <MetricCard
          label="API spend"
          value="$3.42"
          badge={<SampleBadge />}
          polarity="down-is-good"
          delta={{ value: 0.61, label: "+$0.61", caption: "this month" }}
        />
      </div>

      <Card className="mt-6 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Estimated organic traffic</CardTitle>
            <CardDescription>
              Monthly organic sessions against one tracked competitor.
            </CardDescription>
          </div>
          <SampleBadge />
        </div>
        <TrendLineChart
          data={SAMPLE_TRAFFIC}
          xKey="month"
          series={TRAFFIC_SERIES}
          height={300}
        />
      </Card>

      {/* The one thing a new workspace actually has to do. */}
      <Card className="mt-6 border-primary/40 bg-tint p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface">
            <KeyRound className="size-5 text-primary" aria-hidden="true" />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h2 className="text-base font-semibold tracking-tight text-tint-foreground">
              Connect your DataForSEO key
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-tint-foreground/90">
              OpenRefs has no data of its own — it queries DataForSEO with{" "}
              <strong className="font-semibold">your</strong> account, so you
              buy API credits directly at cost and we never mark them up or
              resell them. Nothing above is real until a key is saved: every
              figure on this page is sample data.
            </p>
            <p className="text-sm leading-relaxed text-tint-foreground/90">
              Your credentials are encrypted before they are stored, and a
              per-workspace spend cap stops runaway queries.
            </p>

            <div className="mt-1 flex flex-wrap items-center gap-4">
              <a
                href="/app/settings"
                className="inline-flex items-center gap-1.5 rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                Add your key in Settings
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <a
                href={DATAFORSEO_SIGNUP_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm font-medium text-tint-foreground underline underline-offset-4 hover:no-underline"
              >
                Get a DataForSEO account
              </a>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
