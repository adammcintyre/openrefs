/**
 * The drill-down: one prompt × engine × day, in full.
 *
 * No fetch. The results payload already carries `responseExcerpt` and
 * `citations` on every row of `latest`, so opening this is instant and costs
 * nothing — which is why it is a dialog over the table rather than a route
 * that would re-request the window.
 *
 * Two things here are handling third-party text, and both are handled the way
 * SerpPanel handles a SERP result:
 *
 * - **The excerpt is rendered as text, never as markup.** It is an LLM's
 *   output. Highlighting is done by splitting it into React text nodes
 *   (`highlightSegments`), so the mark-up is ours and the content is escaped
 *   by React as a matter of course. There is no `dangerouslySetInnerHTML`
 *   anywhere in this file, and there must never be.
 * - **A citation URL is scheme-checked before it becomes an href.** Anything
 *   that is not http(s) — the contract flags these with a null `host` —
 *   renders as plain, unlinked text rather than being dropped, because the
 *   fact that the assistant cited something unusual is itself information.
 */
import { ExternalLink, Quote } from "lucide-react";

import type { AiCitation, AiSnapshotDetail } from "../../../shared/ai";
import { Badge, Dialog, cn } from "../ui";
import {
  citationLabel,
  engineLabel,
  formatDay,
  formatSpend,
  highlightSegments,
  pluralCitations,
  safeHttpUrl,
} from "./format";
import { VerdictBadge } from "./verdicts";

export function SnapshotDialog({
  snapshot,
  promptText,
  domain,
  onClose,
}: {
  /** Null closes the dialog — the caller keeps the selected row in state. */
  snapshot: AiSnapshotDetail | null;
  promptText: string;
  domain: string;
  onClose: () => void;
}) {
  if (snapshot === null) return null;

  const ours = snapshot.citations.filter((citation) => citation.ours);

  return (
    <Dialog
      open
      onClose={onClose}
      title={promptText}
      description={`${engineLabel(snapshot.engine)} · ${formatDay(snapshot.date)}`}
      size="lg"
    >
      <div className="flex flex-col gap-5">
        {/* What this one answer was and what it cost. */}
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge
            value={snapshot.mentioned}
            yes="Mentioned"
            no="Not mentioned"
            title={`Whether the answer named ${domain}.`}
          />
          <VerdictBadge
            value={snapshot.cited}
            yes="Cited"
            no="Not cited"
            title={`Whether the answer linked ${domain} as a source.`}
          />
          <span
            className="text-xs text-muted-foreground"
            // The real charge, not the estimate the run was quoted at.
            title="What DataForSEO charged for this answer."
          >
            {formatSpend(snapshot.costUsd)}
          </span>
          {snapshot.model !== null ? (
            <span
              className="text-xs text-muted-foreground"
              title="The model version that actually answered."
            >
              {snapshot.model}
            </span>
          ) : null}
        </div>

        {/* The answer. */}
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Quote className="size-3.5" aria-hidden="true" />
            Answer excerpt
          </h3>
          <Excerpt
            text={snapshot.responseExcerpt}
            terms={snapshot.mentionTerms}
          />
          <p className="text-xs text-muted-foreground">
            Up to 2,000 characters of the answer, centred on the mention where
            there was one.
          </p>
        </section>

        {/* The sources. */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {`Sources · ${pluralCitations(snapshot.citations.length)}${
              ours.length > 0 ? ` · ${ours.length} yours` : ""
            }`}
          </h3>
          {snapshot.citations.length === 0 ? (
            <p className="rounded-app border border-border bg-surface-muted px-3 py-2.5 text-sm text-muted-foreground">
              This answer cited no sources.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {snapshot.citations.map((citation, index) => (
                <CitationRow
                  key={`${citation.url}-${index}`}
                  citation={citation}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/**
 * The excerpt, with the mention terms marked.
 *
 * `<mark>` rather than a styled span: the highlight carries meaning, and the
 * element is what says so to a screen reader. Tailwind's reset leaves `mark`
 * with the browser's yellow, which fails contrast in dark mode, so the tint
 * pair from the theme is applied explicitly.
 */
function Excerpt({
  text,
  terms,
}: {
  text: string;
  terms: ReadonlyArray<string>;
}) {
  if (text === "") {
    return (
      <p className="rounded-app border border-border bg-surface-muted px-3 py-2.5 text-sm text-muted-foreground">
        No answer text was stored for this run.
      </p>
    );
  }

  const segments = highlightSegments(text, terms);

  return (
    <p className="max-h-80 overflow-y-auto rounded-app border border-border bg-surface-muted px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-sm bg-tint px-0.5 font-medium text-tint-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * One source.
 *
 * Own-site citations are badged and tinted — they are the finding, and in a
 * list of ten sources the one that is yours should not need hunting for.
 */
function CitationRow({ citation }: { citation: AiCitation }) {
  const href = safeHttpUrl(citation.url);
  const label = citationLabel(citation);

  return (
    <li
      className={cn(
        "flex flex-col gap-0.5 rounded-app border px-3 py-2",
        citation.ours
          ? "border-primary/40 bg-tint"
          : "border-border bg-surface",
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "text-sm font-medium",
            citation.ours ? "text-tint-foreground" : "text-foreground",
          )}
        >
          {label}
        </span>
        {citation.ours ? (
          <Badge variant="brand" title="This source is your own site.">
            Your site
          </Badge>
        ) : null}
      </span>

      {href === null ? (
        /*
          Not a link, on purpose. A non-http(s) URL in an href is a scheme we
          have not vetted; showing it as text still tells the user what was
          cited.
        */
        <span
          className="text-xs break-all text-muted-foreground"
          title="Not a web link, so it is shown as text."
        >
          {citation.url}
        </span>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-start gap-1 text-xs break-all text-primary underline-offset-2 hover:underline"
        >
          {citation.url}
          <ExternalLink
            className="mt-0.5 size-3 shrink-0"
            aria-hidden="true"
          />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </li>
  );
}
