import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import type { ResetPasswordBody, ResetPasswordResponse } from "../../shared/auth";
import { AuthCard, Field } from "../components/auth-card";
import { useToast } from "../components/ui";
import { ApiError, api, errorMessage, fieldErrors } from "../lib/api";
import { meKey } from "../lib/session";

/** Mirrors `passwordSchema` in src/shared/auth.ts — the server still decides. */
const MIN_PASSWORD_LENGTH = 10;

/**
 * `/reset/:token` — choose a new password.
 *
 * The token rides in the path because it arrives as a link in an email, but it
 * is only ever *sent* in a POST body, and there is no endpoint that inspects
 * one without spending it. Nothing about the account — not even whether the
 * link is for a real one — is on this page before the form is submitted.
 *
 * Success does not sign anyone in: the server has just deleted every session
 * for the account, including any this browser was holding, so the honest next
 * step is proving the new password on /login.
 */
export function ResetPassword() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = useMutation({
    mutationFn: (body: ResetPasswordBody) =>
      api.post<ResetPasswordResponse>("/auth/reset", body),
    onSuccess: () => {
      // Every session for this account is gone, this browser's included.
      queryClient.setQueryData(meKey, null);
      toast({
        tone: "success",
        title: "Password changed",
        description: "Sign in with your new password.",
      });
      void navigate("/login", { replace: true });
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(
        `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
      );
      return;
    }
    if (password !== confirm) {
      setLocalError("Those passwords do not match.");
      return;
    }
    setLocalError(null);
    reset.mutate({ token: token ?? "", password });
  };

  const deadLink = (
    <AuthCard
      title="This link has expired"
      subtitle="Reset links work once, and for one hour."
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Ask for a fresh one and it will arrive in a moment.
        </p>
        <Link
          to="/forgot"
          className="block w-full rounded-app bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Send a new link
        </Link>
      </div>
    </AuthCard>
  );

  // A link that lost its token in transit is as dead as an expired one, and
  // the fix is identical, so it gets the same page rather than its own.
  if (token === undefined || token === "") return deadLink;

  if (reset.error instanceof ApiError && reset.error.code === "reset_invalid") {
    return deadLink;
  }

  const fields = fieldErrors(reset.error);
  const message =
    localError ??
    (reset.error === null
      ? null
      : (fields.password?.[0] ??
        errorMessage(reset.error, "Could not change your password.")));

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="This signs you out on every other device."
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>
        <Field
          id="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
        />

        {message !== null && (
          <p
            role="alert"
            className="rounded-app border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={reset.isPending}
          className="w-full rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {reset.isPending ? "Saving…" : "Change password"}
        </button>
      </form>
    </AuthCard>
  );
}
