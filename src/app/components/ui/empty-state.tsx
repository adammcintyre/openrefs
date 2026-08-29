import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * The shared "nothing here yet" panel: no results, no data connected, no rows
 * matching a filter. `icon` takes the lucide component itself rather than a
 * rendered element so the size and colour stay under this component's control.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
