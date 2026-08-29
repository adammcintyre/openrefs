/**
 * Countries — where in the world this domain has a presence.
 *
 * The only tab that does not fetch on open. One request here fans out to about
 * ten `domain_rank_overview` calls, roughly ten times what every other tab
 * costs, so it waits behind a button that names the price. After the fact the
 * chip next to the heading reports what it actually came to, which is the
 * other half of the same promise.
 */
import { Globe } from "lucide-react";
import { useMemo } from "react";

import type { DomainCountryRow } from "../../../shared/domains";
import {
  formatCount,
  formatTraffic,
} from "../../components/domains/format";
import { SimpleBarChart, formatCompact } from "../../components/charts";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Skeleton,
  createDataTableColumns,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { COUNTRY_CSV_HEADERS, countryCsvRows, csvFilename } from "./csv-rows";
import { useDomainCountries } from "./queries";
import { TabShell } from "./tab-shell";
import type { DomainSearch } from "./url-state";

/** Ten markets at roughly a cent each — see COUNTRY_BREAKDOWN_MARKETS. */
export const COUNTRIES_COST_HINT = "≈ $0.10";

const col = createDataTableColumns<DomainCountryRow>();

export function CountriesTab({
  workspaceId,
  search,
  requested,
  onRequest,
}: {
  workspaceId: string | null;
  search: DomainSearch;
  /** True once the user has accepted the cost for *this* domain and language. */
  requested: boolean;
  onRequest: () => void;
}) {
  const query = useDomainCountries(workspaceId, search, requested);
  const rows = query.data?.items ?? [];

  const columns = useMemo(
    () => [
      col.accessor((row) => row.countryName, {
        id: "country",
        header: "Market",
        sortFn: "text",
        cell: (info) => (
          <span className="font-medium text-foreground">
            {info.getValue()}{" "}
            <span className="font-normal text-muted-foreground">
              ({info.row.original.countryIsoCode})
            </span>
          </span>
        ),
      }),
      col.accessor((row) => row.languageCode, {
        id: "language",
        header: "Queried in",
        sortFn: "text",
        cell: (info) => {
          const language = info.getValue();
          // A market that does not support the page's language was queried in
          // its own — saying so is the difference between "no presence here"
          // and "we asked a different question here".
          const substituted = language !== search.language;
          return substituted ? (
            <Badge
              variant="warning"
              title={`This market does not support "${search.language}", so it was queried in "${language}".`}
            >
              {language}
            </Badge>
          ) : (
            <span className="text-muted-foreground">{language}</span>
          );
        },
      }),
      col.accessor((row) => row.organic.traffic, {
        id: "organicTraffic",
        header: "Est. organic traffic",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatTraffic(info.getValue())}</span>
        ),
      }),
      col.accessor((row) => row.organic.keywordCount, {
        id: "organicKeywords",
        header: "Organic keywords",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatCount(info.getValue())}</span>
        ),
      }),
      col.accessor((row) => row.paid.traffic, {
        id: "paidTraffic",
        header: "Est. paid traffic",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatTraffic(info.getValue())}</span>
        ),
      }),
    ],
    [search.language],
  );

  /*
   * Markets with no reported traffic are left out of the chart rather than
   * drawn as a zero bar: "not reported" and "measured as none" are different
   * claims, and a bar chart cannot say the first one. The table below still
   * lists them, with an em dash.
   */
  const chartData = useMemo(
    () =>
      rows
        .filter((row) => row.organic.traffic !== null)
        .map((row) => ({
          market: row.countryIsoCode,
          traffic: Math.round(row.organic.traffic ?? 0),
        })),
    [rows],
  );

  if (!requested) {
    return (
      <Card>
        <EmptyState
          icon={Globe}
          title="Country breakdown"
          description={`Checks ${search.target} across ten major markets — the US, UK, Germany, France, Spain, Italy, Australia, Canada, the Netherlands and India. That is about ten DataForSEO calls, so it runs only when you ask.`}
          action={
            <Button onClick={onRequest}>
              Analyze countries · {COUNTRIES_COST_HINT}
            </Button>
          }
        />
      </Card>
    );
  }

  const failed = query.data?.failedCountries ?? [];

  return (
    <TabShell
      heading="Country breakdown"
      description="Estimated organic traffic per market, biggest first. Each market is queried in a language it supports."
      meta={query.data}
      error={query.error}
      onRetry={() => void query.refetch()}
      onExport={() =>
        downloadCsv(
          csvFilename("countries", search),
          COUNTRY_CSV_HEADERS,
          countryCsvRows(rows),
        )
      }
      exportDisabled={rows.length === 0}
    >
      <div className="flex flex-col gap-4">
        {failed.length > 0 ? (
          <p
            role="status"
            className="rounded-app border border-warning-subtle bg-warning-subtle px-4 py-2.5 text-sm text-warning-on-subtle"
          >
            {failed.length} of {query.data?.requestedCount ?? 10} markets did not
            respond ({failed.join(", ")}). The rest are shown below, and you were
            only charged for those.
          </p>
        ) : null}

        <Card className="p-5">
          {query.isPending ? (
            <Skeleton className="h-[240px] w-full" />
          ) : chartData.length === 0 ? (
            <EmptyState
              title="No traffic reported"
              description="None of the ten markets reported estimated organic traffic for this domain."
            />
          ) : (
            <SimpleBarChart
              data={chartData}
              xKey="market"
              dataKey="traffic"
              name="Est. organic traffic"
              valueFormatter={formatCompact}
            />
          )}
        </Card>

        <DataTable
          caption={`Country breakdown for ${search.target}`}
          columns={columns}
          data={rows}
          loading={query.isPending}
          pageSize={10}
          emptyState={
            <EmptyState
              icon={Globe}
              title="No markets returned data"
              description="DataForSEO reported nothing for this domain in any of the ten markets."
            />
          }
        />
      </div>
    </TabShell>
  );
}
