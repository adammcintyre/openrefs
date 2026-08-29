import { useState, type FormEvent } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from "../../components/ui";
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
import { copyToClipboard, formatDate } from "./utils";

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
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            Everyone with access to this workspace. Owners can change roles;
            owners and admins can remove people.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : members.error !== null ? (
            <p
              role="alert"
              className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
            >
              {errorMessage(members.error, "Could not load members.")}
            </p>
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
                        // `Select`'s base is w-full and cn() does not
                        // de-duplicate conflicting utilities (see cn.ts), so
                        // the fixed width goes on a wrapper rather than being
                        // fought for on the control itself.
                        <div className="w-36">
                          <Select
                            aria-label={`Role for ${member.email}`}
                            value={member.role}
                            disabled={isLastOwner || updateRole.isPending}
                            onChange={(event) =>
                              updateRole.mutate({
                                userId: member.userId,
                                role: event.target.value as WorkspaceRole,
                              })
                            }
                          >
                            {WORKSPACE_ROLES.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </Select>
                        </div>
                      ) : (
                        <Badge variant="brand">{member.role}</Badge>
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
            <p
              role="alert"
              className="mt-4 rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
            >
              {errorMessage(
                updateRole.error ?? removeMember.error,
                "Could not update that member.",
              )}
            </p>
          )}

          {ownerCount <= 1 && (
            <p className="mt-4 text-xs text-muted-foreground">
              A workspace always keeps at least one owner. Promote someone else
              before changing or removing the last one.
            </p>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              Invites are links, valid for 7 days. Email delivery lands in a
              later phase — copy the link and send it yourself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite} className="space-y-4">
              <Field label="Email">
                {(field) => (
                  <Input
                    {...field}
                    type="email"
                    value={inviteEmail}
                    placeholder="colleague@example.com"
                    onChange={(event) => setInviteEmail(event.target.value)}
                  />
                )}
              </Field>

              <Field label="Role">
                {(field) => (
                  <Select
                    {...field}
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(event.target.value as WorkspaceRole)
                    }
                  >
                    {WORKSPACE_ROLES.filter(
                      (option) => role === "owner" || option !== "owner",
                    ).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {createInvite.error !== null && (
                <p
                  role="alert"
                  className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
                >
                  {errorMessage(createInvite.error, "Could not create the invite.")}
                </p>
              )}

              <Button
                type="submit"
                loading={createInvite.isPending}
                disabled={createInvite.isPending || inviteEmail.trim() === ""}
              >
                Create invite link
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
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>
              Links that have been created but not yet accepted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invites.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (invites.data ?? []).length === 0 ? (
              <EmptyState title="No pending invites" />
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
              <p
                role="alert"
                className="mt-4 rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
              >
                {errorMessage(revokeInvite.error, "Could not revoke the invite.")}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
