/**
 * The search bar: you, up to four rivals, and a market.
 *
 * Nothing here fetches on change. Every control edits a draft and only
 * "Compare" writes to the URL — which is what the query watches. That matters
 * more on this screen than anywhere else in the app: one comparison is one
 * upstream call *per competitor*, so a select that fired on every keystroke
 * would not be a convenience, it would be a bill.
 */
import { GitCompareArrows } from "lucide-react";
import { useState } from "react";

import {
  isLikelyDomain,
  normalizeDomainInput,
} from "../../components/domains/format";
import { MarketSelects } from "../../components/domains/market-select";
import { CompetitorInput } from "../../components/gap/competitor-input";
import { Button, Card, Field, Input } from "../../components/ui";
import type { GapMarket, GapSearch } from "./url-state";
import { gapSearchKey } from "./url-state";

export interface GapSubmit extends GapMarket {
  target: string;
  competitors: string[];
}

export function GapSearchForm({
  workspaceId,
  value,
  onSubmit,
  busy = false,
}: {
  workspaceId: string | null;
  /** The applied search — what the URL currently says. */
  value: GapSearch;
  onSubmit: (next: GapSubmit) => void;
  busy?: boolean;
}) {
  const [target, setTarget] = useState(value.target);
  const [competitors, setCompetitors] = useState<string[]>(value.competitors);
  const [market, setMarket] = useState<GapMarket>({
    location: value.location,
    language: value.language,
  });
  const [targetError, setTargetError] = useState<string | undefined>(undefined);
  const [competitorError, setCompetitorError] = useState<string | undefined>(
    undefined,
  );

  /*
   * Re-sync when the applied search changes from outside this form — browser
   * Back, or a link that arrived with competitors already in it. Adjusting
   * state during render is React's documented pattern for this and avoids
   * rendering one frame of stale inputs.
   */
  const [syncedKey, setSyncedKey] = useState(() => gapSearchKey(value));
  const currentKey = gapSearchKey(value);
  if (currentKey !== syncedKey) {
    setSyncedKey(currentKey);
    setTarget(value.target);
    setCompetitors(value.competitors);
    setMarket({ location: value.location, language: value.language });
    setTargetError(undefined);
    setCompetitorError(undefined);
  }

  function submit() {
    // Canonicalise here so the string in `?target=` is the one the query will
    // actually run against, and the heading agrees with the address bar.
    const normalized = normalizeDomainInput(target);

    if (normalized === "") {
      setTargetError("Enter your domain.");
      return;
    }
    if (!isLikelyDomain(normalized)) {
      setTargetError("That doesn't look like a domain. Try example.com.");
      return;
    }
    if (competitors.length === 0) {
      setTargetError(undefined);
      setCompetitorError("Add at least one competitor to compare against.");
      return;
    }

    setTargetError(undefined);
    setCompetitorError(undefined);
    setTarget(normalized);
    onSubmit({ target: normalized, competitors, ...market });
  }

  return (
    <Card className="p-4 sm:p-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Field
            label="Your domain"
            error={targetError}
            hint="A full URL works — it is reduced to the hostname."
          >
            {(field) => (
              <Input
                {...field}
                value={target}
                placeholder="example.com"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                onChange={(event) => {
                  setTarget(event.target.value);
                  setTargetError(undefined);
                }}
              />
            )}
          </Field>

          <CompetitorInput
            competitors={competitors}
            onChange={(next) => {
              setCompetitors(next);
              setCompetitorError(undefined);
            }}
            target={target}
            disabled={busy}
            error={competitorError}
          />
        </div>

        <div className="grid items-end gap-4 lg:grid-cols-[minmax(18rem,1fr)_auto]">
          <MarketSelects
            workspaceId={workspaceId}
            value={market}
            onChange={setMarket}
            disabled={busy}
            className="grid gap-4 sm:grid-cols-2"
          />

          <Button type="submit" loading={busy}>
            <GitCompareArrows className="size-4" aria-hidden="true" />
            Compare
          </Button>
        </div>
      </form>
    </Card>
  );
}
