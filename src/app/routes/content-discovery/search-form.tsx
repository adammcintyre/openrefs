/**
 * Topic + market + expansion — the three inputs that decide what gets bought.
 *
 * The Expansion select is the unusual one. Everywhere else in OpenRefs the
 * price of an action is a hint beside a button; here it is *inside the options*,
 * because the choice is the price: "Just this topic" buys one SERP and "+10
 * related" buys eleven. Putting the figure on each option means the comparison
 * happens while the menu is open, which is the only moment it can change the
 * decision.
 *
 * Local draft state, submitted explicitly. Every field here costs money to
 * change, so nothing fires on keystroke — the URL only moves when Discover is
 * pressed, and the form re-syncs when the URL changes underneath it (a shared
 * link, a browser Back).
 */
import { Compass } from "lucide-react";
import { useState } from "react";

import type { ContentExpand } from "../../../shared/content";
import { CONTENT_EXPAND_OPTIONS } from "../../../shared/content";
import { formatExpandCostHint } from "../../components/content/cost";
import { MarketSelects } from "../../components/domains/market-select";
import { Button, Card, Field, Input, Select } from "../../components/ui";
import type { ContentMarket, ContentSearch } from "./url-state";

export interface ContentSubmit extends ContentMarket {
  topic: string;
  expand: ContentExpand;
}

/**
 * What each expansion actually does, in the words of the thing it buys.
 *
 * "Related searches" and not "keyword ideas": the Worker expands via
 * `keyword_suggestions`, which phrase-matches the seed, rather than
 * `keyword_ideas`, which returns Google's ad-group neighbours and drags in
 * SERPs about a different subject entirely. The label should describe what the
 * user will actually get back.
 */
const EXPAND_LABELS: Record<number, string> = {
  0: "Just this topic",
  5: "+5 related searches",
  10: "+10 related searches",
};

export function ContentSearchForm({
  workspaceId,
  value,
  onSubmit,
  busy = false,
}: {
  workspaceId: string | null;
  value: ContentSearch;
  onSubmit: (next: ContentSubmit) => void;
  busy?: boolean;
}) {
  const [topic, setTopic] = useState(value.topic);
  const [market, setMarket] = useState<ContentMarket>({
    location: value.location,
    language: value.language,
  });
  const [expand, setExpand] = useState<ContentExpand>(value.expand);

  /*
   * Re-sync when the URL moves for a reason other than this form — Back,
   * a pasted link, the preset chip. Keyed on the search's own identity so
   * typing is never interrupted by a re-render.
   */
  const syncKey = `${value.topic}|${value.location}|${value.language}|${value.expand}`;
  const [syncedKey, setSyncedKey] = useState(syncKey);
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setTopic(value.topic);
    setMarket({ location: value.location, language: value.language });
    setExpand(value.expand);
  }

  const trimmed = topic.trim();

  return (
    <Card className="p-5">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed === "") return;
          onSubmit({ topic: trimmed, expand, ...market });
        }}
      >
        <div className="grid items-end gap-4 lg:grid-cols-[minmax(16rem,1fr)_minmax(13rem,auto)]">
          <Field
            label="Topic"
            hint="A subject, not a domain — we fetch its search results and work out which pages are winning."
          >
            {(field) => (
              <Input
                {...field}
                value={topic}
                placeholder="e.g. photo booth template"
                autoComplete="off"
                onChange={(event) => setTopic(event.target.value)}
              />
            )}
          </Field>

          <Field
            label="Expansion"
            hint="Each related search is another SERP bought, and another set of pages to compare."
          >
            {(field) => (
              <Select
                {...field}
                value={String(expand)}
                onChange={(event) =>
                  setExpand(Number(event.target.value) as ContentExpand)
                }
                disabled={busy}
              >
                {CONTENT_EXPAND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {`${EXPAND_LABELS[option] ?? `+${option} related`} · ${formatExpandCostHint(option)}`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid items-end gap-4 lg:grid-cols-[minmax(18rem,1fr)_auto]">
          <MarketSelects
            workspaceId={workspaceId}
            value={market}
            onChange={setMarket}
            disabled={busy}
            className="grid gap-4 sm:grid-cols-2"
          />

          <Button type="submit" loading={busy} disabled={trimmed === ""}>
            <Compass className="size-4" aria-hidden="true" />
            Discover
          </Button>
        </div>

        {/*
          The floor, restated outside the select for anyone who never opens it.
          "From", because the per-page enrichment on top scales with how many
          unique pages the SERPs turn out to hold — see components/content/cost.ts.
        */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {`This sweep costs ${formatExpandCostHint(expand)}, plus a fraction of a cent per unique page found for its Domain Score and traffic estimate. Filtering, sorting and paging the result afterwards are free.`}
        </p>
      </form>
    </Card>
  );
}
