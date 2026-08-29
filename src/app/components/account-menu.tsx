import { useNavigate } from "react-router";

import { useLogout, useMe } from "../lib/session";

/**
 * The signed-in user's email plus sign-out, rendered into AppHeader's
 * `accountMenu` slot by the route tree. Lives outside components/ui because it
 * is session-aware — the design layer stays ignorant of auth.
 */
export function AccountMenu() {
  const navigate = useNavigate();
  const logout = useLogout();
  const me = useMe();

  return (
    <div className="flex items-center gap-3">
      <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">
        {me.data?.user.email}
      </span>
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() =>
          logout.mutate(undefined, {
            onSuccess: () => void navigate("/login", { replace: true }),
          })
        }
        className="rounded-app border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-muted disabled:opacity-60"
      >
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
