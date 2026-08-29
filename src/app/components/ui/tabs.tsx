import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef, useState } from "react";

import { cn } from "./cn";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

/**
 * WAI-ARIA tab pattern.
 *
 * Roving tabindex: only the selected tab is in the tab order, so Tab moves
 * past the whole strip into the panel rather than through every tab. Arrow
 * keys move between tabs and select as they go (automatic activation), which
 * is the correct choice here because switching panels is cheap and local —
 * there is no request behind it.
 *
 * Works controlled (`value` + `onValueChange`) or uncontrolled.
 */
export function Tabs({
  tabs,
  value,
  defaultValue,
  onValueChange,
  className = "",
}: {
  tabs: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  className?: string;
}) {
  const baseId = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [internal, setInternal] = useState(
    () => defaultValue ?? tabs[0]?.id ?? "",
  );

  const selected = value ?? internal;
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0];

  function select(id: string) {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const enabled = tabs.filter((tab) => !tab.disabled);
    const current = enabled.findIndex((tab) => tab.id === selected);
    if (current === -1) return;

    let next: number | null = null;
    if (event.key === "ArrowRight") next = (current + 1) % enabled.length;
    else if (event.key === "ArrowLeft")
      next = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    if (next === null) return;

    const target = enabled[next];
    if (!target) return;
    event.preventDefault();
    select(target.id);
    buttons.current.get(target.id)?.focus();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((tab) => {
          const isSelected = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) buttons.current.set(tab.id, node);
                else buttons.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-controls={`${baseId}-panel-${tab.id}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => select(tab.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isSelected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) =>
        tab.id === active?.id ? (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-panel-${tab.id}`}
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            tabIndex={0}
            className="pt-4"
          >
            {tab.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
