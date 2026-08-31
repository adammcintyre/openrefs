import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import type { ForgotPasswordBody } from "../../shared/auth";
import { AuthCard, Field } from "../components/auth-card";
import { api, errorMessage } from "../lib/api";

/**
 * `/forgot` — ask for a password-reset link.
 *
 * The confirmation below is deliberately incurious: it says the same thing for
 * an address that has an account, one that does not, and one that has asked
 * three times in the last minute. The endpoint answers 202 to all three for
 * that reason, and a page that reported "no account with that address" would
 * hand back the enumeration oracle the API just refused to be.
 *
 * The mutation lives here rather than in lib/session.ts because nothing else
 * in the SPA needs it — there is no cached session state to invalidate, since
 * asking for a link changes nothing about who you are signed in as.
 */
export function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: (body: ForgotPasswordBody) =>
      api.post<void>("/auth/forgot", body),
    onSuccess: () => setSubmitted(true),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();

    if (email === "") {
      setLocalError("Enter your email address.");
      return;
    }
    setLocalError(null);
    request.mutate({ email });
  };

  const backToSignIn = (
    <Link to="/login" className="text-primary hover:underline">
      Back to sign in
    </Link>
  );

  if (submitted) {
    return (
      <AuthCard
        title="Check your email"
        subtitle="If that address has an OpenRefs account, we have sent it a reset link."
        footer={backToSignIn}
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            The link works once, and stops working an hour after it was sent.
          </p>
          <p>
            Nothing arrived? Check your spam folder, then{" "}
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="text-primary underline hover:no-underline"
            >
              try another address
            </button>
            .
          </p>
        </div>
      </AuthCard>
    );
  }

  // Only a genuine transport failure surfaces here; the endpoint itself
  // succeeds whoever the address belongs to.
  const message =
    localError ??
    (request.error === null
      ? null
      : errorMessage(request.error, "Could not send a reset link. Try again."));

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We will email you a link to choose a new one."
      footer={backToSignIn}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="email" label="Email" type="email" autoComplete="email" />

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
          disabled={request.isPending}
          className="w-full rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {request.isPending ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  );
}
