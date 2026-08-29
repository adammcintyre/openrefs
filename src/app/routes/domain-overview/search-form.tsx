/**
 * The search bar: a domain and a market.
 *
 * Nothing here fetches on change. Every control edits a draft, and only
 * "Analyze" writes to the URL — which is what the queries watch. On a screen
 * where each query is billed, a select that fires a request on every keystroke
 * or arrow-key press would be a bill, not a convenience.
 */
import { Search } from "lucide-react";
import { useState } from "react";

import { MarketSelects } from "../../components/domains/market-select";
import {
  isLikelyDomain,
  normalizeDomainInput,
} from "../../components/domains/format";
import { Button, Card, Field, Input } from "../../components/ui";
import type { DomainSearch, Market } from "./url-state";
import { searchKey } from "./url-state";

export function DomainSearchForm({
  workspaceId,
  value,
  onSubmit,
  busy = false,
}: {
  workspaceId: string | null;
  /** The applied search — what the URL currently says. */
  value: DomainSearch;
  onSubmit: (next: { target: string } & Market) => void;
  busy?: boolean;
}) {
  const [target, setTarget] = useState(value.target);
  const [market, setMarket] = useState<Market>({
    location: value.location,
    language: value.language,
  });
  const [error, setError] = useState<string | undefined>(undefined);

  /*
   * Re-sync when the applied search changes from outside this form — the
   * Competitors tab's "Analyze" swaps the target, and browser Back changes it
   * too. Adjusting state during render (rather than in an effect) is React's
   * documented pattern for this and avoids rendering one frame of stale input.
   */
  const [syncedKey, setSyncedKey] = useState(() => searchKey(value));
  const currentKey = searchKey(value);
  if (currentKey !== syncedKey) {
    setSyncedKey(currentKey);
    setTarget(value.target);
    setMarket({ location: value.location, language: value.language });
    setError(undefined);
  }

  function submit() {
    // Trim and canonicalise here so a pasted URL becomes the hostname the API
    // is going to be asked about, and the address bar agrees with the heading.
    const normalized = normalizeDomainInput(target);
    if (normalized === "") {
      setError("Enter a domain to analyze.");
      return;
    }
    if (!isLikelyDomain(normalized)) {
      setError("That doesn't look like a domain. Try example.com.");
      return;
    }
    setError(undefined);
    setTarget(normalized);
    onSubmit({ target: normalized, ...market });
  }

  return (
    <Card className="p-4 sm:p-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="grid items-start gap-4 lg:grid-cols-[minmax(14rem,1fr)_minmax(18rem,1.4fr)_auto]"
      >
        <Field
          label="Domain"
          error={error}
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
              onChange={(event) => setTarget(event.target.value)}
            />
          )}
        </Field>

        <MarketSelects
          workspaceId={workspaceId}
          value={market}
          onChange={setMarket}
          disabled={busy}
          className="grid gap-4 sm:grid-cols-2"
        />

        <Button type="submit" loading={busy} className="lg:mt-6">
          <Search className="size-4" aria-hidden="true" />
          Analyze
        </Button>
      </form>
    </Card>
  );
}
