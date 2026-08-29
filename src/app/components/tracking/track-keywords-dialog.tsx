/**
 * "Track these keywords" — the bridge from research to a project.
 *
 * Opened from the Keyword Research tables (and, later, Gap Analysis) for one
 * row or a whole selection. It is the same POST the Rank Tracking module's own
 * Add-keywords dialog makes; what differs is that the project is not already
 * chosen, so picking one is the dialog's first job.
 *
 * Two details that matter more than they look:
 *
 * - **The project's market wins, not the market the research was run in.** A
 *   keyword researched in the US but tracked for a UK project must be checked
 *   in the UK, or its positions describe a page the project's owner cannot
 *   act on. The device is offered because it is genuinely a per-batch choice;
 *   location and language are not, and the dialog says which market it will
 *   use rather than silently inheriting one.
 * - **Adding is idempotent.** Re-tracking a keyword returns `skipped`, not an
 *   error, so "select all → Track" is safe to press twice — which people do.
 */
import { useEffect, useState } from "react";

import type { Device, Project } from "../../../shared/projects";
import { TRACKED_KEYWORDS_BULK_MAX } from "../../../shared/tracking";
import { errorMessage } from "../../lib/api";
import { ProjectPicker } from "../projects/project-picker";
import { Button, Dialog, useToast } from "../ui";
import { DeviceSelect } from "./device-select";
import { pluralKeywords } from "./format";
import { useAddTrackedKeywords } from "./queries";

/**
 * What will actually be sent, from what the table selected.
 *
 * Trimmed, lowercased and de-duplicated the way the route does, so the count
 * in the button is the count that gets added — "Track 3 keywords" followed by
 * a toast saying 2 were added is a small betrayal that is easy to avoid.
 * Capped at the bulk maximum so a select-all over a very long result set is
 * refused client-side rather than by a 422.
 *
 * Exported (and unit-tested) separately because the dialog around it cannot be
 * rendered in this project's DOM-less test harness.
 */
export function trackTargets(
  keywords: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];

  for (const raw of keywords) {
    const keyword = raw.trim().toLowerCase();
    if (keyword === "" || seen.has(keyword)) continue;
    seen.add(keyword);
    targets.push(keyword);
    if (targets.length === TRACKED_KEYWORDS_BULK_MAX) break;
  }

  return targets;
}

export function TrackKeywordsDialog({
  workspaceId,
  open,
  onClose,
  keywords,
}: {
  workspaceId: string | null;
  open: boolean;
  onClose: () => void;
  /** Keyword strings, in the order the table showed them. */
  keywords: ReadonlyArray<string>;
}) {
  const { toast } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [error, setError] = useState<string | null>(null);

  const addKeywords = useAddTrackedKeywords(workspaceId, project?.id ?? null);

  // Reset per opening: a dialog that reopens holding the last run's project is
  // a reliable way to track keywords against the wrong site.
  useEffect(() => {
    if (!open) return;
    setProject(null);
    setDevice("desktop");
    setError(null);
  }, [open]);

  const unique = trackTargets(keywords);
  const busy = addKeywords.isPending;
  const canSubmit = project !== null && unique.length > 0;

  async function submit() {
    if (project === null || !canSubmit || busy) return;
    setError(null);

    try {
      const result = await addKeywords.mutateAsync({
        keywords: unique,
        device,
      });

      toast({
        title:
          result.added === 0
            ? "Already tracked"
            : `Tracking ${pluralKeywords(result.added)}`,
        description:
          result.added === 0
            ? `Every keyword was already tracked in "${project.name}".`
            : `Added to "${project.name}"${
                result.skipped > 0
                  ? `, ${result.skipped.toLocaleString("en")} already tracked`
                  : ""
              }. ${
                result.checkEnqueued
                  ? "A first check is queued — positions usually land within 5 to 20 minutes."
                  : "Positions appear after the next check."
              }`,
        tone: "success",
      });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, "Could not track these keywords."));
    }
  }

  const title =
    unique.length === 1 && unique[0] !== undefined
      ? `Track "${unique[0]}"`
      : `Track ${pluralKeywords(unique.length)}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description="Rank Tracking checks these daily against a project's domain."
      size="lg"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!canSubmit}
          >
            {project === null ? "Pick a project" : `Track in ${project.name}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ProjectPicker
          workspaceId={workspaceId}
          selectedId={project?.id ?? null}
          onSelect={setProject}
          title="Project"
          description="Positions are measured against this project's domain and market."
          // Already inside a dialog's surface — a second card would be a box
          // in a box.
          variant="bare"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <DeviceSelect
            value={device}
            onChange={setDevice}
            disabled={busy}
            hint="Desktop and mobile are tracked separately."
          />
        </div>

        {project === null ? null : (
          <p className="text-xs text-muted-foreground">
            {`Checked in the project's market (location ${project.locationCode}, ${project.languageCode}) — not the market this research was run in.`}
          </p>
        )}

        {error === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
