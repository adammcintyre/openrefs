import { Dialog } from "./ui/dialog";
import { EmptyState } from "./ui/empty-state";

/**
 * The shared "who ranks for this keyword" view, opened from any keyword table
 * (Keyword Research tabs, Domain Overview keywords, later Gap Analysis).
 *
 * This file is OWNED by the Keyword Research UI agent, which replaces the body
 * with the real implementation (GET /api/v1/keywords/serp via TanStack Query,
 * refresh with fresh=true + cost hint). Other modules import it against these
 * frozen props — change the implementation freely, never the props without
 * checking every call site.
 */
export interface SerpPanelProps {
  workspaceId: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  open: boolean;
  onClose: () => void;
}

export function SerpPanel({ keyword, open, onClose }: SerpPanelProps) {
  return (
    <Dialog open={open} onClose={onClose} title={`SERP: ${keyword}`} size="lg">
      <EmptyState
        title="SERP view under construction"
        description="The live results panel ships with the Keyword Research module."
      />
    </Dialog>
  );
}
