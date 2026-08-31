/**
 * The strip of open research tabs.
 *
 * Presentational only — every rule about what opens, closes and evicts lives in
 * research-tabs.ts, where it can be tested without a DOM.
 *
 * Not a `role="tablist"`: the results area below already contains a real one
 * (Suggestions / Related / Ideas), and nesting two would leave a screen-reader
 * user arrowing between searches when they meant to arrow between lists. This
 * is a navigation strip whose current item is marked with `aria-current`, which
 * is what it actually behaves like.
 */
import { X } from "lucide-react";

import { cn } from "../../components/ui";
import type { ResearchTab } from "./research-tabs";

function marketLabel(tab: ResearchTab): string {
  return `location ${tab.locationCode} · ${tab.languageCode}`;
}

export function ResearchTabStrip({
  tabs,
  activeId,
  onActivate,
  onClose,
}: {
  tabs: ReadonlyArray<ResearchTab>;
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  if (tabs.length === 0) return null;

  return (
    <nav
      aria-label="Open searches"
      className="flex items-center gap-1 overflow-x-auto pb-1"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <span
            key={tab.id}
            className={cn(
              "inline-flex h-7 max-w-56 shrink-0 items-center gap-1 rounded-app border pl-2.5 pr-1 text-xs transition-colors",
              isActive
                ? "border-primary/40 bg-tint text-tint-foreground"
                : "border-border bg-surface text-muted-foreground hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <button
              type="button"
              onClick={() => onActivate(tab.id)}
              aria-current={isActive ? "true" : undefined}
              title={`${tab.keyword} — ${marketLabel(tab)}`}
              className="min-w-0 truncate font-medium"
            >
              {tab.keyword}
            </button>
            <button
              type="button"
              onClick={() => onClose(tab.id)}
              aria-label={`Close ${tab.keyword}`}
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-app transition-colors",
                isActive
                  ? "hover:bg-primary/15"
                  : "hover:bg-border hover:text-foreground",
              )}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </nav>
  );
}
