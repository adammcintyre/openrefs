/**
 * "Run audit" — the one screen in this module that spends money.
 *
 * Everything here follows from that. The cost updates as the two controls move,
 * it is stated as a ceiling ("up to"), the arithmetic behind it is spelled out
 * rather than asserted, and the JS toggle carries its real multiplier. A user
 * choosing 1000 pages with rendering on is agreeing to roughly 170× the cheapest
 * option, and should be able to see that before clicking, not after.
 *
 * The 409 gets its own treatment: "an audit is already running" is a description
 * of a normal state — someone started one in another tab, or the previous run
 * has not finished — not a failure, so it is not painted as one.
 */
import { Play } from "lucide-react";
import { useState } from "react";

import type { AuditCrawlSize } from "../../../shared/audits";
import { AUDIT_CRAWL_SIZES } from "../../../shared/audits";
import { ApiError, errorMessage } from "../../lib/api";
import { Button, Dialog, Field, Select, useToast } from "../ui";
import {
  AUDIT_JS_COST_MULTIPLIER,
  costBreakdown,
  estimateAuditCostUsd,
  formatCostCeiling,
  formatCostHint,
} from "./cost";
import { useCreateAudit } from "./queries";

export function RunAuditDialog({
  open,
  onClose,
  workspaceId,
  projectId,
  domain,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
  projectId: string;
  domain: string;
  /** The new audit's id, so the page can switch to watching it immediately. */
  onStarted: (auditId: string) => void;
}) {
  const { toast } = useToast();
  const createAudit = useCreateAudit(workspaceId, projectId);

  const [maxCrawlPages, setMaxCrawlPages] = useState<AuditCrawlSize>(25);
  const [renderJs, setRenderJs] = useState(false);

  const estimate = estimateAuditCostUsd(maxCrawlPages, renderJs);

  async function start() {
    try {
      const result = await createAudit.mutateAsync({ maxCrawlPages, renderJs });
      onClose();
      onStarted(result.audit.id);
      toast({
        title: "Audit started",
        /*
         * The server's own estimate, not ours: it is computed from the same
         * constants but by the code that actually posted the task, so quoting
         * it here means the toast can never contradict the bill.
         */
        description: `Crawling up to ${result.pagesLimit.toLocaleString("en")} pages of ${domain}. Billed to your key at ${formatCostHint(
          result.costPerPageUsd,
        )} per page, ${formatCostCeiling(result.estimatedCostUsd)} in total. Results usually land within a few minutes.`,
        tone: "success",
      });
    } catch (caught) {
      const conflict =
        caught instanceof ApiError && caught.status === 409;
      toast({
        title: conflict
          ? "An audit is already running"
          : "Could not start the audit",
        description: conflict
          ? `Only one crawl of ${domain} runs at a time. This one will appear here as soon as it finishes.`
          : errorMessage(caught, "Something went wrong starting the crawl."),
        tone: conflict ? "info" : "error",
      });
      if (conflict) onClose();
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Run a site audit"
      description={`Crawl ${domain} for technical issues. You are charged for the pages actually crawled.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void start()} loading={createAudit.isPending}>
            {createAudit.isPending ? null : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {`Run audit — ${formatCostCeiling(estimate)}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field
          label="Pages to crawl"
          hint="A ceiling, not a target. A smaller site costs less than this — the unused pages are refunded."
        >
          {({ id, "aria-describedby": describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={String(maxCrawlPages)}
              onChange={(event) =>
                setMaxCrawlPages(Number(event.target.value) as AuditCrawlSize)
              }
            >
              {AUDIT_CRAWL_SIZES.map((size) => (
                <option key={size} value={size}>
                  {`${size.toLocaleString("en")} pages`}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/*
          A plain checkbox rather than a switch: it is a form control inside a
          form, and the native one already announces its checked state, takes
          Space, and inherits the platform's focus ring.
        */}
        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={renderJs}
              onChange={(event) => setRenderJs(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {`Render JavaScript (≈${AUDIT_JS_COST_MULTIPLIER}× cost)`}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                Needed only for a site whose content is drawn by JavaScript. It
                multiplies the per-page crawl rate by {AUDIT_JS_COST_MULTIPLIER}{" "}
                and takes longer.
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-1 rounded-app border border-border bg-surface-muted p-4">
          <p className="text-sm font-semibold text-foreground">
            {`Estimated cost: ${formatCostCeiling(estimate)}`}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {costBreakdown(maxCrawlPages, renderJs)}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
