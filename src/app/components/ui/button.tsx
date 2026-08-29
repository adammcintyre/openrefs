import { LoaderCircle } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-muted",
  ghost: "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
  danger: "bg-danger text-danger-contrast hover:bg-danger-hover",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-4 text-sm",
};

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and swaps in a spinner. */
  loading?: boolean;
  children?: ReactNode;
}

/**
 * The focus ring comes from the global :focus-visible rule in theme.css, which
 * draws an outline 2px *outside* the box. That matters for the primary and
 * danger variants: an inset ring in --ring would sit on a fill of nearly the
 * same colour and vanish.
 *
 * While loading the label stays put and only a spinner is added, so the button
 * does not resize under the pointer mid-click. Reduced-motion users get a
 * static glyph, but `disabled` + `aria-busy` still convey the state.
 */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-app font-medium whitespace-nowrap transition-colors",
        "disabled:pointer-events-none disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle
          className="size-4 shrink-0 animate-spin"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </button>
  );
}
