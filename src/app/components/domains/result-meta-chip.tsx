/**
 * The "where did this data come from, and what did it cost" chip.
 *
 * It sits next to every result set for two reasons. The obvious one is that
 * users bring their own DataForSEO key and are entitled to see what a screen
 * spent. The less obvious one is that "cached" is the answer to "why are these
 * numbers the same as yesterday's" — without it, server-side caching looks
 * like a stale UI.
 */
import type { ResultMeta } from "../../../shared/api";
import { Badge } from "../ui";
import { costChipTitle, formatCostChip } from "./format";

export function ResultMetaChip({
  meta,
  className = "",
}: {
  meta: ResultMeta | null | undefined;
  className?: string;
}) {
  if (meta === null || meta === undefined) return null;
  return (
    <Badge
      variant={meta.cached ? "neutral" : "info"}
      title={costChipTitle(meta)}
      className={className}
    >
      {formatCostChip(meta)}
    </Badge>
  );
}
