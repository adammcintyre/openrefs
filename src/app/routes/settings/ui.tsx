/**
 * Local styling helpers for the settings screens.
 *
 * Deliberately scoped to this folder rather than src/app/components: the shared
 * design primitives are being built in parallel, and these should be replaced
 * by them rather than competing with them. Plain Tailwind on the Lush Forest
 * tokens, no new CSS.
 */
import type { ReactNode } from "react";

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-app border border-border bg-surface p-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description !== undefined && (
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function TextField({
  id,
  label,
  hint,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password" | "email" | "number";
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-app border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60"
      />
      {hint !== undefined && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger";

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover border-transparent",
  secondary:
    "bg-surface text-foreground hover:bg-surface-muted border-border",
  danger: "bg-red-600 text-white hover:bg-red-700 border-transparent",
};

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: ButtonVariant;
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-app border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${BUTTON_CLASSES[variant]}`}
    >
      {children}
    </button>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  const classes = {
    error:
      "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
    success: "border-border bg-tint text-tint-foreground",
    info: "border-border bg-surface-muted text-muted-foreground",
  }[tone];

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-app border px-3 py-2 text-sm ${classes}`}
    >
      {children}
    </p>
  );
}

/** Empty state for a page that needs a workspace before it can show anything. */
export function NoWorkspace() {
  return (
    <Section title="No workspace">
      <p className="text-sm text-muted-foreground">
        Create a workspace from the switcher in the header to get started.
      </p>
    </Section>
  );
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Copy-to-clipboard that reports whether it worked. The API is unavailable in
 * insecure contexts and can be denied, so callers must handle false.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
