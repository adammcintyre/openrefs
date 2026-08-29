import type { ReactNode } from "react";

import { cn } from "./cn";

/**
 * Top-of-page title block. Every /app screen starts with one so the h1 lands
 * in a predictable place for screen readers and the actions column sits at a
 * consistent optical height across modules.
 */
export function PageHeader({
  title,
  description,
  actions,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot: buttons, filters, an export menu. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
