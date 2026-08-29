import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";

import { AuthCard, Field } from "../components/auth-card";
import { errorMessage, fieldErrors } from "../lib/api";
import { useMe, useRegister } from "../lib/session";

/** Mirrors `passwordSchema` in src/shared/auth.ts — the server still decides. */
const MIN_PASSWORD_LENGTH = 10;

export function Register() {
  const navigate = useNavigate();
  const me = useMe();
  const register = useRegister();
  const [localError, setLocalError] = useState<string | null>(null);

  if (me.data != null) return <Navigate to="/app" replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (email === "") {
      setLocalError("Enter your email address.");
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(
        `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
      );
      return;
    }
    setLocalError(null);

    register.mutate(
      { email, password },
      { onSuccess: () => void navigate("/app", { replace: true }) },
    );
  };

  // A 422 names the field that failed; anything else gets the plain message.
  const fields = fieldErrors(register.error);
  const serverMessage =
    register.error === null
      ? null
      : (fields.email?.[0] ??
        fields.password?.[0] ??
        errorMessage(register.error, "Could not create your account."));
  const message = localError ?? serverMessage;

  return (
    <AuthCard
      title="Create an account"
      subtitle="You will need a DataForSEO key to pull data."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="email" label="Email" type="email" autoComplete="email" />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>

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
          disabled={register.isPending}
          className="w-full rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {register.isPending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}
