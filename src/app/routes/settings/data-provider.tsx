import { useState, type FormEvent } from "react";

import { DATAFORSEO_SIGNUP_URL } from "../../lib/constants";
import { errorMessage } from "../../lib/api";
import {
  useActiveWorkspace,
  useClearCredentials,
  useSetCredentials,
} from "../../lib/workspaces";
import { Alert, Button, NoWorkspace, Section, TextField } from "./ui";

/**
 * DataForSEO credentials for the workspace.
 *
 * The form is write-only. Stored values are never sent back to the browser —
 * the API returns only whether something is configured and a masked login — so
 * there is nothing to pre-fill and no way to read a key back out of the UI.
 */
export function DataProviderSettings() {
  const { activeWorkspace, isPending } = useActiveWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const save = useSetCredentials(workspaceId);
  const clear = useClearCredentials(workspaceId);

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);

  if (isPending) return <Section title="Data provider">Loading…</Section>;
  if (activeWorkspace === null) return <NoWorkspace />;

  const canEdit = activeWorkspace.role !== "member";
  const { configured, login: maskedLogin } = activeWorkspace.credentials;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (login.trim() === "" || password === "") return;

    setSaved(false);
    save.mutate(
      { login: login.trim(), password },
      {
        onSuccess: () => {
          // Never keep the secret in component state after it is stored.
          setLogin("");
          setPassword("");
          setSaved(true);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <Section
        title="DataForSEO credentials"
        description="OpenRefs runs on your own DataForSEO account — we never proxy or resell a key. Every query in this workspace is billed to the credentials below."
      >
        <div className="space-y-5">
          <div className="rounded-app border border-border bg-surface-muted px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              {configured ? "Credentials stored" : "No credentials yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {configured
                ? `Signed in as ${maskedLogin ?? "an account we cannot display"}.`
                : "Add your DataForSEO API login and password to start pulling data."}
            </p>
          </div>

          <Alert tone="info">
            Both values are encrypted with AES-256-GCM before they touch the
            database, using a master key held as a Worker secret. They are never
            returned to the browser, never written to logs, and the password has
            no masked form here because it is never read back for display. To
            change them, enter a new pair — there is no way to reveal the old
            one.
          </Alert>

          {!canEdit ? (
            <Alert tone="info">
              You need the admin or owner role to change these credentials.
            </Alert>
          ) : (
            <form onSubmit={onSubmit} className="space-y-5">
              <TextField
                id="dfs-login"
                label="API login"
                value={login}
                onChange={setLogin}
                autoComplete="off"
                placeholder="you@example.com"
                hint={
                  configured
                    ? "Entering a new pair replaces the stored one."
                    : undefined
                }
              />
              <TextField
                id="dfs-password"
                label="API password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />

              {save.error !== null && (
                <Alert tone="error">
                  {errorMessage(save.error, "Could not save the credentials.")}
                </Alert>
              )}
              {saved && save.error === null && (
                <Alert tone="success">Credentials saved and encrypted.</Alert>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={
                    save.isPending || login.trim() === "" || password === ""
                  }
                >
                  {save.isPending
                    ? "Saving…"
                    : configured
                      ? "Replace credentials"
                      : "Save credentials"}
                </Button>

                {configured && (
                  <Button
                    variant="secondary"
                    disabled={clear.isPending}
                    onClick={() => {
                      setSaved(false);
                      clear.mutate();
                    }}
                  >
                    {clear.isPending ? "Removing…" : "Remove credentials"}
                  </Button>
                )}
              </div>

              {clear.error !== null && (
                <Alert tone="error">
                  {errorMessage(clear.error, "Could not remove the credentials.")}
                </Alert>
              )}
            </form>
          )}

          <p className="text-sm text-muted-foreground">
            Don't have an account yet?{" "}
            <a
              href={DATAFORSEO_SIGNUP_URL}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              Sign up at DataForSEO
            </a>
            .
          </p>
        </div>
      </Section>
    </div>
  );
}
