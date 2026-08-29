/**
 * The filter row above a keyword table.
 *
 * Filters the rows already loaded rather than re-querying — see filters.ts for
 * why that is the right trade in a tool where every fetch is billed. The
 * result count is shown next to the controls so it is obvious that filtering
 * narrowed the table rather than the data source running dry.
 */
import { X } from "lucide-react";

import { Button, Input, Label } from "../ui";
import { EMPTY_FILTERS, isFilterActive } from "./filters";
import type { KeywordFilterState } from "./filters";
import { formatVolume } from "./format";

/** One labelled control. Compact, but never a bare placeholder-as-label. */
function FilterField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  max,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        inputMode={type === "number" ? "numeric" : undefined}
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function KeywordFilterRow({
  filters,
  onChange,
  shownCount,
  loadedCount,
}: {
  filters: KeywordFilterState;
  onChange: (next: KeywordFilterState) => void;
  /** Rows after filtering. */
  shownCount: number;
  /** Rows fetched so far. */
  loadedCount: number;
}) {
  const active = isFilterActive(filters);
  const set = (patch: Partial<KeywordFilterState>) =>
    onChange({ ...filters, ...patch });

  return (
    <fieldset className="flex flex-col gap-3 rounded-app border border-border bg-surface-muted p-4">
      <legend className="sr-only">Filter keywords</legend>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <FilterField
          id="filter-min-volume"
          label="Min volume"
          type="number"
          min={0}
          placeholder="0"
          value={filters.minVolume}
          onChange={(minVolume) => set({ minVolume })}
        />
        <FilterField
          id="filter-max-volume"
          label="Max volume"
          type="number"
          min={0}
          placeholder="Any"
          value={filters.maxVolume}
          onChange={(maxVolume) => set({ maxVolume })}
        />
        <FilterField
          id="filter-min-difficulty"
          label="Min difficulty"
          type="number"
          min={0}
          max={100}
          placeholder="0"
          value={filters.minDifficulty}
          onChange={(minDifficulty) => set({ minDifficulty })}
        />
        <FilterField
          id="filter-max-difficulty"
          label="Max difficulty"
          type="number"
          min={0}
          max={100}
          placeholder="100"
          value={filters.maxDifficulty}
          onChange={(maxDifficulty) => set({ maxDifficulty })}
        />
        <FilterField
          id="filter-include"
          label="Includes"
          placeholder="e.g. best"
          value={filters.include}
          onChange={(include) => set({ include })}
        />
        <FilterField
          id="filter-exclude"
          label="Excludes"
          placeholder="e.g. free"
          value={filters.exclude}
          onChange={(exclude) => set({ exclude })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Polite live region: the count changes as the user types, and should
            be available to a screen reader without stealing focus. */}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {active
            ? `Showing ${formatVolume(shownCount)} of ${formatVolume(loadedCount)} loaded keywords`
            : `${formatVolume(loadedCount)} keywords loaded`}
        </p>
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(EMPTY_FILTERS)}
          >
            <X className="size-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
