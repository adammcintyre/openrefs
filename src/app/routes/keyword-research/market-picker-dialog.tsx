/**
 * "Which market?" — asked only when the answer is genuinely unknown.
 *
 * A collection keyword stores the market it was saved in, but rows added before
 * that column existed carry `null`, and `src/shared/collections.ts` is explicit
 * about what that means: *unknown*, not "the default". Opening a SERP needs a
 * concrete location and language, so for those rows we ask rather than assume —
 * silently showing UK results for a keyword someone saved while researching the
 * US market would be a wrong answer presented as a real one.
 *
 * **A small Dialog rather than an anchored popover.** There is no popover
 * primitive in `components/ui` and no positioning library in the project, so a
 * true anchored one would be hand-rolled focus-trapping and outside-click
 * handling. `Dialog` already has both, plus Escape and focus restoration. At
 * `size="sm"` with one control it reads as the small ephemeral thing it is.
 *
 * The picker is seeded with the workspace's last-used market, because that is
 * the best available guess — offered as a default to accept or change, which is
 * a different thing from assuming it.
 */
import { useState } from "react";

import { MarketSelect } from "../../components/keywords/market-select";
import type { MarketSelection } from "../../components/keywords/market";
import { DEFAULT_MARKET, readStoredMarket } from "../../components/keywords/market";
import { Button, Dialog } from "../../components/ui";

export function MarketPickerDialog({
  open,
  keyword,
  workspaceId,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** The keyword whose SERP is about to open — named so the ask has context. */
  keyword: string;
  workspaceId: string | null;
  onClose: () => void;
  onConfirm: (market: MarketSelection) => void;
}) {
  const [market, setMarket] = useState<MarketSelection>(() =>
    workspaceId === null ? DEFAULT_MARKET : readStoredMarket(workspaceId),
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Which market?"
      description={`“${keyword}” was saved before collections recorded a market, so we don't know which one it was researched in. Search results differ by country and language — pick the market to look it up in.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(market)}>View SERP</Button>
        </>
      }
    >
      <MarketSelect
        workspaceId={workspaceId}
        market={market}
        onChange={setMarket}
      />
    </Dialog>
  );
}
