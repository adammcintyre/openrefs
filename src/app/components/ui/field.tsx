import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { useId } from "react";

import { cn } from "./cn";

const CONTROL_BASE =
  "w-full rounded-app border bg-surface px-3 text-sm text-foreground transition-colors " +
  "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60";

/** Invalid controls get a danger border, not just a red message below them. */
function borderFor(invalid: boolean | undefined): string {
  return invalid
    ? "border-danger"
    : "border-border hover:border-muted-foreground";
}

export function Label({
  className = "",
  children,
  ...rest
}: ComponentPropsWithRef<"label">) {
  return (
    <label
      className={cn("text-sm font-medium text-foreground", className)}
      {...rest}
    >
      {children}
    </label>
  );
}

/**
 * role="alert" so a validation message that appears after submit is announced
 * without the user having to move focus to find it.
 */
export function FieldError({
  className = "",
  children,
  ...rest
}: ComponentPropsWithRef<"p">) {
  if (!children) return null;
  return (
    <p role="alert" className={cn("text-sm text-danger", className)} {...rest}>
      {children}
    </p>
  );
}

export function Input({
  className = "",
  invalid,
  ...rest
}: ComponentPropsWithRef<"input"> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_BASE, "h-9", borderFor(invalid), className)}
      {...rest}
    />
  );
}

export function Select({
  className = "",
  invalid,
  children,
  ...rest
}: ComponentPropsWithRef<"select"> & { invalid?: boolean }) {
  return (
    /*
     * A native <select> — it inherits keyboard behaviour, mobile pickers and
     * screen-reader semantics for free. Only the chevron is ours, so
     * appearance-none strips the platform arrow and the wrapper re-adds one
     * that follows the theme.
     */
    <span className="relative block">
      <select
        aria-invalid={invalid || undefined}
        className={cn(
          CONTROL_BASE,
          "h-9 cursor-pointer appearance-none pr-9",
          borderFor(invalid),
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

/**
 * Wires label/control/error together so callers cannot forget the plumbing:
 * generates the id, points `aria-describedby` at the error, and flags
 * `invalid` on the control. Render-prop rather than cloneElement so the ids
 * are passed explicitly and stay visible at the call site.
 */
export function Field({
  label,
  error,
  hint,
  required,
  className = "",
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    invalid: boolean;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {children({ id, invalid: Boolean(error), "aria-describedby": describedBy })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
