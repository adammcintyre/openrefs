/**
 * Inline treatment for the three failures a research screen actually hits.
 *
 * Two of them are not errors in the "something broke" sense — they are states
 * with a next step, and the next step is a link:
 *
 * - `no_credentials` (409): the workspace has no DataForSEO key yet. Nothing
 *   on this page can work until it does, so the panel *is* the CTA.
 * - `spend_cap_exceeded` (402): the key works and the workspace has chosen a
 *   ceiling it has now hit. Retrying is pointless; raising the cap is the move.
 *
 * Everything else keeps a Retry, because a 502 from DataForSEO usually does
 * succeed on a second attempt and the user should not have to retype a search
 * to get one.
 */
import { KeyRound, TriangleAlert, WalletMinimal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { ApiError, errorMessage } from "../../lib/api";
import { Button, cn } from "../ui";

type Tone = "info" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  info: "border-info-subtle bg-info-subtle text-info-on-subtle",
  warning: "border-warning-subtle bg-warning-subtle text-warning-on-subtle",
  danger: "border-danger-subtle bg-danger-subtle text-danger-on-subtle",
};

interface Presentation {
  tone: Tone;
  icon: LucideIcon;
  title: string;
  body: string;
  link?: { to: string; label: string };
  retryable: boolean;
}

/** Chooses the treatment. Exported for the tests that pin the mapping. */
export function presentError(error: unknown, fallback: string): Presentation {
  const code = error instanceof ApiError ? error.code : "unknown";

  if (code === "no_credentials") {
    return {
      tone: "info",
      icon: KeyRound,
      title: "Connect your DataForSEO account",
      body: "OpenRefs queries run on your own DataForSEO key. Add one for this workspace and the report will load.",
      link: { to: "/app/settings/data-provider", label: "Add credentials" },
      retryable: false,
    };
  }

  if (code === "spend_cap_exceeded") {
    return {
      tone: "warning",
      icon: WalletMinimal,
      title: "Monthly spend cap reached",
      body: "This workspace has spent its DataForSEO budget for the month. Cached results still load; new queries resume when the cap is raised or the month rolls over.",
      link: { to: "/app/settings", label: "Review spend cap" },
      retryable: false,
    };
  }

  return {
    tone: "danger",
    icon: TriangleAlert,
    title: "That query didn't come back",
    body: errorMessage(error, fallback),
    retryable: true,
  };
}

export function ApiErrorNotice({
  error,
  onRetry,
  fallback = "Something went wrong fetching this data.",
  className = "",
}: {
  error: unknown;
  onRetry?: () => void;
  fallback?: string;
  className?: string;
}) {
  if (error === null || error === undefined) return null;

  const { tone, icon: Icon, title, body, link, retryable } = presentError(
    error,
    fallback,
  );

  return (
    <div
      // Genuine failures interrupt; the two "you need to do a thing" states
      // wait their turn rather than talking over whatever else just loaded.
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-3 rounded-app border p-4 sm:flex-row sm:items-start",
        TONES[tone],
        className,
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm leading-relaxed">{body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {link ? (
          <Link
            to={link.to}
            className="inline-flex h-8 items-center rounded-app border border-current px-3 text-xs font-medium hover:underline"
          >
            {link.label}
          </Link>
        ) : null}
        {retryable && onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
