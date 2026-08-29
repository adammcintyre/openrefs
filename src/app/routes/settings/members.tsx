import { useState, type FormEvent } from "react";

import { errorMessage } from "../../lib/api";
import { useMe } from "../../lib/session";
import type { WorkspaceRole } from "../../../shared/workspaces";
import { WORKSPACE_ROLES } from "../../../shared/workspaces";
import {
  useActiveWorkspace,
  useCreateInvite,
  useInvites,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useUpdateMemberRole,
} from "../../lib/workspaces";
import {
  Alert,
  Button,
  NoWorkspace,
  Section,
  TextField,
  copyToClipboard,
  formatDate,
} from "./ui";

export function MembersSettings() {
  const { activeWorkspace, isPending } = useActiveWorkspace();
  const me = useMe();
  const workspaceId = activeWorkspace?.id ?? null;
  const role = activeWorkspace?.role ?? "member";
  const canManage = role !== "member";

  const members = useMembers(workspaceId);
  const invites = useInvites(workspaceId, canManage);

  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const createInvite = useCreateInvite(workspaceId);
  const revokeInvite = useRevokeInvite(workspaceId);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (isPending) return <Section title="Members">Loading…</Section>;
  if (activeWorkspace === null) return <NoWorkspace />;

  const myUserId = me.data?.user.id ?? null;
  const ownerCount =
    members.data?.filter((member) => member.role === "owner").length ?? 0;

  const onInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inviteEmail.trim() === "") return;

    setInviteUrl(null);
    setCopied(false);
    createInvite.mutate(
      { email: inviteEmail.trim(), role: inviteRole },
      {
        onSuccess: (invite) => {
          setInviteUrl(invite.inviteUrl);
          setInviteEmail("");
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <Section
        title="Members"
        description="Everyone with access to this workspace. Owners can change roles; owners and admins can remove people."
      >
        {members.isPending ? (
          <p className="text-sm text-muted-foreground">Loading members…</p>
        ) : members.error !== null ? (
          <Alert tone="error">
            {errorMessage(members.error, "Could not load members.")}
          </Alert>
        ) : (
          <ul className="divide-y divide-border">
            {(members.data ?? []).map((member) => {
              const isSelf = member.userId === myUserId;
              const isLastOwner = member.role === "owner" && ownerCount <= 1;

              return (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {member.email}
                      {isSelf && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          you
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Joined {formatDate(member.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {role === "owner" ? (
                      <select
                        aria-label={`Role for ${member.email}`}
                        value={member.role}
                        disabled={isLastOwner || updateRole.isPending}
                        onChange={(event) =>
                          updateRole.mutate({
                            userId: member.userId,
                            role: event.target.value as WorkspaceRole,
                          })
                        }
                        className="rounded-app border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
                      >
                        {WORKSPACE_ROLES.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="rounded-full bg-tint px-3 py-1 text-xs font-medium text-tint-foreground">
                        {member.role}
                      </span>
                    )}

                    {(canManage || isSelf) && !isLastOwner && (
                      <Button
                        variant="secondary"
                        disabled={removeMember.isPending}
                        onClick={() => removeMember.mutate(member.userId)}
                      >
                        {isSelf ? "Leave" : "Remove"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {(updateRole.error ?? removeMember.error) !== null && (
          <div className="mt-4">
            <Alert tone="error">
              {errorMessage(
                updateRole.error ?? removeMember.error,
                "Could not update that member.",
              )}
            </Alert>
          </div>
        )}

        {ownerCount <= 1 && (
          <p className="mt-4 text-xs text-muted-foreground">
            A workspace always keeps at least one owner. Promote someone else
            before changing or removing the last one.
          </p>
        )}
      </Section>

      {canManage && (
        <Section
          title="Invite someone"
          description="Invites are links, valid for 7 days. Email delivery lands in a later phase — copy the link and send it yourself."
        >
          <form onSubmit={onInvite} className="space-y-4">
            <TextField
              id="invite-email"
              label="Email"
              type="email"
              value={inviteEmail}
              onChange={setInviteEmail}
              placeholder="colleague@example.com"
            />

            <div className="space-y-1.5">
              <label
                htmlFor="invite-role"
                className="block text-sm font-medium text-foreground"
              >
                Role
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as WorkspaceRole)
                }
                className="w-full rounded-app border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {WORKSPACE_ROLES.filter(
                  (option) => role === "owner" || option !== "owner",
                ).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            {createInvite.error !== null && (
              <Alert tone="error">
                {errorMessage(createInvite.error, "Could not create the invite.")}
              </Alert>
            )}

            <Button
              type="submit"
              disabled={createInvite.isPending || inviteEmail.trim() === ""}
            >
              {createInvite.isPending ? "Creating…" : "Create invite link"}
            </Button>
          </form>

          {inviteUrl !== null && (
            <div className="mt-5 space-y-2 rounded-app border border-border bg-surface-muted p-4">
              <p className="text-sm font-medium text-foreground">
                Invite link ready
              </p>
              <code className="block break-all rounded-app bg-background px-3 py-2 font-mono text-xs text-foreground">
                {inviteUrl}
              </code>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    void copyToClipboard(inviteUrl).then(setCopied);
                  }}
                >
                  Copy link
                </Button>
                {copied && (
                  <span className="text-xs text-muted-foreground">Copied.</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                This link is shown once. We store only a hash of it, so it
                cannot be recovered later — create a new invite if it is lost.
              </p>
            </div>
          )}
        </Section>
      )}

      {canManage && (
        <Section
          title="Pending invites"
          description="Links that have been created but not yet accepted."
        >
          {invites.isPending ? (
            <p className="text-sm text-muted-foreground">Loading invites…</p>
          ) : (invites.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invites.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {(invites.data ?? []).map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {invite.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invite.role} · expires {formatDate(invite.expiresAt)}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={revokeInvite.isPending}
                    onClick={() => revokeInvite.mutate(invite.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {revokeInvite.error !== null && (
            <div className="mt-4">
              <Alert tone="error">
                {errorMessage(revokeInvite.error, "Could not revoke the invite.")}
              </Alert>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
