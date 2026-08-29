import type { ComponentPropsWithRef } from "react";

import { cn } from "./cn";

export type BadgeVariant =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info";

/**
 * Each variant pairs a *-subtle background with its matching *-on-subtle text.
 * The tokens are defined as a pair in theme.css precisely so a badge can never
 * be assembled from a background and a foreground that were never measured
 * against each other; every pair here clears 4.5:1 in both themes.
 */
const VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-surface-muted text-muted-foreground",
  brand: "bg-tint text-tint-foreground",
  success: "bg-success-subtle text-success-on-subtle",
  warning: "bg-warning-subtle text-warning-on-subtle",
  danger: "bg-danger-subtle text-danger-on-subtle",
  info: "bg-info-subtle text-info-on-subtle",
};

export function Badge({
  variant = "neutral",
  className = "",
  ...rest
}: ComponentPropsWithRef<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}
