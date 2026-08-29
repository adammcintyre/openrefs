import { Wallet } from "lucide-react";

import { APP_VERSION } from "../../shared/version";
import { Badge } from "./ui/badge";
import { cn } from "./ui/cn";

/**
 * Compact spend readout for the foot of the sidebar.
 *
 * The numbers are hard-coded sample data and are labelled as such on the face
 * of the widget — not only in a comment — because an unlabelled plausible
 * figure here would be read as a real balance. Phase 0 wires this to
 * GET /api/v1/usage; until then the "Sample" badge is load-bearing.
 */
const SAMPLE = { spentUsd: 3.42, capUsd: 25 } as const;

export function UsageWidget({ collapsed = false }: { collapsed?: boolean }) {
  const pct = Math.min(100, Math.round((SAMPLE.spentUsd / SAMPLE.capUsd) * 100));

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border px-2 py-3">
        <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
          {pct}%
        </span>
        <span className="sr-only">
          Sample data: ${SAMPLE.spentUsd.toFixed(2)} of $
          {SAMPLE.capUsd.toFixed(2)} monthly cap used.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Wallet className="size-3.5 text-muted-foreground" aria-hidden="true" />
          API spend
        </span>
        <Badge variant="warning">Sample</Badge>
      </div>

      <p className="text-xs tabular-nums text-muted-foreground">
        <span className="font-medium text-foreground">
          ${SAMPLE.spentUsd.toFixed(2)}
        </span>{" "}
        of ${SAMPLE.capUsd.toFixed(2)} cap
      </p>

      {/*
        Native progress semantics via role + aria-value*, so the bar is
        announced as "14 percent" rather than as two empty divs.
      */}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Monthly API spend against cap (sample data)"
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className={cn("h-full rounded-full bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-[11px] text-muted-foreground">
        This calendar month · v{APP_VERSION}
      </p>
    </div>
  );
}
