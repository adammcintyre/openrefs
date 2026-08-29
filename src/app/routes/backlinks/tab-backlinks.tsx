/**
 * Backlinks — the individual links, or one example per referring domain.
 *
 * The mode toggle looks like a filter and is not one. `one_per_domain` groups
 * upstream, so the two modes are separate purchases with separate cache
 * entries, and the note under the toggle says so: a control that silently
 * spends is a control users learn to distrust. It defaults to grouped because a
 * raw link list is dominated by whichever site links a thousand times from its
 * footer, which answers a question nobody asked.
 *
 * The "Links from domain" column only exists in the grouped mode. Under `as_is`
 * the provider returns `group_count: 0` for every row — documented behaviour,
 * not missing data — and a column of zeroes reads as a claim rather than as an
 * absence.
 */
import { Link2Off } from "lucide-react";
import { useMemo, useState } from "react";

import type { BacklinkRow, BacklinksListMode } from "../../../shared/backlinks";
import { DofollowBadge, ScoreBadge } from "../../components/backlinks/badges";
import {
  formatAnchor,
  formatSeen,
} from "../../components/backlinks/format";
import {
  EM_DASH,
  aggregateMeta,
  formatCount,
  urlPath,
} from "../../components/domains/format";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  cn,
  createDataTableColumns,
} from "../../components/ui";
import { downloadCsv } from "../../lib/csv";
import { BACKLINK_CSV_HEADERS, backlinkCsvRows, csvFilename } from "./csv-rows";
import type { LinkFilterDraft, LinkFilters } from "./link-filters";
import {
  EMPTY_LINK_DRAFT,
  EMPTY_LINK_FILTERS,
  activeLinkFilterCount,
  isLinkDraftEmpty,
  parseLinkFilterDraft,
  toLinkFilterDraft,
} from "./link-filters";
import { PAGE_SIZE, useBacklinksList } from "./queries";
import { LoadMoreBar, TabShell } from "./tab-shell";

const col = createDataTableColumns<BacklinkRow>();

const MODES: Array<{ value: BacklinksListMode; label: string; hint: string }> = [
  {
    value: "one_per_domain",
    label: "One per domain",
    hint: "One representative link from each referring domain.",
  },
  {
    value: "as_is",
    label: "All links",
    hint: "Every individual link, including repeats from the same site.",
  },
];

/**
 * The linking page, over two lines: the domain is what you scan for, the path
 * is what tells two links from the same site apart. The full URL stays
 * reachable as the tooltip and the link target.
 */
function SourceCell({ row }: { row: BacklinkRow }) {
  const url = row.urlFrom;
  const domain = row.domainFrom;
  if (url === null || url === "") {
    return (
      <span className="font-medium text-foreground">{domain ?? EM_DASH}</span>
    );
  }
  const path = urlPath(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer nofollow"
      title={url}
      className="block max-w-[22rem] min-w-0"
    >
      <span className="block truncate font-medium text-primary hover:underline">
        {domain ?? url}
      </span>
      {path === "/" || path === EM_DASH ? null : (
        <span className="block truncate text-xs text-muted-foreground">
          {path}
        </span>
      )}
    </a>
  );
}

export function BacklinksTab({
  workspaceId,
  target,
  mode,
  onModeChange,
  filters,
  onFiltersChange,
}: {
  workspaceId: string | null;
  target: string;
  mode: BacklinksListMode;
  onModeChange: (mode: BacklinksListMode) => void;
  filters: LinkFilters;
  onFiltersChange: (filters: LinkFilters) => void;
}) {
  const [draft, setDraft] = useState<LinkFilterDraft>(() =>
    toLinkFilterDraft(filters),
  );

  const query = useBacklinksList(workspaceId, target, {
    mode,
    filters,
    enabled: true,
  });

  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const meta = useMemo(
    () => aggregateMeta(query.data?.pages ?? []),
    [query.data],
  );
  const total = query.data?.pages[0]?.totalCount ?? null;
  const filterCount = activeLinkFilterCount(filters);
  const grouped = mode === "one_per_domain";

  const columns = useMemo(
    () => [
      col.accessor((row) => row.urlFrom, {
        id: "source",
        header: "Source",
        sortFn: "text",
        cell: (info) => <SourceCell row={info.row.original} />,
      }),
      col.accessor((row) => row.pageScore, {
        id: "pageScore",
        header: "Page Score",
        sortFn: "alphanumeric",
        cell: (info) => (
          <ScoreBadge score={info.getValue()} label="Page Score" />
        ),
      }),
      col.accessor((row) => row.domainScore, {
        id: "domainScore",
        header: "Domain Score",
        sortFn: "alphanumeric",
        cell: (info) => (
          <ScoreBadge score={info.getValue()} label="Domain Score" />
        ),
      }),
      col.accessor((row) => row.anchor, {
        id: "anchor",
        header: "Anchor",
        sortFn: "text",
        cell: (info) => {
          const anchor = info.getValue();
          const text = formatAnchor(anchor);
          return (
            <span
              title={text}
              className={cn(
                "block max-w-[16rem] truncate",
                anchor === null || anchor.trim() === ""
                  ? "text-muted-foreground italic"
                  : "text-foreground",
              )}
            >
              {text}
            </span>
          );
        },
      }),
      col.accessor((row) => row.urlTo, {
        id: "urlTo",
        header: "Links to",
        sortFn: "text",
        cell: (info) => {
          const url = info.getValue();
          if (url === null || url === "") {
            return <span className="text-muted-foreground">{EM_DASH}</span>;
          }
          return (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title={url}
              className="block max-w-[14rem] truncate text-primary hover:underline"
            >
              {urlPath(url)}
            </a>
          );
        },
      }),
      col.accessor((row) => row.dofollow, {
        id: "dofollow",
        header: "Follow",
        sortFn: "alphanumeric",
        cell: (info) => <DofollowBadge dofollow={info.getValue()} />,
      }),
      col.accessor((row) => row.firstSeen, {
        id: "firstSeen",
        header: "First seen",
        // The provider's `yyyy-mm-dd hh-mm-ss +00:00` sorts correctly as text,
        // and sorting the raw value keeps the order right even though the cell
        // renders a friendlier date.
        sortFn: "text",
        cell: (info) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatSeen(info.getValue())}
          </span>
        ),
      }),
      ...(grouped
        ? [
            col.accessor((row) => row.groupCount, {
              id: "groupCount",
              header: "Links from domain",
              sortFn: "alphanumeric",
              cell: (info) => (
                <span className="tabular-nums">
                  {formatCount(info.getValue())}
                </span>
              ),
            }),
          ]
        : []),
    ],
    [grouped],
  );

  const applyDraft = () => onFiltersChange(parseLinkFilterDraft(draft));
  const clearDraft = () => {
    setDraft(EMPTY_LINK_DRAFT);
    onFiltersChange(EMPTY_LINK_FILTERS);
  };

  return (
    <TabShell
      heading={grouped ? "Backlinks by domain" : "All backlinks"}
      description={
        grouped
          ? "One link from each referring domain, strongest domains first."
          : "Every individual link pointing at this target, strongest linking domains first."
      }
      meta={meta}
      error={query.error}
      onRetry={() => void query.refetch()}
      onExport={() =>
        downloadCsv(
          csvFilename(grouped ? "backlinks-by-domain" : "backlinks", target),
          BACKLINK_CSV_HEADERS,
          backlinkCsvRows(rows),
        )
      }
      exportDisabled={rows.length === 0}
      controls={
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div
              role="group"
              aria-label="Link grouping"
              className="inline-flex rounded-app border border-border p-0.5"
            >
              {MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={mode === option.value}
                  title={option.hint}
                  onClick={() => onModeChange(option.value)}
                  className={cn(
                    "rounded-app px-3 py-1 text-xs font-medium transition-colors",
                    mode === option.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Grouping happens at DataForSEO — the first switch each way fetches
              fresh data and bills a call.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              applyDraft();
            }}
            className="rounded-app border border-border bg-surface-muted p-4"
          >
            <div className="flex items-center gap-2 pb-3">
              <p className="text-xs font-semibold text-foreground">Filters</p>
              {filterCount > 0 ? (
                <Badge variant="brand">{`${filterCount} active`}</Badge>
              ) : null}
            </div>

            <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Min Domain Score"
                hint="0–100, on the linking domain."
              >
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    max={100}
                    inputMode="numeric"
                    placeholder="Any"
                    value={draft.minDomainScore}
                    onChange={(event) =>
                      setDraft({ ...draft, minDomainScore: event.target.value })
                    }
                  />
                )}
              </Field>
              <Field label="Anchor contains" hint="Matches anywhere in the text.">
                {(field) => (
                  <Input
                    {...field}
                    value={draft.anchor}
                    placeholder="e.g. templates"
                    onChange={(event) =>
                      setDraft({ ...draft, anchor: event.target.value })
                    }
                  />
                )}
              </Field>
              <label className="flex items-center gap-2 pt-1 text-sm text-foreground sm:pt-7">
                <input
                  type="checkbox"
                  checked={draft.dofollowOnly}
                  onChange={(event) =>
                    setDraft({ ...draft, dofollowOnly: event.target.checked })
                  }
                  className="size-4 rounded-sm border-border accent-primary"
                />
                Dofollow links only
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" type="submit">
                Apply filters
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearDraft}
                disabled={filterCount === 0 && isLinkDraftEmpty(draft)}
              >
                Clear
              </Button>
              <p className="text-xs text-muted-foreground">
                Filters are applied by DataForSEO, so each change is a new query.
              </p>
            </div>
          </form>
        </div>
      }
      footer={
        <LoadMoreBar
          loaded={rows.length}
          total={total}
          hasMore={query.hasNextPage}
          isFetching={query.isFetchingNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          pageSize={PAGE_SIZE}
        />
      }
    >
      <DataTable
        caption={`Backlinks to ${target}`}
        columns={columns}
        data={rows}
        loading={query.isPending}
        emptyState={
          <EmptyState
            icon={Link2Off}
            title="No backlinks found"
            description={
              filterCount > 0
                ? "No links matched these filters. Try lowering the minimum Domain Score or clearing the anchor text."
                : "DataForSEO has no links on record pointing at this target."
            }
          />
        }
      />
    </TabShell>
  );
}
