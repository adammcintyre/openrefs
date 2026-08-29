/**
 * "Add keywords" — a textarea, one keyword per line.
 *
 * A textarea rather than a tag input because the source is nearly always a
 * paste: a column out of a spreadsheet, a list from a client, the output of
 * another tool. Anything that makes the user commit each keyword individually
 * turns a two-second paste into a hundred keystrokes.
 *
 * The dialog does the same trim / lowercase / de-duplicate the route does
 * (`parseKeywordLines`) and reports the result *before* submitting, so "40
 * lines, 3 repeats, 37 will be added" is visible while there is still time to
 * fix the list. The server is idempotent regardless — repeats come back as
 * `skipped`, never as an error.
 *
 * The market defaults to the project's and can be overridden per batch, which
 * is what the API's optional `locationCode`/`languageCode` are for. It is
 * behind a checkbox because overriding it is rare and getting it wrong is
 * quiet: keywords tracked in the wrong market simply return positions for
 * somewhere the user does not care about.
 */
import { useEffect, useState } from "react";

import type { Device } from "../../../shared/projects";
import type { Project } from "../../../shared/projects";
import {
  RANK_CHECK_COST_PER_KEYWORD_USD,
  TRACKED_KEYWORDS_BULK_MAX,
} from "../../../shared/tracking";
import { errorMessage } from "../../lib/api";
import { MarketSelects } from "../domains/market-select";
import type { Market } from "../../routes/domain-overview/url-state";
import { Button, Dialog, Field, cn, useToast } from "../ui";
import { DeviceSelect } from "./device-select";
import { formatCostHint, parseKeywordLines, pluralKeywords } from "./format";
import { useAddTrackedKeywords } from "./queries";

export function AddKeywordsDialog({
  workspaceId,
  project,
  open,
  onClose,
}: {
  workspaceId: string | null;
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const addKeywords = useAddTrackedKeywords(workspaceId, project.id);

  const [text, setText] = useState("");
  const [device, setDevice] = useState<Device>("desktop");
  const [overrideMarket, setOverrideMarket] = useState(false);
  const [market, setMarket] = useState<Market>({
    location: project.locationCode,
    language: project.languageCode,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText("");
    setDevice("desktop");
    setOverrideMarket(false);
    setMarket({ location: project.locationCode, language: project.languageCode });
    setError(null);
  }, [open, project.locationCode, project.languageCode]);

  const parsed = parseKeywordLines(text);
  const tooMany = parsed.keywords.length > TRACKED_KEYWORDS_BULK_MAX;
  const busy = addKeywords.isPending;
  const canSubmit = parsed.keywords.length > 0 && !tooMany;

  async function submit() {
    if (!canSubmit || busy) return;
    setError(null);

    try {
      const result = await addKeywords.mutateAsync({
        keywords: parsed.keywords,
        device,
        ...(overrideMarket
          ? { locationCode: market.location, languageCode: market.language }
          : {}),
      });

      toast({
        title:
          result.added === 0
            ? "Already tracked"
            : `Tracking ${pluralKeywords(result.added)}`,
        description:
          result.added === 0
            ? "Every keyword in that list was already being tracked here."
            : result.checkEnqueued
              ? "A first check is queued — positions usually land within 5 to 20 minutes."
              : "Positions will appear after the next check.",
        tone: "success",
      });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, "Could not add these keywords."));
    }
  }

  const estimate = parsed.keywords.length * RANK_CHECK_COST_PER_KEYWORD_USD;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add keywords"
      description={`Tracked against ${project.domain}. One keyword per line.`}
      size="lg"
      dismissible={!busy}
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            {parsed.keywords.length === 0
              ? "Paste or type a list to begin."
              : `${pluralKeywords(parsed.keywords.length)} · first check ≈ ${formatCostHint(estimate)}`}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!canSubmit}
          >
            {parsed.keywords.length === 0
              ? "Add keywords"
              : `Add ${parsed.keywords.length.toLocaleString("en")}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Keywords"
          required
          error={
            tooMany
              ? `That's more than ${TRACKED_KEYWORDS_BULK_MAX.toLocaleString("en")} keywords — add them in smaller batches.`
              : undefined
          }
          hint={dedupeHint(parsed.lines, parsed.duplicates, parsed.keywords.length)}
        >
          {(props) => (
            <textarea
              {...props}
              value={text}
              rows={10}
              disabled={busy}
              spellCheck={false}
              placeholder={"photo booth templates\nphoto strip template\nbooth props printable"}
              onChange={(event) => setText(event.target.value)}
              className={cn(
                "w-full rounded-app border bg-surface px-3 py-2 font-mono text-sm text-foreground transition-colors",
                "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
                tooMany ? "border-danger" : "border-border hover:border-muted-foreground",
              )}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <DeviceSelect
            value={device}
            onChange={setDevice}
            disabled={busy}
            hint="Desktop and mobile results differ; each is tracked separately."
          />
        </div>

        <div className="flex flex-col gap-3 rounded-app border border-border p-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 shrink-0 cursor-pointer accent-primary"
              checked={overrideMarket}
              disabled={busy}
              onChange={(event) => setOverrideMarket(event.target.checked)}
            />
            Use a different market for this batch
          </label>

          {overrideMarket ? (
            <MarketSelects
              workspaceId={workspaceId}
              value={market}
              onChange={setMarket}
              disabled={busy}
              className="grid gap-4 sm:grid-cols-2"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {`Using the project's market: location ${project.locationCode}, ${project.languageCode}.`}
            </p>
          )}
        </div>

        {error === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * The line under the textarea. Says what will happen, in the order the user
 * cares about: how many are going in, and what is being dropped on the way.
 */
function dedupeHint(
  lines: number,
  duplicates: number,
  unique: number,
): string {
  if (lines === 0) {
    return "Repeats and keywords already tracked here are skipped automatically.";
  }
  if (duplicates === 0) {
    return `${pluralKeywords(unique)} ready. Anything already tracked here is skipped.`;
  }
  return `${lines.toLocaleString("en")} lines, ${duplicates.toLocaleString("en")} repeated — ${pluralKeywords(unique)} will be added.`;
}
