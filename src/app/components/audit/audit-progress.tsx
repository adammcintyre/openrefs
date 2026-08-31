/**
 * The waiting state — and, since audits became queue-backed, there are now two
 * of them.
 *
 * Creating an audit no longer posts the task to DataForSEO inline. It inserts a
 * `pending` row and enqueues an `audit_post` job, so that a tarpit on their side
 * costs a retry rather than the user's click (docs/specs/PHASE7.md). That opens
 * a window — the first minute or two — in which the audit exists, has no crawl
 * task, and nothing at all is happening on DataForSEO's side yet.
 *
 * The old copy said "queued with DataForSEO", which in that window is simply
 * untrue: we have not told them about it. The distinction matters to anyone
 * reading it, because the two states fail differently — a queued audit can still
 * be refused for a spend cap or missing credentials, and a crawling one cannot.
 *
 * So there are three renderings, in order of how much we know:
 *
 *   pending, no progress   "queued — the crawler starts shortly"
 *   running, no progress   waiting on the first poll of their queue
 *   running, with progress a real bar: "48 of 250 pages"
 *
 * What it never does is show a determinate bar built from a guess.
 */
import { KeyRound, Loader, WalletMinimal } from "lucide-react";

import type { AuditProgress, AuditStatus } from "../../../shared/audits";
import { LinkButton } from "../keywords/link-button";
import { Card } from "../ui";
import { pluralPages } from "./format";

/** The settings screens a queue-side refusal points at. */
const DATA_PROVIDER_PATH = "/app/settings/data-provider";
const GENERAL_SETTINGS_PATH = "/app/settings";

export function AuditProgressCard({
  progress,
  pagesLimit,
  domain,
  /**
   * The audit's own status.
   *
   * Optional so the component keeps working for any caller that has not been
   * updated, defaulting to the state it used to assume. `pending` is the new
   * one: the row exists, the job has not yet bought the crawl.
   */
  status = "running",
}: {
  progress: AuditProgress | null;
  pagesLimit: number;
  domain: string;
  status?: AuditStatus;
}) {
  /*
   * The denominator is the crawl's own limit when the poll has told us one,
   * and the requested ceiling otherwise. Never zero: a bar dividing by zero
   * renders as NaN% wide, which in practice means full.
   */
  const limit = Math.max(1, progress?.pagesLimit || pagesLimit || 1);
  const crawled = progress?.pagesCrawled ?? 0;
  const percent =
    progress === null ? null : Math.min(100, Math.round((crawled / limit) * 100));

  /*
   * Queued means *our* queue. A pending audit that has somehow reported
   * progress is already crawling whatever its status column says, so the
   * progress bar wins — the numbers are the stronger evidence.
   */
  const queued = status === "pending" && progress === null;

  return (
    <Card className="flex flex-col gap-3 p-5" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Loader className="size-4 animate-spin" aria-hidden="true" />
        {queued ? `Queued: ${domain}` : `Crawling ${domain}`}
      </p>

      {queued ? (
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {`This audit is queued — the crawler starts shortly. We hand ${pluralPages(
            pagesLimit,
          )} to DataForSEO in the next minute or two, retrying by itself if they are busy, and the crawl begins as soon as they accept it.`}
        </p>
      ) : percent === null ? (
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The crawl has been accepted by DataForSEO and is starting. This page
          updates itself — most audits finish in one to three minutes.
        </p>
      ) : (
        <>
          {/*
            A native <progress>: it announces its own value, respects forced
            colours, and needs no ARIA. The text beside it repeats the numbers
            because a bar alone is not a page count.
          */}
          <progress
            value={crawled}
            max={limit}
            className="h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-surface-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
          >
            {`${percent}%`}
          </progress>
          <p className="text-sm text-muted-foreground tabular-nums">
            {`${crawled.toLocaleString("en")} of ${pluralPages(limit)} crawled`}
            {progress !== null && progress.pagesInQueue > 0
              ? ` · ${progress.pagesInQueue.toLocaleString("en")} in queue`
              : ""}
          </p>
        </>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        You can leave this page — the crawl runs on DataForSEO's side and the
        result is stored when it lands.
      </p>
    </Card>
  );
}

/**
 * Why an audit failed, and what to do about it.
 *
 * **Switches on `errorCode`, never on the message prose.** A crawl is now
 * bought by a background job, *after* the user's click was already answered
 * with a 202, so a refusal cannot arrive as an HTTP status the SPA can branch
 * on — it arrives as a code on the audit row. Matching on the human-readable
 * message instead would break the moment that message is reworded, and the two
 * codes that matter have genuinely different fixes:
 *
 *   spend_cap_exceeded  the cap did its job → Settings, General
 *   no_credentials      no DataForSEO key on this workspace → Data Provider
 *
 * Anything else — an upstream timeout, a crawl that died mid-flight — is a
 * fault with no button to press, so it keeps the plain explanation and the
 * standing reassurance that re-running is safe.
 */
export function AuditFailureNotice({
  error,
  errorCode,
}: {
  error: string | null;
  /** Absent means "no code", not "no error". Optional and additive. */
  errorCode?: string | null;
}) {
  const known =
    errorCode === "spend_cap_exceeded"
      ? {
          Icon: WalletMinimal,
          title: "Monthly spend cap reached",
          body: "This workspace hit its DataForSEO spend cap before the crawl could be bought, so nothing was spent and nothing was crawled. Raise the cap — or wait for next month — and run it again.",
          action: (
            <LinkButton to={GENERAL_SETTINGS_PATH} variant="secondary" size="sm">
              Review spend cap
            </LinkButton>
          ),
        }
      : errorCode === "no_credentials"
        ? {
            Icon: KeyRound,
            title: "No DataForSEO credentials",
            body: "The crawl could not be bought because this workspace has no DataForSEO key. Add one and run the audit again — nothing was spent.",
            action: (
              <LinkButton to={DATA_PROVIDER_PATH} size="sm">
                Add API credentials
              </LinkButton>
            ),
          }
        : null;

  if (known === null) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-app border border-danger-subtle bg-danger-subtle p-4 text-danger-on-subtle"
      >
        <p className="text-sm font-semibold">This audit failed</p>
        <p className="text-sm leading-relaxed">
          {error ?? "DataForSEO did not say why the crawl could not complete."}
        </p>
        <p className="text-sm leading-relaxed">
          Nothing was ingested for it. Running a new audit is safe — you are only
          charged for pages that are actually crawled.
        </p>
      </div>
    );
  }

  const { Icon, title, body, action } = known;

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-app border border-warning-subtle bg-warning-subtle p-4 text-warning-on-subtle"
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4" aria-hidden="true" />
        {title}
      </p>
      <p className="max-w-2xl text-sm leading-relaxed">{body}</p>
      <div>{action}</div>
    </div>
  );
}
