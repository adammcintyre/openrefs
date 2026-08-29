/**
 * The search bar: one target, no market.
 *
 * There is no location or language select here and that is not an omission — a
 * link profile is a property of the web rather than of a search market, and
 * none of the `/backlinks/*` endpoints accepts a location code. Offering a
 * market picker would imply the numbers change with it.
 *
 * Nothing fetches on change. The input edits a draft and only "Analyze" writes
 * to the URL, which is what the queries watch. On a screen where every query is
 * billed, a control that fires on keystroke is a bill, not a convenience.
 */
import { Search } from "lucide-react";
import { useState } from "react";

import {
  isLikelyTarget,
  normalizeTarget,
  targetKind,
} from "../../components/backlinks/target";
import { Button, Card, Field, Input } from "../../components/ui";

export function BacklinksSearchForm({
  value,
  onSubmit,
  busy = false,
}: {
  /** The applied target — what the URL currently says. */
  value: string;
  onSubmit: (target: string) => void;
  busy?: boolean;
}) {
  const [target, setTarget] = useState(value);
  const [error, setError] = useState<string | undefined>(undefined);

  /*
   * Re-sync when the applied target changes from outside this form — the
   * Referring domains tab's "Analyze" swaps it, and browser Back changes it
   * too. Adjusting state during render, rather than in an effect, is React's
   * documented pattern for this and avoids one frame of stale input.
   */
  const [syncedTarget, setSyncedTarget] = useState(value);
  if (value !== syncedTarget) {
    setSyncedTarget(value);
    setTarget(value);
    setError(undefined);
  }

  function submit() {
    const normalized = normalizeTarget(target);
    if (normalized === "") {
      setError("Enter a domain or page URL to analyze.");
      return;
    }
    if (!isLikelyTarget(normalized)) {
      setError(
        "That doesn't look like a domain or a URL. Try example.com or https://example.com/page.",
      );
      return;
    }
    setError(undefined);
    // Show the canonical form immediately, so the field agrees with the
    // heading and with the string the query is about to run against.
    setTarget(normalized);
    onSubmit(normalized);
  }

  const applied = normalizeTarget(target);
  const hint =
    applied !== "" && isLikelyTarget(applied) && targetKind(applied) === "url"
      ? "Analyzing one page: only links pointing at this exact URL are counted."
      : "A whole domain, including its subdomains. Paste a full URL to analyze a single page instead.";

  return (
    <Card className="p-4 sm:p-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto]"
      >
        <Field label="Domain or page URL" error={error} hint={hint}>
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

        <Button type="submit" loading={busy} className="sm:mt-6">
          <Search className="size-4" aria-hidden="true" />
          Analyze
        </Button>
      </form>
    </Card>
  );
}
