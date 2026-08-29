import { useEffect, useState, type FormEvent } from "react";

import { errorMessage } from "../../lib/api";
import { useActiveWorkspace, useUpdateWorkspace } from "../../lib/workspaces";
import { Alert, Button, NoWorkspace, Section, TextField } from "./ui";

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

  if (isPending) return <Section title="General">Loading…</Section>;
  if (activeWorkspace === null) return <NoWorkspace />;

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
    <form onSubmit={onSubmit} className="space-y-6">
      <Section
        title="General"
        description="The workspace name is shown in the switcher and on invites."
      >
        <div className="space-y-5">
          <TextField
            id="workspace-name"
            label="Workspace name"
            value={name}
            onChange={setName}
            disabled={!canEdit}
          />

          <TextField
            id="spend-cap"
            label="Monthly spend cap (USD)"
            type="number"
            value={spendCap}
            onChange={setSpendCap}
            disabled={!canEdit}
            hint="A ceiling on DataForSEO spend per calendar month. 0 blocks every paid call; cached results are always free and always allowed."
          />

          {capInvalid && <Alert tone="error">Enter 0 or a positive amount.</Alert>}

          {!canEdit && (
            <Alert tone="info">
              You need the admin or owner role to change these settings.
            </Alert>
          )}

          {update.error !== null && (
            <Alert tone="error">
              {errorMessage(update.error, "Could not save your changes.")}
            </Alert>
          )}

          {saved && update.error === null && (
            <Alert tone="success">Saved.</Alert>
          )}

          {canEdit && (
            <Button
              type="submit"
              disabled={update.isPending || capInvalid || name.trim() === ""}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          )}
        </div>
      </Section>
    </form>
  );
}
