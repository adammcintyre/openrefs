import type { ReactNode } from "react";
import { Link } from "react-router";

import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

/** Centred card used by both auth screens. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-6">
        <Link to="/" className="text-lg">
          <Wordmark />
        </Link>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10">
        <div className="w-full max-w-sm rounded-app border border-border bg-surface p-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-6">{children}</div>
          <div className="mt-6 text-sm text-muted-foreground">{footer}</div>
        </div>
      </main>
    </div>
  );
}

export function Field({
  id,
  label,
  type,
  autoComplete,
}: {
  id: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        className="w-full rounded-app border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
      />
    </div>
  );
}
