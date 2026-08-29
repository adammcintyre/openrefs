import { useState, type FormEvent } from "react";

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
import { DATAFORSEO_SIGNUP_URL } from "../../lib/constants";
import {
  useActiveWorkspace,
  useClearCredentials,
  useSetCredentials,
} from "../../lib/workspaces";

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
    <Card>
      <CardHeader>
        <CardTitle>DataForSEO credentials</CardTitle>
        <CardDescription>
          OpenRefs runs on your own DataForSEO account — we never proxy or
          resell a key. Every query in this workspace is billed to the
          credentials below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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

        <p
          role="status"
          className="rounded-app border border-info-subtle bg-info-subtle px-3 py-2 text-sm text-info-on-subtle"
        >
          Both values are encrypted with AES-256-GCM before they touch the
          database, using a master key held as a Worker secret. They are never
          returned to the browser, never written to logs, and the password has
          no masked form here because it is never read back for display. To
          change them, enter a new pair — there is no way to reveal the old
          one.
        </p>

        {!canEdit ? (
          <p
            role="status"
            className="rounded-app border border-info-subtle bg-info-subtle px-3 py-2 text-sm text-info-on-subtle"
          >
            You need the admin or owner role to change these credentials.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <Field
              label="API login"
              hint={
                configured
                  ? "Entering a new pair replaces the stored one."
                  : undefined
              }
            >
              {(field) => (
                <Input
                  {...field}
                  value={login}
                  autoComplete="off"
                  placeholder="you@example.com"
                  onChange={(event) => setLogin(event.target.value)}
                />
              )}
            </Field>

            <Field label="API password">
              {(field) => (
                <Input
                  {...field}
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>

            {save.error !== null && (
              <p
                role="alert"
                className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
              >
                {errorMessage(save.error, "Could not save the credentials.")}
              </p>
            )}
            {saved && save.error === null && (
              <p
                role="status"
                className="rounded-app border border-success-subtle bg-success-subtle px-3 py-2 text-sm text-success-on-subtle"
              >
                Credentials saved and encrypted.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                loading={save.isPending}
                disabled={save.isPending || login.trim() === "" || password === ""}
              >
                {configured ? "Replace credentials" : "Save credentials"}
              </Button>

              {configured && (
                <Button
                  variant="secondary"
                  loading={clear.isPending}
                  disabled={clear.isPending}
                  onClick={() => {
                    setSaved(false);
                    clear.mutate();
                  }}
                >
                  Remove credentials
                </Button>
              )}
            </div>

            {clear.error !== null && (
              <p
                role="alert"
                className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
              >
                {errorMessage(clear.error, "Could not remove the credentials.")}
              </p>
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
      </CardContent>
    </Card>
  );
}
