/**
 * The headline metrics for the searched keyword, plus twelve months of volume.
 *
 * This is the expensive call in the module: it fans out to three DataForSEO
 * endpoints (Google Ads volume, Labs difficulty, Labs intent) and costs around
 * $0.114 uncached. The cost chip beside the heading says so — that number is a
 * deliberate product decision, not something to bury, because the user is
 * spending from their own DataForSEO account and deserves to see the price of
 * a search before they run fifty of them.
 */
import {
  ApiErrorNotice,
  useApiErrorToast,
} from "../../components/keywords/api-error-notice";
import { CostChip } from "../../components/keywords/chips";
import {
  EM_DASH,
  difficultyBand,
  formatCpc,
  formatIntent,
  formatMonthLabel,
  formatPercent,
  formatVolume,
  sortMonthlyPoints,
} from "../../components/keywords/format";
import type { MarketSelection } from "../../components/keywords/market";
import { useKeywordOverview } from "../../components/keywords/queries";
import { TrendLineChart } from "../../components/charts";
import { Badge, Card, CardContent, CardHeader, CardTitle, MetricCard } from "../../components/ui";

export function KeywordOverviewStrip({
  workspaceId,
  keyword,
  market,
}: {
  workspaceId: string | null;
  keyword: string;
  market: MarketSelection;
}) {
  const query = useKeywordOverview(workspaceId, keyword, market);
  useApiErrorToast(query.error, "Could not load the keyword overview");

  const data = query.data;
  const loading = query.isPending;

  if (query.isError) {
    return <ApiErrorNotice error={query.error} onRetry={() => void query.refetch()} />;
  }

  const band = difficultyBand(data?.keywordDifficulty);

  // Sorted oldest-first before charting: the wire order is newest-first, which
  // would draw the year backwards. See sortMonthlyPoints for the detail.
  const chartData = sortMonthlyPoints(data?.monthlySearches ?? []).map((point) => ({
    period: formatMonthLabel(point.period),
    volume: point.searchVolume,
  }));

  // A chart of twelve nulls is worse than no chart: it implies zero traffic.
  const hasHistory = chartData.some((point) => point.volume !== null);

  return (
    <section className="flex flex-col gap-4" aria-label="Keyword overview">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Overview</h2>
        <CostChip meta={data} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Search volume"
          value={formatVolume(data?.searchVolume)}
          loading={loading}
        />
        <MetricCard
          label="Difficulty"
          value={
            data?.keywordDifficulty === null || data?.keywordDifficulty === undefined
              ? EM_DASH
              : Math.round(data.keywordDifficulty)
          }
          badge={
            data?.keywordDifficulty === null || data?.keywordDifficulty === undefined
              ? undefined
              : <Badge variant={band.variant}>{band.label}</Badge>
          }
          loading={loading}
        />
        <MetricCard
          label="Cost per click"
          value={formatCpc(data?.cpc)}
          loading={loading}
        />
        <MetricCard
          label="Search intent"
          value={formatIntent(data?.intent)}
          badge={
            data?.intentProbability === null || data?.intentProbability === undefined
              ? undefined
              : (
                <Badge variant="neutral">
                  {`${formatPercent(data.intentProbability)} confident`}
                </Badge>
              )
          }
          loading={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search volume, last 12 months</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TrendLineChart data={[]} xKey="period" series={[]} height={240} />
          ) : hasHistory ? (
            <TrendLineChart
              data={chartData}
              xKey="period"
              series={[{ dataKey: "volume", name: "Search volume" }]}
              height={240}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              DataForSEO reported no monthly history for this keyword in this
              market.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
