/**
 * A router link that looks like a Button.
 *
 * The `Button` primitive renders a `<button>` and offers no `asChild` escape
 * hatch, so wrapping a `<Link>` in one would nest an anchor inside a button —
 * invalid HTML, and a control screen readers and browsers both mis-handle.
 * The alternative, a `<button onClick={navigate}>`, costs middle-click,
 * "open in new tab" and the status-bar URL preview on something that is
 * visibly a link to another page.
 *
 * So: a real anchor, wearing the Button primitive's own token classes. The
 * duplication is deliberate and bounded — if Button's variants change, these
 * two constants are the one place to follow.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "../ui";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-app font-medium " +
  "whitespace-nowrap transition-colors";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-muted",
  ghost: "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
} as const;

const SIZES = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
} as const;

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  to: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
    >
      {children}
    </Link>
  );
}

/**
 * The same styling for a plain `href` — a server endpoint rather than a route.
 *
 * Used for the collection CSV export, which has to be a real navigation so the
 * browser honours `content-disposition: attachment` and saves the file instead
 * of the SPA router swallowing the click.
 */
export function AnchorButton({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: {
  href: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
  children: ReactNode;
} & Omit<React.ComponentPropsWithoutRef<"a">, "href" | "className" | "children">) {
  return (
    <a
      href={href}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {children}
    </a>
  );
}
