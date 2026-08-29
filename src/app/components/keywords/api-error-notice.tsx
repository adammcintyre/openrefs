/**
 * How a failed research request reaches the user.
 *
 * Two failures are not really errors — they are configuration the user can
 * fix, and both get an inline panel with the fix one click away rather than a
 * toast that disappears:
 *
 *   no_credentials (409)      no DataForSEO key on this workspace yet
 *   spend_cap_exceeded (402)  the monthly cap did its job
 *
 * Everything else is an actual fault and gets a retry affordance, plus a toast
 * from `useApiErrorToast` when it happened underneath something the user was
 * already looking at.
 */
import { CircleAlert, KeyRound, WalletMinimal } from "lucide-react";
import { useEffect, useRef } from "react";

import { ApiError, errorMessage } from "../../lib/api";
import { Button, Card, EmptyState, useToast } from "../ui";
import { LinkButton } from "./link-button";

/** The settings screens the two configuration errors point at. */
const DATA_PROVIDER_PATH = "/app/settings/data-provider";
const GENERAL_SETTINGS_PATH = "/app/settings";

export function isCredentialsError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "no_credentials";
}

export function isSpendCapError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "spend_cap_exceeded";
}

/** True for the two "fix it in settings" cases, which suppress the toast. */
export function isConfigurationError(error: unknown): boolean {
  return isCredentialsError(error) || isSpendCapError(error);
}

export function ApiErrorNotice({
  error,
  onRetry,
  className = "",
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  if (error === null || error === undefined) return null;

  if (isCredentialsError(error)) {
    return (
      <Card className={className}>
        <EmptyState
          icon={KeyRound}
          title="Connect your DataForSEO account"
          description="Keyword data comes from your own DataForSEO key. Add it once and every research tool in OpenRefs starts working."
          action={
            <LinkButton to={DATA_PROVIDER_PATH}>Add API credentials</LinkButton>
          }
        />
      </Card>
    );
  }

  if (isSpendCapError(error)) {
    return (
      <Card className={className}>
        <EmptyState
          icon={WalletMinimal}
          title="Monthly spend cap reached"
          description="This workspace has hit the DataForSEO spend cap for this calendar month. Cached results still work; new lookups resume next month, or as soon as you raise the cap."
          action={
            <LinkButton to={GENERAL_SETTINGS_PATH} variant="secondary">
              Review spend cap
            </LinkButton>
          }
        />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <EmptyState
        icon={CircleAlert}
        title="That lookup failed"
        description={errorMessage(error, "Something went wrong reaching the API.")}
        action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined}
      />
    </Card>
  );
}

/**
 * Toasts a genuine fault once.
 *
 * Guarded on the error identity rather than fired in render: a query error is
 * a stable object across re-renders, so without the ref a single failure would
 * raise a toast on every keystroke elsewhere on the page. Configuration errors
 * are skipped — they already have a panel, and duplicating them as a toast
 * reads as two separate problems.
 */
export function useApiErrorToast(error: unknown, title: string): void {
  const { toast } = useToast();
  const reported = useRef<unknown>(null);

  useEffect(() => {
    if (error === null || error === undefined) {
      reported.current = null;
      return;
    }
    if (isConfigurationError(error)) return;
    if (reported.current === error) return;

    reported.current = error;
    toast({
      title,
      description: errorMessage(error, "Please try again."),
      tone: "error",
    });
  }, [error, title, toast]);
}
