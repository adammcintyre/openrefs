import { useState, type FormEvent } from "react";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  Skeleton,
} from "../../components/ui";
import { errorMessage } from "../../lib/api";
import {
  useActiveWorkspace,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "../../lib/workspaces";
import { copyToClipboard, formatDate } from "./utils";

const CREATE_FORM_ID = "create-api-key-form";

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

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
        </CardHeader>
        <CardContent>
          <p
            role="status"
            className="rounded-app border border-info-subtle bg-info-subtle px-3 py-2 text-sm text-info-on-subtle"
          >
            You need the admin or owner role to manage API keys.
          </p>
        </CardContent>
      </Card>
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
    <>
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Keys let scripts read this workspace over the API. They act with
            the member role, so a key can read data but cannot change
            settings, members or credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {keys.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (keys.data ?? []).length === 0 ? (
            <EmptyState title="No API keys yet" />
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
            <p
              role="alert"
              className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
            >
              {errorMessage(revokeKey.error, "Could not revoke that key.")}
            </p>
          )}

          <Button onClick={() => setDialogOpen(true)}>Create API key</Button>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={newKey === null ? "Create an API key" : "Copy your API key"}
        footer={
          newKey === null ? (
            <>
              <Button variant="secondary" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={CREATE_FORM_ID}
                loading={createKey.isPending}
                disabled={createKey.isPending || name.trim() === ""}
              >
                Create key
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={closeDialog}>
                Done
              </Button>
              <Button
                onClick={() => {
                  void copyToClipboard(newKey).then(setCopied);
                }}
              >
                Copy key
              </Button>
              {copied && (
                <span className="text-xs text-muted-foreground">Copied.</span>
              )}
            </>
          )
        }
      >
        {newKey === null ? (
          <form id={CREATE_FORM_ID} onSubmit={onCreate} className="space-y-4">
            <Field
              label="Name"
              hint="Something you will recognise later, so you know what to revoke."
            >
              {(field) => (
                <Input
                  {...field}
                  value={name}
                  placeholder="CI reporting"
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>

            {createKey.error !== null && (
              <p
                role="alert"
                className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
              >
                {errorMessage(createKey.error, "Could not create the key.")}
              </p>
            )}
          </form>
        ) : (
          <div className="space-y-4">
            <p
              role="status"
              className="rounded-app border border-info-subtle bg-info-subtle px-3 py-2 text-sm text-info-on-subtle"
            >
              This is the only time this key will be shown. We store only a
              hash of it, so it cannot be displayed again — copy it now and
              keep it somewhere safe.
            </p>

            <code className="block break-all rounded-app border border-border bg-background px-3 py-3 font-mono text-xs text-foreground">
              {newKey}
            </code>
          </div>
        )}
      </Dialog>
    </>
  );
}
