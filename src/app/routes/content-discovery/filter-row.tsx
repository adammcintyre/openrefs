/**
 * The filter row, and the preset that is the module's opinion.
 *
 * Unlike Gap Analysis's filter row, changing anything here is **free**: the
 * Worker applies these over a composition it already holds, so there is no
 * "each change is a new query" warning and no reason to make Apply feel
 * expensive. The row still has an explicit Apply rather than filtering on
 * keystroke, because each press does move the URL and issue a request — just a
 * free one.
 *
 * **The preset chip and its explanation both read
 * `CONTENT_PRESET_LOW_COMPETITION`.** Neither restates 30 or 500 as a literal,
 * so the chip, the sentence under it and the Worker cannot drift into
 * disagreeing about what "low competition" means.
 */
import { SlidersHorizontal, Wand2, X } from "lucide-react";
import { useState } from "react";

import { CONTENT_PRESET_LOW_COMPETITION } from "../../../shared/content";
import type {
  ContentFilterDraft,
  ContentFilters,
} from "../../components/content/filters";
import {
  EMPTY_CONTENT_DRAFT,
  EMPTY_CONTENT_FILTERS,
  NULL_SEMANTICS,
  activeContentFilterCount,
  isContentDraftEmpty,
  parseContentFilterDraft,
  toContentFilterDraft,
} from "../../components/content/filters";
import { formatCount } from "../../components/domains/format";
import { Badge, Button, Field, Input } from "../../components/ui";

/**
 * Whether the preset is what is currently applied.
 *
 * Compared field by field rather than by identity so that typing 30 and 500 by
 * hand lights the chip too — the chip describes a state, not a click.
 */
export function isPresetActive(filters: ContentFilters): boolean {
  return (
    filters.maxDomainScore === CONTENT_PRESET_LOW_COMPETITION.maxDomainScore &&
    filters.minTraffic === CONTENT_PRESET_LOW_COMPETITION.minTraffic
  );
}

export function ContentFilterRow({
  filters,
  onApply,
  disabled = false,
}: {
  filters: ContentFilters;
  onApply: (next: ContentFilters) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<ContentFilterDraft>(() =>
    toContentFilterDraft(filters),
  );

  // Re-sync when the filters move for a reason other than this form — the
  // preset chip, a pasted link, Back.
  const syncKey = JSON.stringify(filters);
  const [syncedKey, setSyncedKey] = useState(syncKey);
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey);
    setDraft(toContentFilterDraft(filters));
  }

  const filterCount = activeContentFilterCount(filters);
  const presetOn = isPresetActive(filters);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onApply(parseContentFilterDraft(draft));
      }}
      className="rounded-app border border-border bg-surface-muted p-4"
    >
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <p className="text-xs font-semibold text-foreground">Filters</p>
        {filterCount > 0 ? (
          <Badge variant="brand">{`${filterCount} active`}</Badge>
        ) : null}

        <Button
          type="button"
          size="sm"
          variant={presetOn ? "secondary" : "ghost"}
          disabled={disabled}
          aria-pressed={presetOn}
          onClick={() =>
            onApply(
              presetOn
                ? EMPTY_CONTENT_FILTERS
                : { ...filters, ...CONTENT_PRESET_LOW_COMPETITION },
            )
          }
          title={
            presetOn
              ? "Clear the preset and show every page again."
              : "Apply the starting point below."
          }
        >
          {presetOn ? (
            <X className="size-3.5" aria-hidden="true" />
          ) : (
            <Wand2 className="size-3.5" aria-hidden="true" />
          )}
          Low-competition winners
        </Button>
      </div>

      {/*
        The honest framing the shared constant's own doc comment asks for: this
        is a starting point, not a verdict. A Domain Score of 30 is not a line
        below which ranking is easy, and saying otherwise would be the single
        most misleading sentence we could put on this screen.
      */}
      <p className="pb-3 text-xs leading-relaxed text-muted-foreground">
        {`A starting point, not a verdict: Domain Score at most ${formatCount(
          CONTENT_PRESET_LOW_COMPETITION.maxDomainScore,
        )} and at least ${formatCount(
          CONTENT_PRESET_LOW_COMPETITION.minTraffic,
        )} estimated visits a month. There is no score below which ranking is easy — this just puts the pages worth a closer look at the top of a long list.`}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Max Domain Score" hint="The knob. Empty means no cap.">
          {(field) => (
            <Input
              {...field}
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              placeholder="e.g. 30"
              value={draft.maxDomainScore}
              disabled={disabled}
              title={NULL_SEMANTICS.maxDomainScore}
              onChange={(event) =>
                setDraft({ ...draft, maxDomainScore: event.target.value })
              }
            />
          )}
        </Field>

        <Field label="Min est. traffic">
          {(field) => (
            <Input
              {...field}
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="e.g. 500"
              value={draft.minTraffic}
              disabled={disabled}
              title={NULL_SEMANTICS.minTraffic}
              onChange={(event) =>
                setDraft({ ...draft, minTraffic: event.target.value })
              }
            />
          )}
        </Field>

        <Field label="URL contains">
          {(field) => (
            <Input
              {...field}
              value={draft.include}
              placeholder="e.g. /blog/"
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, include: event.target.value })
              }
            />
          )}
        </Field>

        <Field label="URL excludes">
          {(field) => (
            <Input
              {...field}
              value={draft.exclude}
              placeholder="e.g. pinterest"
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, exclude: event.target.value })
              }
            />
          )}
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" type="submit" disabled={disabled}>
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          Apply filters
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => {
            setDraft(EMPTY_CONTENT_DRAFT);
            onApply(EMPTY_CONTENT_FILTERS);
          }}
          disabled={disabled || (filterCount === 0 && isContentDraftEmpty(draft))}
        >
          Clear
        </Button>
        <p className="text-xs text-muted-foreground">
          Free to change — these are applied to results already fetched, not to a
          new search.
        </p>
      </div>
    </form>
  );
}
