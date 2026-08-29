/**
 * The small vocabulary this module repeats everywhere: an engine's name, and
 * the two verdicts a run produces.
 *
 * **Mentioned and cited are independent.** An assistant can describe your site
 * without linking it (mentioned, not cited) and can cite a page without naming
 * the brand (cited, not mentioned). They are rendered as two separate marks,
 * never as one combined status, because collapsing them would invent a
 * relationship the data does not have.
 *
 * **A tick is not the only positive.** `mentioned: false` is a real
 * measurement — the assistant answered and did not name you — and it renders
 * as a dash with a title saying exactly that. `null` means the engine has
 * never run, which is a different thing again and gets its own wording. The
 * same three-state care the rank tracking table takes over "no position".
 */
import { Check, Minus } from "lucide-react";

import type { AiEngineId } from "../../../shared/ai";
import { Badge } from "../ui";
import { engineLabel } from "./format";

/** An engine's name as a neutral badge. */
export function EngineBadge({
  engine,
  className = "",
}: {
  engine: AiEngineId;
  className?: string;
}) {
  return (
    <Badge variant="neutral" className={className}>
      {engineLabel(engine)}
    </Badge>
  );
}

/** A list of engine badges, for the prompts table's engines column. */
export function EngineBadges({
  engines,
}: {
  engines: ReadonlyArray<AiEngineId>;
}) {
  if (engines.length === 0) {
    return (
      <span
        className="text-xs text-muted-foreground italic"
        title="This prompt has no engines selected, so a run will skip it."
      >
        None
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1">
      {engines.map((engine) => (
        <EngineBadge key={engine} engine={engine} />
      ))}
    </span>
  );
}

/**
 * A tri-state verdict: yes, measured-no, or never-measured.
 *
 * `label` names the thing being reported ("Mentioned") so the accessible text
 * is a sentence rather than a bare tick — a screen reader announcing "check"
 * in a grid of ticks conveys nothing about which column it is in.
 */
export function VerdictMark({
  value,
  label,
  engine,
}: {
  value: boolean | null;
  label: string;
  engine?: AiEngineId;
}) {
  const suffix = engine === undefined ? "" : ` on ${engineLabel(engine)}`;

  if (value === null) {
    return (
      <span
        className="inline-flex text-muted-foreground"
        title={`Not run yet${suffix} — no answer has been recorded.`}
      >
        <span aria-hidden="true" className="text-xs italic">
          —
        </span>
        <span className="sr-only">{`${label}${suffix}: not run yet`}</span>
      </span>
    );
  }

  if (value) {
    return (
      <span
        className="inline-flex text-success"
        title={`${label}${suffix}: yes.`}
      >
        <Check className="size-4" aria-hidden="true" />
        <span className="sr-only">{`${label}${suffix}: yes`}</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex text-muted-foreground"
      title={`${label}${suffix}: no. The assistant answered without it.`}
    >
      <Minus className="size-4" aria-hidden="true" />
      <span className="sr-only">{`${label}${suffix}: no`}</span>
    </span>
  );
}

/**
 * The runs table's boolean columns, where a badge reads better than a mark
 * because the row is already dense with text.
 */
export function VerdictBadge({
  value,
  yes,
  no,
  title,
}: {
  value: boolean;
  yes: string;
  no: string;
  title?: string;
}) {
  return (
    <Badge variant={value ? "success" : "neutral"} title={title}>
      {value ? (
        <Check className="size-3" aria-hidden="true" />
      ) : (
        <Minus className="size-3" aria-hidden="true" />
      )}
      {value ? yes : no}
    </Badge>
  );
}
