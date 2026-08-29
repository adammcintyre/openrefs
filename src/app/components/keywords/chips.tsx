/**
 * The small labelled pills the keyword surfaces share.
 *
 * `CostChip` is the one with a product decision behind it. Every
 * DataForSEO-backed response carries what it cost, and we show it rather than
 * hide it: this is a bring-your-own-key tool, the money is the user's, and a
 * composed overview really does cost about eleven cents. Surfacing that lets
 * someone form an accurate model of what their clicking costs — and makes the
 * cache visibly worth something, because the same query a second time is free.
 */
import { Database, Zap } from "lucide-react";

import type { ResultMeta } from "../../../shared/api";
import { Badge } from "../ui";
import { difficultyBand, formatCost, formatIntent, intentVariant } from "./format";

/**
 * "Cached" or "$0.114 live".
 *
 * Cached results are neutral and quiet; a live one is tinted and carries its
 * price, because that is the case where something was spent.
 */
export function CostChip({
  meta,
  className = "",
}: {
  meta: Pick<ResultMeta, "costUsd" | "cached"> | undefined;
  className?: string;
}) {
  if (meta === undefined) return null;

  if (meta.cached) {
    return (
      <Badge
        variant="neutral"
        className={className}
        title="Served from this workspace's cache — no DataForSEO call was made."
      >
        <Database className="size-3" aria-hidden="true" />
        Cached
      </Badge>
    );
  }

  return (
    <Badge
      variant="info"
      className={className}
      title="Fetched live from DataForSEO and billed to your account."
    >
      <Zap className="size-3" aria-hidden="true" />
      {formatCost(meta.costUsd)} live
    </Badge>
  );
}

/**
 * An up-front price hint for an action that is about to spend, e.g. a SERP
 * refresh. Plain text rather than a badge — it sits beside a button as part of
 * its label, not as a status.
 */
export function CostHint({ costUsd }: { costUsd: number | null }) {
  return (
    <span className="text-xs text-muted-foreground">
      {costUsd === null
        ? "Fetches a live result and bills your DataForSEO account."
        : `Costs about ${formatCost(costUsd)}.`}
    </span>
  );
}

/**
 * Keyword difficulty as a 0–100 number plus its band.
 *
 * Both halves are deliberate: the number is what an experienced user compares
 * across keywords, the word is what makes it legible to everyone else, and
 * neither depends on the colour being perceived.
 */
export function DifficultyBadge({ value }: { value: number | null | undefined }) {
  const band = difficultyBand(value);

  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <span className="text-muted-foreground" title="Not reported">
        {band.label}
      </span>
    );
  }

  return (
    <Badge variant={band.variant} title={`Keyword difficulty ${Math.round(value)} of 100`}>
      <span className="tabular-nums">{Math.round(value)}</span>
      <span className="font-normal opacity-80">{band.label}</span>
    </Badge>
  );
}

/** Search intent, or an em dash when DataForSEO did not classify it. */
export function IntentBadge({ intent }: { intent: string | null | undefined }) {
  if (intent === null || intent === undefined || intent === "") {
    return (
      <span className="text-muted-foreground" title="Not reported">
        {formatIntent(intent)}
      </span>
    );
  }
  return <Badge variant={intentVariant(intent)}>{formatIntent(intent)}</Badge>;
}
