import { useEffect, useState, type FormEvent } from "react";

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
import { useActiveWorkspace, useUpdateWorkspace } from "../../lib/workspaces";

export function GeneralSettings() {
  const { activeWorkspace, isPending } = useActiveWorkspace();
  const update = useUpdateWorkspace(activeWorkspace?.id ?? null);

  const [name, setName] = useState("");
  const [spendCap, setSpendCap] = useState("");
  const [saved, setSaved] = useState(false);

  // Re-seed the form whenever the active workspace changes under it.
  useEffect(() => {
    if (activeWorkspace === null) return;
    setName(activeWorkspace.name);
    setSpendCap(String(activeWorkspace.spendCapUsd));
    setSaved(false);
  }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspace?.spendCapUsd]);

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

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = Number(spendCap);
    if (!Number.isFinite(parsed) || parsed < 0) return;

    setSaved(false);
    update.mutate(
      { name: name.trim(), spendCapUsd: parsed },
      { onSuccess: () => setSaved(true) },
    );
  };

  const capValue = Number(spendCap);
  const capInvalid = !Number.isFinite(capValue) || capValue < 0;

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
          <CardDescription>
            The workspace name is shown in the switcher and on invites.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Workspace name">
            {(field) => (
              <Input
                {...field}
                value={name}
                disabled={!canEdit}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          <Field
            label="Monthly spend cap (USD)"
            hint="A ceiling on DataForSEO spend per calendar month. 0 blocks every paid call; cached results are always free and always allowed."
            error={capInvalid ? "Enter 0 or a positive amount." : undefined}
          >
            {(field) => (
              <Input
                {...field}
                type="number"
                value={spendCap}
                disabled={!canEdit}
                onChange={(event) => setSpendCap(event.target.value)}
              />
            )}
          </Field>

          {!canEdit && (
            <p
              role="status"
              className="rounded-app border border-info-subtle bg-info-subtle px-3 py-2 text-sm text-info-on-subtle"
            >
              You need the admin or owner role to change these settings.
            </p>
          )}

          {update.error !== null && (
            <p
              role="alert"
              className="rounded-app border border-danger-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-on-subtle"
            >
              {errorMessage(update.error, "Could not save your changes.")}
            </p>
          )}

          {saved && update.error === null && (
            <p
              role="status"
              className="rounded-app border border-success-subtle bg-success-subtle px-3 py-2 text-sm text-success-on-subtle"
            >
              Saved.
            </p>
          )}

          {canEdit && (
            <Button
              type="submit"
              loading={update.isPending}
              disabled={update.isPending || capInvalid || name.trim() === ""}
            >
              Save changes
            </Button>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
