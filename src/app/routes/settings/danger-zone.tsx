import { useState } from "react";
import { useNavigate } from "react-router";

import { errorMessage } from "../../lib/api";
import { useDeleteAccount } from "../../lib/session";
import { useActiveWorkspace, useDeleteWorkspace } from "../../lib/workspaces";
import { Alert, Button, NoWorkspace, Section, TextField } from "./ui";

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

  if (isPending) return <Section title="Danger zone">Loading…</Section>;
  if (activeWorkspace === null) return <NoWorkspace />;

  const isOwner = activeWorkspace.role === "owner";
  const nameMatches = confirmName === activeWorkspace.name;

  const soleOwnedCount = workspaces.filter(
    (workspace) => workspace.role === "owner",
  ).length;

  return (
    <div className="space-y-6">
      <Section
        title="Delete this workspace"
        description="Removes the workspace and everything in it: projects, tracked keywords, audits, collections, cached results and stored files. This cannot be undone."
      >
        {!isOwner ? (
          <Alert tone="info">Only an owner can delete a workspace.</Alert>
        ) : (
          <div className="space-y-4">
            <Alert tone="error">
              Deleting <strong>{activeWorkspace.name}</strong> also removes every
              member's access and revokes its API keys immediately.
            </Alert>

            <TextField
              id="confirm-workspace-name"
              label={`Type "${activeWorkspace.name}" to confirm`}
              value={confirmName}
              onChange={setConfirmName}
              autoComplete="off"
            />

            {deleteWorkspace.error !== null && (
              <Alert tone="error">
                {errorMessage(
                  deleteWorkspace.error,
                  "Could not delete the workspace.",
                )}
              </Alert>
            )}

            <Button
              variant="danger"
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
              {deleteWorkspace.isPending
                ? "Deleting…"
                : "Delete this workspace permanently"}
            </Button>
          </div>
        )}
      </Section>

      <Section
        title="Delete your account"
        description="Closes your OpenRefs account and signs you out everywhere."
      >
        <div className="space-y-4">
          <Alert tone="error">
            {soleOwnedCount === 0
              ? "You are not the sole owner of any workspace, so only your memberships will be removed."
              : `Any workspace you own alone is deleted with your account — ${soleOwnedCount} of your ${workspaces.length} right now. Workspaces with another owner simply lose you as a member.`}
          </Alert>

          <TextField
            id="account-password"
            label="Your password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />

          <TextField
            id="account-confirm"
            label={`Type ${ACCOUNT_CONFIRM_WORD} to confirm`}
            value={confirmWord}
            onChange={setConfirmWord}
            autoComplete="off"
          />

          {deleteAccount.error !== null && (
            <Alert tone="error">
              {errorMessage(deleteAccount.error, "Could not delete your account.")}
            </Alert>
          )}

          <Button
            variant="danger"
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
            {deleteAccount.isPending ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </Section>
    </div>
  );
}
