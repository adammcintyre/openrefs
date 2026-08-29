/**
 * The two states that are one button: never connected, and connected-but-dead.
 *
 * They share a component because they share the only cure — send the browser to
 * Google and come back with a fresh grant — but they must not share their copy.
 * "Connect" on a project that *was* working reads as though the last connection
 * never existed and quietly implies the user forgot to do something. The broken
 * variant says what happened instead: the grant was refused, the numbers on
 * screen a week ago were real, and one button brings them back.
 *
 * **Connecting is a full-page navigation.** `window.location.href`, never
 * `fetch`: the route answers 302 to Google's consent screen, and Google refuses
 * to be framed or fetched cross-origin. See `gscConnectUrl` in queries.ts.
 *
 * **Members get a sentence, not a disabled button.** Connecting needs the admin
 * role server-side. A greyed-out control with no explanation is worse than no
 * control at all — it looks like a bug in the app rather than a boundary in the
 * workspace.
 */
import { LinkIcon, ShieldAlert } from "lucide-react";

import type { Project } from "../../../shared/projects";
import { Button, Card } from "../ui";
import { startGscConnect } from "./queries";

export function GscConnectPanel({
  workspaceId,
  project,
  broken,
  canAdminister,
}: {
  workspaceId: string | null;
  project: Project;
  /** Google refused the stored refresh token: reconnect is the only fix. */
  broken: boolean;
  canAdminister: boolean;
}) {
  const Icon = broken ? ShieldAlert : LinkIcon;

  return (
    <Card className="p-6">
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        <span
          className={
            broken
              ? "flex size-11 shrink-0 items-center justify-center rounded-full bg-warning-subtle"
              : "flex size-11 shrink-0 items-center justify-center rounded-full bg-tint"
          }
        >
          <Icon
            className={
              broken
                ? "size-5 text-warning-on-subtle"
                : "size-5 text-tint-foreground"
            }
            aria-hidden="true"
          />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {broken
              ? "Google stopped accepting this connection"
              : "Connect Google Search Console"}
          </h2>

          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            {broken ? (
              <>
                The stored authorisation for {project.domain} was refused the
                last time OpenRefs used it. That usually means access was
                withdrawn in the Google account's security settings, the
                password changed, or the grant simply expired after a long idle
                period. Nothing is wrong with your Search Console data — only
                with our permission to read it. Reconnecting takes a few
                seconds.
              </>
            ) : (
              <>
                See the clicks, impressions and positions Google actually
                recorded for {project.domain} — your own first-party numbers,
                not an estimate. OpenRefs asks for one read-only scope and can
                never change anything in Search Console.
              </>
            )}
          </p>

          {canAdminister ? (
            <>
              <div className="mt-2">
                <Button onClick={() => startGscConnect(workspaceId, project.id)}>
                  <LinkIcon className="size-4" aria-hidden="true" />
                  {broken
                    ? "Reconnect Google Search Console"
                    : "Connect Google Search Console"}
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                This leaves OpenRefs for Google's sign-in page and returns here
                when you are done. You will then pick which Search Console
                property this project reads from.
              </p>
            </>
          ) : (
            <p
              role="status"
              className="mt-1 rounded-app border border-info-subtle bg-info-subtle p-3 text-sm leading-relaxed text-info-on-subtle"
            >
              {broken
                ? "Reconnecting Search Console is an admin action. Ask a workspace owner or admin to reconnect it — the reports will come straight back here for everyone."
                : "Connecting Search Console is an admin action, because it binds a Google account to this project. Ask a workspace owner or admin to connect it, and the reports will appear here for everyone."}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
