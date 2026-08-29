/**
 * The connected property, and the two things you can do to it.
 *
 * **The disconnect warning is the reason this file is not three lines.**
 * Revocation happens at Google, and Google revokes *per account*, not per
 * project: calling the revoke endpoint with this project's refresh token
 * invalidates every token issued to this OAuth client for that Google account.
 * If two projects were connected with the same Google login — which is the
 * normal case for anyone who owns more than one site — disconnecting one
 * silently breaks the other, and the second project will show a "connection
 * needs renewing" banner that nobody will connect to an action taken somewhere
 * else. Saying so before the click is the only honest option; discovering it
 * afterwards is a support ticket.
 *
 * The dialog also has to be truthful about what "disconnected" means. Google
 * may keep listing the grant in the account's third-party access page even
 * after a successful revoke, which is why the response carries `revoked` and
 * why the toast reports the two outcomes differently rather than always
 * claiming a clean revocation.
 */
import { KeyRound, Repeat2, Unplug } from "lucide-react";
import { useState } from "react";

import type { Project } from "../../../shared/projects";
import { errorMessage } from "../../lib/api";
import { Badge, Button, ConfirmDialog, Dialog, useToast } from "../ui";
import { formatGscProperty, gscPropertyKind } from "./format";
import { GscPropertyPicker } from "./property-picker";
import { useDisconnectGsc } from "./queries";

/** The property, as a chip for the page header. */
export function GscPropertyBadge({ property }: { property: string }) {
  return (
    <Badge
      variant="brand"
      title={`${gscPropertyKind(property)} property: ${property}`}
    >
      <KeyRound className="size-3" aria-hidden="true" />
      {formatGscProperty(property)}
    </Badge>
  );
}

export function GscConnectionMenu({
  workspaceId,
  project,
  property,
  canAdminister,
}: {
  workspaceId: string | null;
  project: Project;
  property: string;
  canAdminister: boolean;
}) {
  const { toast } = useToast();
  const disconnect = useDisconnectGsc(workspaceId, project.id);

  const [changing, setChanging] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!canAdminister) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title="Changing or removing this connection needs the admin role."
      >
        Connected by an admin
      </span>
    );
  }

  async function runDisconnect() {
    try {
      const result = await disconnect.mutateAsync();
      setConfirming(false);
      toast({
        title: `Disconnected ${project.name}`,
        description: result.revoked
          ? "The stored token was deleted and Google accepted the revocation."
          : "The stored token was deleted. Google did not confirm the revocation, so the grant may still be listed under your Google account's third-party access — remove it there if you want it gone.",
        tone: "success",
      });
    } catch (caught) {
      setConfirming(false);
      toast({
        title: "Could not disconnect",
        description: errorMessage(caught, "Something went wrong."),
        tone: "error",
      });
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
        <Repeat2 className="size-3.5" aria-hidden="true" />
        Change property
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
        <Unplug className="size-3.5" aria-hidden="true" />
        Disconnect
      </Button>

      <Dialog
        open={changing}
        onClose={() => setChanging(false)}
        title="Search Console property"
        description={`${project.name} currently reads ${formatGscProperty(property)}.`}
        size="lg"
      >
        <GscPropertyPicker
          workspaceId={workspaceId}
          project={project}
          canAdminister={canAdminister}
          bare
        />
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void runDisconnect()}
        loading={disconnect.isPending}
        title={`Disconnect Search Console from "${project.name}"?`}
        confirmLabel="Disconnect"
        description={
          <span className="flex flex-col gap-2">
            <span>
              OpenRefs will delete the stored token for {project.domain} and ask
              Google to revoke it. Reports in this module stop working until
              someone connects again. Nothing in Search Console itself is
              changed or deleted.
            </span>
            <span className="rounded-app border border-warning-subtle bg-warning-subtle p-3 text-warning-on-subtle">
              <strong className="font-semibold">
                Revocation applies to the whole Google account.
              </strong>{" "}
              Google revokes per account, not per project. Any other OpenRefs
              project connected with the same Google login will lose its access
              at the same moment and need reconnecting — including projects in
              other workspaces. If you only want to point this project somewhere
              else, use “Change property” instead: that keeps the account
              connected.
            </span>
          </span>
        }
      />
    </>
  );
}
