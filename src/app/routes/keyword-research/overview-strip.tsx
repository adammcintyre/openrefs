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
import { RefreshCw } from "lucide-react";

import {
  ApiErrorNotice,
  useApiErrorToast,
} from "../../components/keywords/api-error-notice";
import {
  CostChip,
  StaleChip,
  UpdatedChip,
} from "../../components/keywords/chips";
import {
  EM_DASH,
  difficultyBand,
  formatCost,
  formatCpc,
  formatIntent,
  formatMonthLabel,
  formatPercent,
  formatVolume,
  sortMonthlyPoints,
} from "../../components/keywords/format";
import type { MarketSelection } from "../../components/keywords/market";
import {
  useKeywordOverview,
  useRefreshKeywordSearch,
} from "../../components/keywords/queries";
import { TrendLineChart } from "../../components/charts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  useToast,
} from "../../components/ui";
import type { KeywordCacheMode } from "./research-tabs";
import type { KeywordTabId } from "./search-params";
import { TAB_LABELS } from "./search-params";

export function KeywordOverviewStrip({
  workspaceId,
  keyword,
  market,
  tab,
  cacheMode = "auto",
  onRefreshed,
}: {
  workspaceId: string | null;
  keyword: string;
  market: MarketSelection;
  /** The list tab a Refresh should re-fetch alongside the overview. */
  tab: KeywordTabId;
  cacheMode?: KeywordCacheMode;
  /** Called after a successful refresh, so the tab can leave "stale" behind. */
  onRefreshed?: () => void;
}) {
  const query = useKeywordOverview(workspaceId, keyword, market, cacheMode);
  useApiErrorToast(query.error, "Could not load the keyword overview");

  const { toast } = useToast();
  const refresh = useRefreshKeywordSearch(workspaceId, keyword, market, tab);
  useApiErrorToast(refresh.error, "Could not refresh this keyword");

  const data = query.data;
  const loading = query.isPending;

  /*
   * One press, one billed pass. The button is disabled while the pair is in
   * flight so an impatient second click cannot buy a second one, and it stays
   * disabled until the overview has loaded at all — refreshing something that
   * has never been fetched is just a slower, dearer search.
   */
  function onRefresh() {
    refresh.mutate(undefined, {
      onSuccess: (result) => {
        onRefreshed?.();
        toast({
          title: "Refreshed from DataForSEO",
          description: `${TAB_LABELS[tab]} and the overview cost ${formatCost(result.costUsd)}.`,
          tone: "success",
        });
      },
    });
  }

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

  /*
   * Volume, CPC and difficulty all null together is Google's ads data
   * declining the keyword, not a thin result: adult and otherwise-restricted
   * terms are excluded from Ads data at the source (verified live — e.g.
   * "vibrators" answers in ~2s with every metric null). Saying so matters,
   * because the generic wording reads like an outage on a keyword the user
   * knows is huge.
   */
  const adsDataDeclined =
    data !== undefined &&
    data.searchVolume === null &&
    data.cpc === null &&
    data.keywordDifficulty === null;

  return (
    <section className="flex flex-col gap-4" aria-label="Keyword overview">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Overview</h2>

        {/* One provenance chip, not two: "cached · may be outdated" already
            says it came from the cache, so the plain Cached chip stands down. */}
        {data?.stale === true ? (
          <StaleChip stale />
        ) : (
          <CostChip meta={data} />
        )}
        <UpdatedChip fetchedAt={data?.fetchedAt} />

        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          onClick={onRefresh}
          loading={refresh.isPending}
          disabled={data === undefined}
          title={`Fetches this keyword and the ${TAB_LABELS[tab].toLowerCase()} list live from DataForSEO, and bills your account for both.`}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Refresh
        </Button>
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
              {adsDataDeclined
                ? "Google's ads data excludes this keyword — adult and other " +
                  "restricted terms carry no volume, CPC or difficulty at the " +
                  "source, however popular they are. Suggestions and the SERP " +
                  "still work for it."
                : "DataForSEO reported no monthly history for this keyword " +
                  "in this market."}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
