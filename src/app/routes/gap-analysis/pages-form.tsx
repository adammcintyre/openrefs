/**
 * The pages view's input: a paste box of URLs, plus the market.
 *
 * A textarea rather than the chip-per-entry control the competitor list uses,
 * because the input is different in kind. Competitors are three or four
 * hostnames someone types from memory; compared pages are up to twenty absolute
 * URLs that arrive by copy-paste from a SERP, a sitemap or a spreadsheet — one
 * per line, already in a block. A control that made you add them one at a time
 * would be twenty interactions to do what one paste does.
 *
 * Parsing runs on submit only. Every URL added is part of one upstream call, so
 * nothing here fires while you type.
 */
import { Layers } from "lucide-react";
import { useState } from "react";

import { GAP_MAX_PAGES } from "../../../shared/gap";
import { MarketSelects } from "../../components/domains/market-select";
import { Button, Card, Field } from "../../components/ui";
import type { GapMarket, GapSearch } from "./url-state";
import { gapPagesKey, parsePageList } from "./url-state";

export interface GapPagesSubmit extends GapMarket {
  pages: string[];
}

export function GapPagesForm({
  workspaceId,
  value,
  onSubmit,
  busy = false,
}: {
  workspaceId: string | null;
  value: GapSearch;
  onSubmit: (next: GapPagesSubmit) => void;
  busy?: boolean;
}) {
  const [raw, setRaw] = useState(value.pages.join("\n"));
  const [market, setMarket] = useState<GapMarket>({
    location: value.location,
    language: value.language,
  });
  const [error, setError] = useState<string | undefined>(undefined);

  // Re-sync when the applied comparison changes from outside this form.
  const [syncedKey, setSyncedKey] = useState(() => gapPagesKey(value));
  const currentKey = gapPagesKey(value);
  if (currentKey !== syncedKey) {
    setSyncedKey(currentKey);
    setRaw(value.pages.join("\n"));
    setMarket({ location: value.location, language: value.language });
    setError(undefined);
  }

  const parsed = parsePageList(raw);

  function submit() {
    if (parsed.length === 0) {
      setError(
        "Paste at least one full page URL, including https:// — this compares exact pages, not domains.",
      );
      return;
    }
    setError(undefined);
    onSubmit({ pages: parsed, ...market });
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
        <Field
          label="Pages to compare"
          error={error}
          hint={`One full URL per line, up to ${GAP_MAX_PAGES}. These are compared as exact pages — a trailing slash or a query string is part of the address.`}
        >
          {(field) => (
            <textarea
              {...field}
              value={raw}
              rows={4}
              spellCheck={false}
              disabled={busy}
              placeholder={"https://example.com/guide\nhttps://rival.com/guide"}
              aria-invalid={error !== undefined || undefined}
              className="w-full rounded-app border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground transition-colors placeholder:text-muted-foreground hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid]:border-danger"
              onChange={(event) => {
                setRaw(event.target.value);
                setError(undefined);
              }}
            />
          )}
        </Field>

        {/*
          Counted from the parsed list rather than from line count, so the
          number reflects what will actually be compared — blank lines, repeats
          and anything that is not an http(s) URL are dropped silently, and this
          is where that becomes visible.
        */}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {parsed.length === 0
            ? "No valid URLs yet."
            : `${parsed.length} of ${GAP_MAX_PAGES} page${parsed.length === 1 ? "" : "s"} ready to compare.${
                parsed.length === 1
                  ? " One page is a valid question — what does it rank for? — but the view is built for comparing several."
                  : ""
              }`}
        </p>

        <div className="grid items-end gap-4 lg:grid-cols-[minmax(18rem,1fr)_auto]">
          <MarketSelects
            workspaceId={workspaceId}
            value={market}
            onChange={setMarket}
            disabled={busy}
            className="grid gap-4 sm:grid-cols-2"
          />

          <Button type="submit" loading={busy}>
            <Layers className="size-4" aria-hidden="true" />
            Compare pages
          </Button>
        </div>
      </form>
    </Card>
  );
}
