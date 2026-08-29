/**
 * `configured: false` — this deployment has no Google OAuth client.
 *
 * **This is a normal state, not a broken one**, and the card is written that
 * way. OpenRefs is self-hostable, Search Console is optional, and a deployment
 * that has never set up a Google client is working exactly as designed. So:
 * no error styling, no alarm — a setup guide, addressed to the person who runs
 * the deployment.
 *
 * It is also the state most likely to be seen by someone who *cannot* act on
 * it, so the steps say plainly that they are the operator's, and a member is
 * told who to ask rather than being handed instructions for a console they
 * have no login to.
 *
 * The redirect URI is built from `location.origin` rather than printed as a
 * placeholder. Google compares that string byte for byte, and the single most
 * common way to lose an hour here is transcribing it with the wrong scheme, a
 * stray trailing slash, or the production host while testing locally. Showing
 * the exact value for the host the operator is standing on removes the
 * transcription step altogether.
 */
import { Check, Copy, ExternalLink, PlugZap } from "lucide-react";
import { useState } from "react";

import { GSC_CALLBACK_PATH } from "./paths";
import { Badge, Button, Card } from "../ui";

/**
 * The callback URL for the host this page is being served from.
 *
 * Falls back to a placeholder during a server render, where there is no
 * location to read — the client render replaces it immediately, and a
 * placeholder is better than a crash in a smoke test.
 */
export function gscRedirectUri(origin?: string): string {
  const base =
    origin ??
    (typeof globalThis.location === "undefined"
      ? "https://<your-host>"
      : globalThis.location.origin);
  return `${base}${GSC_CALLBACK_PATH}`;
}

/** A value the operator must copy exactly, with a button that does it for them. */
function CopyableValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    // Clipboard access can be denied or absent (insecure origin, older
    // browser). The value is on screen and selectable either way, so a failure
    // just leaves the button unchanged rather than raising anything.
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        globalThis.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  }

  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 rounded-app border border-border bg-surface-muted px-2.5 py-1.5 font-mono text-xs break-all text-foreground">
        {value}
      </code>
      <Button
        size="sm"
        variant="secondary"
        onClick={copy}
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-semibold text-tint-foreground"
      >
        {n}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-sm leading-relaxed text-muted-foreground">
          {children}
        </span>
      </span>
    </li>
  );
}

export function GscSetupCard({ canAdminister }: { canAdminister: boolean }) {
  const redirectUri = gscRedirectUri();

  return (
    <Card className="p-6">
      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Search Console isn't set up on this deployment
          </h2>
          <Badge variant="neutral">Operator setup</Badge>
        </span>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          Search Console reads your data through Google's own API, using a
          Google OAuth client that belongs to whoever runs this deployment —
          not to OpenRefs. Until one is configured there is nothing to connect
          to. It is free, takes about ten minutes, and is a one-time job for the
          whole install rather than something each project needs.
        </p>
      </div>

      {canAdminister ? null : (
        <p
          role="status"
          className="mt-4 rounded-app border border-info-subtle bg-info-subtle p-3 text-sm leading-relaxed text-info-on-subtle"
        >
          These steps need access to this deployment's server configuration, so
          they are the operator's to run — not something a workspace admin can
          do from inside OpenRefs. Send them this page.
        </p>
      )}

      <ol className="mt-5 flex flex-col gap-4">
        <Step n={1} title="Create a Google Cloud project and enable the API">
          In the{" "}
          <a
            href="https://console.cloud.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
          >
            Google Cloud console
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
          , create (or pick) a project and enable the{" "}
          <strong className="font-medium text-foreground">
            Google Search Console API
          </strong>
          . Without that the OAuth client exists but every data call fails.
        </Step>

        <Step n={2} title="Configure the OAuth consent screen">
          Type <strong className="font-medium text-foreground">External</strong>
          , app name OpenRefs, and the single scope{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">
            .../auth/webmasters.readonly
          </code>{" "}
          — read-only, so a connection can never change anything in Search
          Console. Point the privacy-policy field at this deployment's{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">
            /privacy
          </code>{" "}
          page. Until the app is verified Google allows up to 100 test users,
          which is plenty for your own sites.
        </Step>

        <Step n={3} title="Create an OAuth client of type Web application">
          Not "Desktop" and not "TV" — only a Web application client can carry
          the redirect below. Add exactly this authorized redirect URI:
          <CopyableValue value={redirectUri} label="the redirect URI" />
          <span className="mt-2 flex flex-col gap-1 rounded-app border border-warning-subtle bg-warning-subtle p-3 text-warning-on-subtle">
            <strong className="text-sm font-semibold">
              This must match byte for byte
            </strong>
            <span className="text-sm leading-relaxed">
              Google compares the redirect URI as an exact string. A different
              scheme (<code className="font-mono text-xs">http</code> vs{" "}
              <code className="font-mono text-xs">https</code>), a{" "}
              <code className="font-mono text-xs">www.</code> that is present
              here and absent there, a different port, or one extra trailing
              slash all count as a different URI, and the connection fails with{" "}
              <code className="font-mono text-xs">redirect_uri_mismatch</code>.
              Copy the value above rather than retyping it, and register one
              entry per host you serve from — a local dev host and the
              production host are two separate URIs.
            </span>
          </span>
        </Step>

        <Step n={4} title="Give this deployment the credentials">
          Set the client id as the{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">
            GOOGLE_CLIENT_ID
          </code>{" "}
          var and the client secret as the{" "}
          <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">
            GOOGLE_CLIENT_SECRET
          </code>{" "}
          secret:
          <CopyableValue
            value="npx wrangler secret put GOOGLE_CLIENT_SECRET"
            label="the wrangler secret command"
          />
          <span className="mt-1.5 block">
            Locally, both go in{" "}
            <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">
              .dev.vars
            </code>
            . The secret is never put in{" "}
            <code className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs">
              wrangler.jsonc
            </code>{" "}
            and never committed.
          </span>
        </Step>

        <Step n={5} title="Redeploy, then come back here">
          This page checks for both values on every load. Once they are present
          it turns into a Connect button, and each project connects its own
          Google account and property.
        </Step>
      </ol>

      <p className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
        <PlugZap className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Everything else in OpenRefs works without this. Search Console is an
          optional extra source: your own click and impression data, alongside
          the third-party estimates the other modules use.
        </span>
      </p>
    </Card>
  );
}
