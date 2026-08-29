import type { FormEvent } from "react";
import { Link } from "react-router";

import { AuthCard, Field } from "../components/auth-card";

/**
 * TODO(auth): form shell only — this screen has no logic.
 *
 * The auth agent owns it. Expected behaviour: POST /api/v1/auth/register with
 * { email, password }, which creates the user, their first workspace and an
 * owner membership in one transaction, then signs them in. Password rules and
 * the PBKDF2 work factor live server-side, not here.
 */
export function Register() {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // No network call yet.
    event.preventDefault();
  };

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
      <form onSubmit={onSubmit} className="space-y-4">
        <Field id="email" label="Email" type="email" autoComplete="email" />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
        />
        <button
          type="submit"
          className="w-full rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Create account
        </button>
        <p className="text-xs text-muted-foreground">
          Not wired up yet — registration lands in Phase 0.
        </p>
      </form>
    </AuthCard>
  );
}
