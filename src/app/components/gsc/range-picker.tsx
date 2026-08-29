/**
 * The 28 days / 3 months / 6 months control.
 *
 * A segmented radio group rather than a `<select>`: there are three options,
 * they are always the same three, and the current window is something you want
 * to be able to read without opening anything. Implemented as real radio inputs
 * so arrow keys move between them and a screen reader announces "28 days,
 * selected, 1 of 3" — a row of buttons with `aria-pressed` would announce three
 * unrelated toggles instead.
 */
import { CalendarRange } from "lucide-react";
import { useId } from "react";

import { cn } from "../ui";
import type { GscRangeId } from "./range";
import { GSC_RANGE_PRESETS } from "./range";

export function GscRangePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: GscRangeId;
  onChange: (next: GscRangeId) => void;
  disabled?: boolean;
}) {
  const name = useId();

  return (
    <fieldset
      className="flex items-center gap-2"
      disabled={disabled}
      // The visible icon plus this label; the legend would otherwise be the
      // only description and legends are easy to lose in a header row.
      aria-label="Date range"
    >
      <legend className="sr-only">Date range</legend>
      <CalendarRange
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="flex rounded-app border border-border bg-surface p-0.5">
        {GSC_RANGE_PRESETS.map((preset) => {
          const selected = preset.id === value;
          return (
            <label
              key={preset.id}
              title={preset.description}
              className={cn(
                "cursor-pointer rounded-app px-2.5 py-1 text-xs font-medium transition-colors",
                // The focus ring is drawn on the label, because the input
                // itself is visually hidden and its own ring would be too.
                "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring)]",
                selected
                  ? "bg-tint text-tint-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={preset.id}
                checked={selected}
                onChange={() => onChange(preset.id)}
                className="sr-only"
              />
              {preset.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
