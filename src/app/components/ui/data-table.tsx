import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type { ColumnDef, RowData } from "@tanstack/react-table";

import { Button } from "./button";
import { cn } from "./cn";
import { EmptyState } from "./empty-state";
import { formatPageRange, pageRange } from "./pagination";
import { Skeleton } from "./skeleton";

/**
 * The feature set every OpenRefs table gets: client sorting and client
 * pagination, nothing else.
 *
 * v9 replaced v8's `getSortedRowModel()` / `getPaginationRowModel()` options
 * with this one static object, and it must live at module scope — rebuilding
 * it per render would reset table state on every keystroke elsewhere on the
 * page. The sortFns registry is required because v9's automatic sort-function
 * detection looks names up in it and warns when a string column finds nothing.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    text: sortFn_text,
    alphanumeric: sortFn_alphanumeric,
    datetime: sortFn_datetime,
  },
});

export type DataTableFeatures = typeof dataTableFeatures;

/** Column definition for a DataTable. Build these with the helper below. */
export type DataTableColumn<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData,
  // The per-column value type is deliberately widened: a heterogeneous column
  // array cannot keep each column's own TValue through a single array type.
  any
>;

/**
 * Column helper bound to this table's feature set.
 *
 * Call it once per row type at module scope:
 *   const col = createDataTableColumns<KeywordRow>();
 *   const columns = [col.accessor("keyword", { header: "Keyword" })];
 */
export function createDataTableColumns<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

export interface DataTableProps<TData extends RowData> {
  columns: Array<DataTableColumn<TData>>;
  data: ReadonlyArray<TData>;
  /** Swaps the body for skeleton rows without collapsing the layout. */
  loading?: boolean;
  pageSize?: number;
  /** Shown in place of the body when there are no rows and we are not loading. */
  emptyState?: ReactNode;
  /** Accessible name for the table. Always supply one. */
  caption: string;
  /** Visually show the caption above the table instead of only exposing it. */
  showCaption?: boolean;
  /** Max height of the scroll area; the header stays pinned while it scrolls. */
  maxHeight?: string;
  className?: string;
}

/*
 * Cells and headers render through the standalone `flexRender(def, context)`
 * rather than v9's newer `<table.FlexRender header={...} />` component form.
 *
 * The component form is what the v9 docs recommend, but rendering it here threw
 * "Invalid hook call ... Cannot read properties of null (reading 'useState')"
 * and React attributed the error to <DataTable>. `table.FlexRender` is a
 * property of the object `useTable` returns, so it is a fresh component type on
 * every render; React tears down and re-creates that subtree each pass, and the
 * hooks inside it end up running outside a live render. `flexRender` is a plain
 * function call with a stable identity and no such problem. Both are supported
 * exports, and this one is verified working.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  loading = false,
  pageSize = 25,
  emptyState,
  caption,
  showCaption = false,
  maxHeight = "32rem",
  className = "",
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });

  const { pageIndex } = table.state.pagination;
  const range = pageRange(pageIndex, pageSize, table.getRowCount());
  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const isEmpty = !loading && rows.length === 0;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-app border border-border bg-surface",
        className,
      )}
    >
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse text-sm">
          <caption
            className={cn(
              showCaption
                ? "px-4 py-3 text-left text-sm font-medium text-foreground"
                : "sr-only",
            )}
          >
            {caption}
          </caption>

          <thead className="sticky top-0 z-10 bg-surface-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const SortIcon =
                    sorted === "asc"
                      ? ChevronUp
                      : sorted === "desc"
                        ? ChevronDown
                        : ChevronsUpDown;

                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      scope="col"
                      // aria-sort belongs on the cell, not the button, so the
                      // state is announced when arrowing across the header row.
                      aria-sort={
                        !canSort
                          ? undefined
                          : sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                      }
                      className="border-b border-border px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-mx-1 inline-flex items-center gap-1 rounded-app px-1 py-0.5 transition-colors hover:text-foreground"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIcon
                            className={cn(
                              "size-3.5 shrink-0",
                              sorted ? "text-primary" : "opacity-50",
                            )}
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {loading
              ? Array.from({ length: Math.min(pageSize, 8) }, (_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`}>
                    {Array.from({ length: columnCount }, (__, cellIndex) => (
                      <td
                        key={`skeleton-${rowIndex}-${cellIndex}`}
                        className="border-b border-border px-4 py-3"
                      >
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={row.id}
                    className="transition-colors hover:bg-surface-muted"
                  >
                    {row.getAllCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="border-b border-border px-4 py-3 text-foreground"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}

            {isEmpty ? (
              <tr>
                <td colSpan={Math.max(1, columnCount)}>
                  {emptyState ?? (
                    <EmptyState
                      title="No rows"
                      description="Nothing matched. Try widening your filters."
                    />
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/*
        The pager stays mounted while loading so the control row does not
        appear and disappear under the pointer between fetches.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {loading ? "Loading…" : formatPageRange(range)}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {range.pageCount > 0
              ? `Page ${Math.min(pageIndex + 1, range.pageCount)} of ${range.pageCount}`
              : "Page 0 of 0"}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => table.previousPage()}
            disabled={loading || !table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => table.nextPage()}
            disabled={loading || !table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
