import type { ComponentPropsWithRef } from "react";

import { cn } from "./cn";

/**
 * Loading placeholder. aria-hidden because the pulsing block carries no
 * information — the surrounding region should own the `aria-busy` /
 * `aria-live` announcement instead of every individual bar shouting.
 *
 * The pulse is a CSS animation, so the global prefers-reduced-motion rule in
 * theme.css already flattens it to a static block.
 */
export function Skeleton({
  className = "",
  ...rest
}: ComponentPropsWithRef<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-app bg-surface-muted",
        className,
      )}
      {...rest}
    />
  );
}
