/**
 * The ranking-keywords column: a count that opens into the keywords behind it.
 *
 * A native `<details>` rather than a custom popover or an expanded table row.
 * Three reasons, in order of how much they mattered:
 *
 *  1. **It is the only disclosure that works inside a `<td>` without fighting
 *     the table.** `DataTable` renders one `<tr>` per row and owns its markup;
 *     an expanding row would mean a second row type it does not have, and a
 *     floating popover would need positioning logic this codebase has no
 *     primitive for (there is no Radix, no Floating UI — see
 *     `components/ui/index.ts`).
 *  2. **It is keyboard-accessible and screen-reader-correct for free.**
 *     `<summary>` is focusable, toggles on Enter and Space, and announces its
 *     expanded state without a line of ARIA.
 *  3. **It renders open-able in SSR.** The smoke tests render this module with
 *     `renderToString`, so a JS-driven popover would be untestable there while
 *     the disclosure's contents are in the HTML.
 *
 * The count is the important number and stays visible; the keywords are
 * evidence for it, and evidence belongs one interaction away rather than
 * wrecking every row's height.
 */
import { ChevronRight } from "lucide-react";

import type { ContentPageKeyword } from "../../../shared/content";
import { formatCompact } from "../keywords/format";
import { EM_DASH } from "../domains/format";

export function KeywordsCell({
  keywords,
  /** For the accessible label — "3 keywords for /blog/booths". */
  label,
}: {
  keywords: ReadonlyArray<ContentPageKeyword>;
  label: string;
}) {
  if (keywords.length === 0) {
    return (
      <span
        className="text-muted-foreground"
        title="This page was found on no keyword we searched — which should not happen, and is worth reporting."
      >
        {EM_DASH}
      </span>
    );
  }

  return (
    <details className="group">
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded-app px-1 py-0.5 tabular-nums transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden"
        aria-label={`${keywords.length} ranking keyword${keywords.length === 1 ? "" : "s"} for ${label}`}
      >
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {keywords.length}
      </summary>

      {/*
        A definition-style list rather than a nested <table>: a table inside a
        table cell is legal but confuses screen-reader table navigation, and
        this is three fields per keyword, not a grid worth navigating.
      */}
      <ul className="mt-2 flex min-w-56 flex-col gap-1.5 border-l border-border pl-3">
        {keywords.map((entry) => (
          <li
            key={entry.keyword}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs"
          >
            <span className="text-foreground">{entry.keyword}</span>
            {/*
              Compact volumes ("1.3K"), not full ones ("1,300"): this list sits
              inside a table cell beside the keyword itself, and the extra three
              characters per row are what push a two-word keyword onto a second
              line. Precision is not the job here — the ordering is.
            */}
            <span className="tabular-nums text-muted-foreground">
              {`#${entry.position} · ${formatCompact(entry.volume)}/mo`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
