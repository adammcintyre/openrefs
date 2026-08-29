import type { FormEvent } from "react";
import { Link } from "react-router";

import { AuthCard, Field } from "../components/auth-card";

/**
 * TODO(auth): form shell only — this screen has no logic.
 *
 * The auth agent owns it. Expected behaviour: POST /api/v1/auth/login with
 * { email, password }, let the Worker set the httpOnly session cookie, then
 * navigate to /app. Surface `unauthorized` from the error body as a generic
 * "wrong email or password" so the form cannot be used to enumerate accounts.
 */
export function Login() {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // No network call yet. Prevents a native GET navigation in the meantime.
    event.preventDefault();
  };

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
      <form onSubmit={onSubmit} className="space-y-4">
        <Field id="email" label="Email" type="email" autoComplete="email" />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <button
          type="submit"
          className="w-full rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Sign in
        </button>
        <p className="text-xs text-muted-foreground">
          Not wired up yet — authentication lands in Phase 0.
        </p>
      </form>
    </AuthCard>
  );
}
