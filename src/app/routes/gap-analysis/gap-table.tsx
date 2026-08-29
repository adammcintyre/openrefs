/**
 * The gap table: one row per keyword, one column per domain in the comparison.
 *
 * The competitor columns are built from the requested set rather than from the
 * data, so a competitor that ranks for nothing on this page still gets its
 * column — an absent column would quietly read as "this rival was not part of
 * the comparison", which is a different and wrong claim.
 *
 * **A missing position is a dash, never a 0.** `position: null` from the API
 * means "does not rank in the results DataForSEO holds". Rendering that as zero
 * would invert the meaning of the entire screen: 0 sorts as the best possible
 * rank, and the whole point of `missing` mode is that the number is absent.
 */
import { FolderPlus } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

import type { GapKeywordRow } from "../../../shared/gap";
import { EM_DASH, formatCount, formatTraffic } from "../../components/domains/format";
import { DifficultyBadge } from "../../components/keywords/chips";
import {
  Button,
  DataTable,
  createDataTableColumns,
} from "../../components/ui";

const col = createDataTableColumns<GapKeywordRow>();

/**
 * A rank, or the fact that there isn't one.
 *
 * The title is doing real work: "—" is only obvious once you know the
 * convention, and this table is largely made of them.
 */
function PositionCell({ position }: { position: number | null }) {
  if (position === null) {
    return (
      <span
        className="text-muted-foreground"
        title="Does not rank for this keyword"
      >
        {EM_DASH}
      </span>
    );
  }
  return <span className="tabular-nums">{formatCount(position)}</span>;
}

/** Header checkbox: checked, unchecked, or partly — the third needs a ref. */
function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  disabled,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  // `indeterminate` is a DOM property with no HTML attribute, so it can only
  // be set imperatively.
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 accent-primary"
      checked={checked}
      disabled={disabled}
      aria-label={checked ? "Clear selection" : "Select all keywords on this page"}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function GapTable({
  rows,
  competitors,
  target,
  loading,
  caption,
  selected,
  onToggle,
  onToggleAll,
  onViewSerp,
  onAddToCollection,
  emptyState,
}: {
  rows: ReadonlyArray<GapKeywordRow>;
  /** The requested competitor domains, in column order. */
  competitors: ReadonlyArray<string>;
  target: string;
  loading: boolean;
  caption: string;
  selected: ReadonlySet<string>;
  onToggle: (keyword: string) => void;
  onToggleAll: (checked: boolean) => void;
  onViewSerp: (row: GapKeywordRow) => void;
  onAddToCollection: (rows: GapKeywordRow[]) => void;
  emptyState?: ReactNode;
}) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.keyword));
  const someSelected = rows.some((row) => selected.has(row.keyword));

  const columns = useMemo(
    () => [
      col.display({
        id: "select",
        enableSorting: false,
        header: () => (
          <SelectAllCheckbox
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            onChange={onToggleAll}
            disabled={rows.length === 0}
          />
        ),
        cell: (info) => {
          const { keyword } = info.row.original;
          return (
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={selected.has(keyword)}
              aria-label={`Select ${keyword}`}
              onChange={() => onToggle(keyword)}
            />
          );
        },
      }),
      col.accessor((row) => row.keyword, {
        id: "keyword",
        header: "Keyword",
        sortFn: "text",
        cell: (info) => (
          <span className="font-medium text-foreground">
            {info.getValue() ?? EM_DASH}
          </span>
        ),
      }),
      col.accessor((row) => row.searchVolume, {
        id: "searchVolume",
        header: "Volume",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatCount(info.getValue())}</span>
        ),
      }),
      col.accessor((row) => row.keywordDifficulty, {
        id: "difficulty",
        header: "Difficulty",
        sortFn: "alphanumeric",
        cell: (info) => <DifficultyBadge value={info.getValue()} />,
      }),
      col.accessor((row) => row.target.position, {
        id: "yourPosition",
        header: "You",
        sortFn: "alphanumeric",
        cell: (info) => <PositionCell position={info.getValue()} />,
      }),
      /*
       * One column per competitor, keyed by index into the row's own
       * `competitors` array — the API guarantees that array is in the order
       * the domains were requested, which is the order these headers are in.
       */
      ...competitors.map((domain, index) =>
        col.accessor((row) => row.competitors[index]?.position ?? null, {
          id: `competitor-${index}`,
          header: domain,
          sortFn: "alphanumeric",
          cell: (info) => <PositionCell position={info.getValue()} />,
        }),
      ),
      col.accessor((row) => row.bestCompetitorTraffic, {
        id: "bestCompetitorTraffic",
        header: "Best rival traffic",
        sortFn: "alphanumeric",
        cell: (info) => (
          <span className="tabular-nums">{formatTraffic(info.getValue())}</span>
        ),
      }),
      col.display({
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: (info) => {
          const row = info.row.original;
          if (row.keyword === "") return null;
          return (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => onViewSerp(row)}>
                View SERP
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title={`Add "${row.keyword}" to a collection`}
                aria-label={`Add ${row.keyword} to a collection`}
                onClick={() => onAddToCollection([row])}
              >
                <FolderPlus className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          );
        },
      }),
    ],
    [
      competitors,
      selected,
      rows.length,
      allSelected,
      someSelected,
      onToggle,
      onToggleAll,
      onViewSerp,
      onAddToCollection,
    ],
  );

  return (
    <DataTable
      caption={caption}
      columns={columns}
      data={rows}
      loading={loading}
      emptyState={emptyState}
      // Wide by nature — up to four competitor columns plus the fixed six.
      maxHeight="36rem"
      className={target === "" ? "opacity-50" : ""}
    />
  );
}
