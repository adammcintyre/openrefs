import { useState } from "react";
import { useNavigate } from "react-router";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Skeleton,
} from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useDeleteAccount } from "../../lib/session";
import { useActiveWorkspace, useDeleteWorkspace } from "../../lib/workspaces";

/** Typed into the account-deletion field to confirm intent. */
const ACCOUNT_CONFIRM_WORD = "DELETE";

export function DangerZoneSettings() {
  const navigate = useNavigate();
  const { activeWorkspace, workspaces, isPending } = useActiveWorkspace();
  const deleteWorkspace = useDeleteWorkspace(activeWorkspace?.id ?? null);
  const deleteAccount = useDeleteAccount();

  const [confirmName, setConfirmName] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [password, setPassword] = useState("");

  if (isPending) return <Skeleton className="h-48 w-full" />;
  if (activeWorkspace === null) {
    return (
      <Card>
        <EmptyState
          title="No workspace"
          description="Create a workspace from the switcher in the header to get started."
        />
      </Card>
    );
  }

  const isOwner = activeWorkspace.role === "owner";
  const nameMatches = confirmName === activeWorkspace.name;

  const soleOwnedCount = workspaces.filter(
    (workspace) => workspace.role === "owner",
  ).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Delete this workspace</CardTitle>
          <CardDescription>
            Removes the workspace and everything in it: projects, tracked
            keywords, audits, collections, cached results and stored files.
            This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isOwner ? (
            <p
              role="status"
              className="rounded-app border border-info-subtle bg-info-subtle px-3 py-2 text-sm text-info-on-subtle"
            >
              Only an owner can delete a workspace.
            </p>
          ) : (
            <div className="space-y-4">
              <p
                role="alert"
                className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
              >
                Deleting <strong>{activeWorkspace.name}</strong> also removes
                every member's access and revokes its API keys immediately.
              </p>

              <Field label={`Type "${activeWorkspace.name}" to confirm`}>
                {(field) => (
                  <Input
                    {...field}
                    value={confirmName}
                    autoComplete="off"
                    onChange={(event) => setConfirmName(event.target.value)}
                  />
                )}
              </Field>

              {deleteWorkspace.error !== null && (
                <p
                  role="alert"
                  className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
                >
                  {errorMessage(
                    deleteWorkspace.error,
                    "Could not delete the workspace.",
                  )}
                </p>
              )}

              <Button
                variant="danger"
                loading={deleteWorkspace.isPending}
                disabled={!nameMatches || deleteWorkspace.isPending}
                onClick={() =>
                  deleteWorkspace.mutate(confirmName, {
                    onSuccess: () => {
                      setConfirmName("");
                      void navigate("/app", { replace: true });
                    },
                  })
                }
              >
                Delete this workspace permanently
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete your account</CardTitle>
          <CardDescription>
            Closes your OpenRefs account and signs you out everywhere.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p
              role="alert"
              className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
            >
              {soleOwnedCount === 0
                ? "You are not the sole owner of any workspace, so only your memberships will be removed."
                : `Any workspace you own alone is deleted with your account — ${soleOwnedCount} of your ${workspaces.length} right now. Workspaces with another owner simply lose you as a member.`}
            </p>

            <Field label="Your password">
              {(field) => (
                <Input
                  {...field}
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>

            <Field label={`Type ${ACCOUNT_CONFIRM_WORD} to confirm`}>
              {(field) => (
                <Input
                  {...field}
                  value={confirmWord}
                  autoComplete="off"
                  onChange={(event) => setConfirmWord(event.target.value)}
                />
              )}
            </Field>

            {deleteAccount.error !== null && (
              <p
                role="alert"
                className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
              >
                {errorMessage(deleteAccount.error, "Could not delete your account.")}
              </p>
            )}

            <Button
              variant="danger"
              loading={deleteAccount.isPending}
              disabled={
                password === "" ||
                confirmWord !== ACCOUNT_CONFIRM_WORD ||
                deleteAccount.isPending
              }
              onClick={() =>
                deleteAccount.mutate(password, {
                  onSuccess: () => {
                    setPassword("");
                    setConfirmWord("");
                    void navigate("/", { replace: true });
                  },
                })
              }
            >
              Delete my account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
