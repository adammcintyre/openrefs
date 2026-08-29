import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import { AuthCard, Field } from "../components/auth-card";
import { errorMessage } from "../lib/api";
import { useLogin, useMe } from "../lib/session";

interface RedirectState {
  from?: { pathname?: string };
}

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const login = useLogin();
  const [localError, setLocalError] = useState<string | null>(null);

  // Where the guard bounced them from, so a deep link survives signing in.
  const destination =
    (location.state as RedirectState | null)?.from?.pathname ?? "/app";

  if (me.data != null) return <Navigate to="/app" replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (email === "" || password === "") {
      setLocalError("Enter your email and password.");
      return;
    }
    setLocalError(null);

    login.mutate(
      { email, password },
      { onSuccess: () => void navigate(destination, { replace: true }) },
    );
  };

  const message =
    localError ??
    (login.error === null
      ? null
      : errorMessage(login.error, "Could not sign you in."));

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back."
      footer={
        <>
          No account?{" "}
          <Link to="/register" className="text-primary hover:underline">
            Create one
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
          autoComplete="current-password"
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
          disabled={login.isPending}
          className="w-full rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}
