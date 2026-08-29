import { useState, type FormEvent } from "react";

import { errorMessage } from "../../lib/api";
import {
  useActiveWorkspace,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
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

export function ApiKeysSettings() {
  const { activeWorkspace, isPending } = useActiveWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const role = activeWorkspace?.role ?? "member";
  const canManage = role !== "member";

  const keys = useApiKeys(workspaceId, canManage);
  const createKey = useCreateApiKey(workspaceId);
  const revokeKey = useRevokeApiKey(workspaceId);

  const [name, setName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (isPending) return <Section title="API keys">Loading…</Section>;
  if (activeWorkspace === null) return <NoWorkspace />;

  if (!canManage) {
    return (
      <Section title="API keys">
        <Alert tone="info">
          You need the admin or owner role to manage API keys.
        </Alert>
      </Section>
    );
  }

  const onCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === "") return;

    createKey.mutate(
      { name: name.trim() },
      {
        onSuccess: (created) => {
          setNewKey(created.key);
          setCopied(false);
          setName("");
        },
      },
    );
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setNewKey(null);
    setCopied(false);
    setName("");
  };

  return (
    <div className="space-y-6">
      <Section
        title="API keys"
        description="Keys let scripts read this workspace over the API. They act with the member role, so a key can read data but cannot change settings, members or credentials."
      >
        <div className="space-y-5">
          {keys.isPending ? (
            <p className="text-sm text-muted-foreground">Loading keys…</p>
          ) : (keys.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(keys.data ?? []).map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {key.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(key.createdAt)} ·{" "}
                      {key.lastUsedAt === null
                        ? "never used"
                        : `last used ${formatDate(key.lastUsedAt)}`}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={revokeKey.isPending}
                    onClick={() => revokeKey.mutate(key.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {revokeKey.error !== null && (
            <Alert tone="error">
              {errorMessage(revokeKey.error, "Could not revoke that key.")}
            </Alert>
          )}

          <Button onClick={() => setDialogOpen(true)}>Create API key</Button>
        </div>
      </Section>

      {dialogOpen && (
        <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 p-6 pt-24">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-key-dialog-title"
            className="w-full max-w-lg rounded-app border border-border bg-surface p-6"
          >
            <h2
              id="api-key-dialog-title"
              className="text-base font-semibold text-foreground"
            >
              {newKey === null ? "Create an API key" : "Copy your API key"}
            </h2>

            {newKey === null ? (
              <form onSubmit={onCreate} className="mt-5 space-y-4">
                <TextField
                  id="api-key-name"
                  label="Name"
                  value={name}
                  onChange={setName}
                  placeholder="CI reporting"
                  hint="Something you will recognise later, so you know what to revoke."
                />

                {createKey.error !== null && (
                  <Alert tone="error">
                    {errorMessage(createKey.error, "Could not create the key.")}
                  </Alert>
                )}

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={createKey.isPending || name.trim() === ""}
                  >
                    {createKey.isPending ? "Creating…" : "Create key"}
                  </Button>
                  <Button variant="secondary" onClick={closeDialog}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                <Alert tone="info">
                  This is the only time this key will be shown. We store only a
                  hash of it, so it cannot be displayed again — copy it now and
                  keep it somewhere safe.
                </Alert>

                <code className="block break-all rounded-app border border-border bg-background px-3 py-3 font-mono text-xs text-foreground">
                  {newKey}
                </code>

                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => {
                      void copyToClipboard(newKey).then(setCopied);
                    }}
                  >
                    Copy key
                  </Button>
                  <Button variant="secondary" onClick={closeDialog}>
                    Done
                  </Button>
                  {copied && (
                    <span className="text-xs text-muted-foreground">
                      Copied.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
