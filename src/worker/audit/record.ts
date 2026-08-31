/**
 * What `audits.summary_json` actually holds.
 *
 * The column is one JSON document per audit, and it carries two different
 * kinds of thing: the finished **rollup** (`summary`, the shape the UI renders
 * and two audits are compared on) and the **operational state** needed to run
 * and explain the crawl (progress, the Lighthouse task id, the failure
 * message). Keeping them in one column rather than adding four is a deliberate
 * trade — the alternative is a migration per field the poller learns to track,
 * on a table whose columns are otherwise stable.
 *
 * They are kept in separate sub-objects rather than merged, so that:
 *
 *  - `summary` stays exactly the published `AuditSummary` contract, with
 *    nothing internal leaking into what the UI (and the comparison chips)
 *    read;
 *  - `json_extract(summary_json, '$.summary.score')` — the dashboard's
 *    latest-audit query — reads one number without hydrating the document;
 *  - a `null` summary is unambiguous: the crawl has not finished, as opposed to
 *    an empty rollup that would render as a perfect site with no issues.
 */
import type {
  AuditProgress,
  AuditSummary,
} from "../../shared/audits";

/** The parsed contents of `audits.summary_json`. */
export interface AuditRecord {
  /** The published rollup. Null until ingest completes. */
  summary: AuditSummary | null;
  /** Crawl progress from the last poll. Null before the first one. */
  progress: AuditProgress | null;
  /**
   * Why this audit failed, ready to show a user. Null on every other status.
   * Carries the upstream message where there is one — that is the only
   * actionable part of a crawl that refused to run.
   */
  error: string | null;
  /**
   * The machine-readable half of `error`, when the failure has one of our
   * canonical codes.
   *
   * Exists because a queue-posted crawl fails *after* the user's click has
   * been answered with a 202, so the error surfaces in the audit row rather
   * than as an HTTP status the SPA can switch on. `spend_cap_exceeded` and
   * `no_credentials` each have a specific CTA — raise the cap, add credentials
   * — and matching on prose would be the wrong way to choose between them.
   * Null when the failure has no code worth branching on.
   */
  errorCode: string | null;
  /**
   * The separate Lighthouse task posted for the homepage.
   *
   * Its lifecycle is independent of the crawl's — a different endpoint, a
   * different queue — but it is polled by the same `audit_poll` job, so the
   * handle lives with the audit rather than in the job payload, where a
   * re-enqueue could lose it.
   */
  lighthouseTaskId: string | null;
  /** Pages the crawl was allowed to fetch. Known at creation. */
  pagesLimit: number;
  /** Whether this crawl renders JavaScript. Known at creation. */
  renderJs: boolean;
}

/**
 * The record an audit starts life with, before anything has been polled.
 *
 * `pagesLimit` and `renderJs` are set here and never change: they are what was
 * *bought*, so a later edit to the defaults must not retroactively rewrite what
 * an old audit says it crawled.
 */
export function newAuditRecord(options: {
  pagesLimit: number;
  renderJs: boolean;
}): AuditRecord {
  return {
    summary: null,
    progress: null,
    error: null,
    errorCode: null,
    lighthouseTaskId: null,
    pagesLimit: options.pagesLimit,
    renderJs: options.renderJs,
  };
}

/**
 * Reads the column back into a record, tolerating anything.
 *
 * Defensive because this document is written by a job and read by a route:
 * a partially-ingested row, a document from an older shape, or `{}` (the
 * column default) must all produce a usable record rather than throwing on a
 * page view. Missing fields degrade to "not known yet", which is exactly what
 * they mean.
 */
export function readAuditRecord(raw: unknown): AuditRecord {
  const source =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const summary = source["summary"];
  const progress = source["progress"];
  const error = source["error"];
  const errorCode = source["errorCode"];
  const lighthouseTaskId = source["lighthouseTaskId"];
  const pagesLimit = source["pagesLimit"];
  const renderJs = source["renderJs"];

  return {
    summary: isObject(summary) ? (summary as unknown as AuditSummary) : null,
    progress: isObject(progress)
      ? (progress as unknown as AuditProgress)
      : null,
    error: typeof error === "string" ? error : null,
    errorCode: typeof errorCode === "string" ? errorCode : null,
    lighthouseTaskId:
      typeof lighthouseTaskId === "string" ? lighthouseTaskId : null,
    pagesLimit:
      typeof pagesLimit === "number" && Number.isFinite(pagesLimit)
        ? pagesLimit
        : 0,
    renderJs: renderJs === true,
  };
}

/** The record as the plain object Drizzle's json column expects. */
export function writeAuditRecord(record: AuditRecord): Record<string, unknown> {
  return { ...record } as unknown as Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
