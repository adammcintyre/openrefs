/**
 * The competitor set, as chips.
 *
 * Chips rather than a comma-separated text box because the set is priced per
 * entry: each chip is one more DataForSEO call per query, so each one should be
 * visible, countable and removable on its own. The rules live in
 * `competitors.ts`; this file is the surface over them.
 *
 * **Enter adds a chip, it does not submit the search.** This control sits
 * inside the search `<form>`, and a keystroke that ran the whole comparison
 * while the user was still listing rivals would spend money a competitor early.
 */
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Field, Input } from "../ui";
import type { CompetitorRejection } from "./competitors";
import {
  GAP_MAX_COMPETITORS,
  addCompetitor,
  competitorRejectionMessage,
  parseCompetitorList,
  removeCompetitor,
} from "./competitors";

export function CompetitorInput({
  competitors,
  onChange,
  target,
  disabled = false,
  /** Set by the form when a submit was attempted with an empty set. */
  error,
}: {
  competitors: ReadonlyArray<string>;
  onChange: (competitors: string[]) => void;
  /** The "you" domain, so a competitor cannot be the target itself. */
  target: string;
  disabled?: boolean;
  error?: string;
}) {
  const [draft, setDraft] = useState("");
  const [rejection, setRejection] = useState<CompetitorRejection | null>(null);

  const full = competitors.length >= GAP_MAX_COMPETITORS;

  function commit() {
    /*
     * A pasted "a.com, b.com" is treated as the list it obviously is rather
     * than as one malformed hostname — but only when it really does contain a
     * separator, so a single typo still gets its specific error message.
     */
    if (/[,\s]/.test(draft.trim())) {
      const parsed = parseCompetitorList(draft, target);
      const merged = [...competitors];
      for (const domain of parsed) {
        if (merged.length >= GAP_MAX_COMPETITORS) break;
        if (!merged.includes(domain)) merged.push(domain);
      }
      if (merged.length === competitors.length) {
        setRejection(full ? "full" : "invalid");
        return;
      }
      onChange(merged);
      setDraft("");
      setRejection(null);
      return;
    }

    const result = addCompetitor(competitors, draft, target);
    if (result.rejected !== null) {
      setRejection(result.rejected);
      return;
    }
    onChange(result.competitors);
    setDraft("");
    setRejection(null);
  }

  function drop(domain: string) {
    onChange(removeCompetitor(competitors, domain));
    setRejection(null);
  }

  const message =
    rejection !== null ? competitorRejectionMessage(rejection) : error;

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Competitors"
        error={message}
        hint={
          message === undefined
            ? `${competitors.length} of ${GAP_MAX_COMPETITORS}. Each competitor is one more DataForSEO call per query.`
            : undefined
        }
      >
        {(field) => (
          <div className="flex gap-2">
            <Input
              {...field}
              value={draft}
              placeholder={full ? "Remove one to add another" : "competitor.com"}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled || full}
              onChange={(event) => {
                setDraft(event.target.value);
                setRejection(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                // See the file header: Enter is "add a chip", never "search".
                event.preventDefault();
                commit();
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={commit}
              disabled={disabled || full || draft.trim() === ""}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add
            </Button>
          </div>
        )}
      </Field>

      {competitors.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Competitors to compare">
          {competitors.map((domain) => (
            <li key={domain}>
              <Badge variant="brand" className="gap-1 pr-1">
                <span>{domain}</span>
                <button
                  type="button"
                  onClick={() => drop(domain)}
                  disabled={disabled}
                  aria-label={`Remove ${domain}`}
                  className="rounded-app p-0.5 transition-colors hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
