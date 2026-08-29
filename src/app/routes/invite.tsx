import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { AuthCard } from "../components/auth-card";
import { errorMessage } from "../lib/api";
import { useMe } from "../lib/session";
import { useAcceptInvite } from "../lib/workspaces";

/**
 * `/invite/:token` — the landing page for an invite link.
 *
 * The token is only ever sent in a POST body, never appended to a URL we
 * navigate to, and there is no endpoint that reads an invite without redeeming
 * it: nothing about a workspace is disclosed before someone signs in and
 * accepts.
 */
export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const me = useMe();
  const accept = useAcceptInvite();
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);

  const returnPath = `/invite/${token ?? ""}`;

  if (me.isPending) {
    return (
      <AuthCard title="Invitation" subtitle="Checking your session…" footer={null}>
        <p className="text-sm text-muted-foreground">One moment.</p>
      </AuthCard>
    );
  }

  if (token === undefined || token === "") {
    return (
      <AuthCard
        title="Invalid link"
        subtitle="That invite link is missing its token."
        footer={
          <Link to="/" className="text-primary hover:underline">
            Back to OpenRefs
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Ask whoever invited you to send a fresh link.
        </p>
      </AuthCard>
    );
  }

  // Signed out: bounce through auth and come straight back here.
  if (me.data == null) {
    return (
      <AuthCard
        title="You have been invited"
        subtitle="Sign in or create an account to join the workspace."
        footer={
          <Link to="/" className="text-primary hover:underline">
            What is OpenRefs?
          </Link>
        }
      >
        <div className="space-y-3">
          <Link
            to="/login"
            state={{ from: { pathname: returnPath } }}
            className="block w-full rounded-app bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Sign in
          </Link>
          <Link
            to="/register"
            state={{ from: { pathname: returnPath } }}
            className="block w-full rounded-app border border-border bg-surface px-4 py-2 text-center text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            Create an account
          </Link>
          <p className="text-xs text-muted-foreground">
            Invite links expire seven days after they are created.
          </p>
        </div>
      </AuthCard>
    );
  }

  if (workspaceName !== null) {
    return (
      <AuthCard
        title="You're in"
        subtitle={`You have joined ${workspaceName}.`}
        footer={null}
      >
        <Link
          to="/app"
          className="block w-full rounded-app bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Go to OpenRefs
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Accept invitation"
      subtitle={`Signed in as ${me.data.user.email}.`}
      footer={
        <Link to="/app" className="text-primary hover:underline">
          Skip for now
        </Link>
      }
    >
      <div className="space-y-4">
        {accept.error !== null && (
          <p
            role="alert"
            className="rounded-app border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {errorMessage(accept.error, "Could not accept this invitation.")}
          </p>
        )}

        <button
          type="button"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(token, {
              onSuccess: (workspace) => {
                setWorkspaceName(workspace.name);
                // Land them in the app once they acknowledge.
                void navigate(`/invite/${token}`, { replace: true });
              },
            })
          }
          className="w-full rounded-app bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {accept.isPending ? "Joining…" : "Accept invitation"}
        </button>
      </div>
    </AuthCard>
  );
}
