/**
 * `audit_poll` — waits for the crawl `POST /projects/:id/audits` bought, then
 * turns it into an audit.
 *
 * The same shape as `rank_collect`, for the same reasons: polling is free, so
 * the cost of this job is patience and subrequests rather than money, and it
 * re-enqueues itself with a backoff instead of blocking a Worker invocation on
 * a crawl that takes minutes.
 *
 * Three things are specific to audits and worth stating before reading on:
 *
 *  1. **Two task lifecycles, one job.** The crawl and the homepage Lighthouse
 *     run are separate upstream tasks on separate queues. Folding both into
 *     this job keeps the audit atomic from the product's point of view — one
 *     row, one status — at the cost of the state machine below.
 *  2. **Lighthouse is optional and must never block completion.** If it fails
 *     or never arrives, the audit still completes with `lighthouse: null` and
 *     a note saying why. Losing the CWV strip must not lose the other sixteen
 *     categories.
 *  3. **Ingest is one shot.** When the crawl reports finished, every section is
 *     pulled, classified and written in a single run. That is affordable
 *     because the section endpoints page at up to
 *     `ON_PAGE_MAX_SECTION_LIMIT` rows per call, so even a 1000-page crawl is
 *     a handful of subrequests — and it means an audit is never left half
 *     ingested with no record of how far it got.
 */
import { eq } from "drizzle-orm";

import { audits, projects } from "../../db";
import type { AuditSummary } from "../../shared/audits";
import { readAuditRecord, writeAuditRecord } from "../audit/record";
import {
  coreWebVitalsResult,
  ingestCrawl,
  withCoreWebVitals,
} from "../audit/pipeline";
import { auditIssuesKey, putAuditJson } from "../audit/storage";
import { createDataForSeoApi } from "../dataforseo";
import { ApiException } from "../http";
import { enqueueJob } from "./queue";
import type { JobContext, JobDetail } from "./types";

export interface AuditPollPayload {
  projectId: string;
  auditId: string;
  /** Epoch ms the crawl was posted — the clock the 24h ceiling runs on. */
  postedAt: number;
  /** Polls so far. Drives the backoff. */
  polls: number;
  /** Whether the homepage Lighthouse task has been posted yet. */
  lighthousePosted: boolean;
  /** Sections already written to R2, so a retry does not re-pull them. */
  sectionsIngested: string[];
  /** Epoch ms the crawl first reported finished. Bounds the Lighthouse chase. */
  crawlFinishedAt?: number;
  /**
   * This job exists only to attach a late Lighthouse run to an audit that has
   * already been published. Without the flag, the handler's "already done"
   * guard would skip it — which is exactly what should happen to every *other*
   * job that finds a finished audit.
   */
  lighthouseOnly?: boolean;
}

/**
 * How long after posting the first poll happens.
 *
 * A crawl does not start instantly and 25 pages take minutes, so polling
 * sooner buys "in_progress" answers and nothing else. One minute matches
 * `rank_post`'s first-collect delay.
 */
export const AUDIT_FIRST_POLL_DELAY_MS = 60_000;

/**
 * How long to keep polling before accepting the crawl is not coming.
 *
 * Same 24 hours as `rank_collect`, and for the same reason: DataForSEO keep
 * results far longer than that, so a day is generous without being unbounded.
 * A crawl still unfinished after a day has hit something we cannot fix by
 * waiting — a site that blocks their crawler, usually — and saying so is more
 * useful than polling for a week.
 */
export const AUDIT_WINDOW_MS = 24 * 60 * 60_000;

/**
 * How long we keep chasing a Lighthouse run **after** the audit is already
 * finished and published.
 *
 * DataForSEO document the Lighthouse standard queue at "up to 45 minutes
 * average", which is the fact that shapes this whole flow. Observed live
 * (2026-08-29): a 25-page crawl of brandpacks.com finished in under a minute,
 * long before its Lighthouse task. So making the audit wait for Lighthouse
 * would routinely hold back sixteen complete categories for the sake of one
 * strip — and a five-minute grace, which is what this constant used to be,
 * would simply have meant the CWV strip was almost always empty.
 *
 * Instead the audit completes the moment the crawl is ingested, and Lighthouse
 * is attached later by a follow-up poll. An hour is comfortably past their
 * quoted worst case.
 */
export const LIGHTHOUSE_WINDOW_MS = 60 * 60_000;

/** Backoff between polls: 1 minute doubling to a 5-minute ceiling. */
export function auditPollDelayMs(polls: number): number {
  const safe = Math.max(0, Math.floor(polls));
  return Math.min(60_000 * 2 ** safe, 5 * 60_000);
}

export async function auditPoll(ctx: JobContext): Promise<JobDetail> {
  const { env, db, job, now } = ctx;
  const payload = readPayload(job.payloadJson);

  const [row] = await db
    .select({
      id: audits.id,
      projectId: audits.projectId,
      dfsTaskId: audits.dfsTaskId,
      status: audits.status,
      summaryJson: audits.summaryJson,
      workspaceId: projects.workspaceId,
      domain: projects.domain,
    })
    .from(audits)
    .innerJoin(projects, eq(projects.id, audits.projectId))
    .where(eq(audits.id, payload.auditId))
    .limit(1);

  // Deleted between enqueue and run — by the user, or with its project. Not an
  // error: succeed so the job stops rather than retrying five times.
  if (row === undefined) {
    return { skipped: "audit_deleted", auditId: payload.auditId };
  }

  /*
   * A finished audit is normally the end of the line — except for the one
   * continuation this job supports: an audit that published without its
   * Lighthouse run and is still inside `LIGHTHOUSE_WINDOW_MS`. That run is
   * chased on a `lighthouseOnly` job, which patches the published summary in
   * place. Everything else stops here.
   */
  if (row.status === "done") {
    if (!payload.lighthouseOnly) {
      return { skipped: "already_done", auditId: row.id };
    }
    return attachLighthouse(ctx, row, payload);
  }
  if (row.status === "failed") {
    return { skipped: "already_failed", auditId: row.id };
  }
  if (row.dfsTaskId === null) {
    await failAudit(ctx, row.id, "This audit has no crawl task to poll.");
    return { auditId: row.id, failed: "no_task_id" };
  }

  const record = readAuditRecord(row.summaryJson);
  const age = now.getTime() - payload.postedAt;

  if (age > AUDIT_WINDOW_MS) {
    /*
     * Out of time. The audit is failed with a message a user can act on
     * rather than left `running` forever — an audit stuck at "crawling…" for a
     * week tells nobody anything, and the crawl was paid for whether or not we
     * kept waiting.
     */
    await failAudit(
      ctx,
      row.id,
      `The crawl did not finish within 24 hours. This usually means the site blocked the crawler or is too slow to crawl. Pages crawled before we stopped waiting: ${record.progress?.pagesCrawled ?? 0}.`,
    );
    return {
      auditId: row.id,
      gaveUp: true,
      ageHours: Math.round(age / 3_600_000),
      pagesCrawled: record.progress?.pagesCrawled ?? 0,
    };
  }

  const dfs = await createDataForSeoApi(env, db, row.workspaceId);

  /*
   * Lighthouse is posted here rather than at audit creation for two reasons:
   * it keeps the create request to one upstream call (so a Lighthouse outage
   * cannot stop a crawl being bought), and posting it now means it runs
   * concurrently with the crawl and is almost always ready first.
   */
  let lighthousePosted = payload.lighthousePosted;
  let lighthouseTaskId = record.lighthouseTaskId;
  if (!lighthousePosted) {
    try {
      const posted = await dfs.onPage.lighthouseTaskPost({
        url: `https://${row.domain}/`,
      });
      lighthouseTaskId = posted.taskId;
      lighthousePosted = true;
    } catch (err) {
      // A Lighthouse post that fails must not fail the audit. Marked as
      // attempted so we do not retry it on every poll and pay twice.
      if (err instanceof ApiException) {
        lighthousePosted = true;
        lighthouseTaskId = null;
      } else {
        throw err;
      }
    }
  }

  const summary = await dfs.onPage.summary(row.dfsTaskId);

  // Persist progress on every poll, finished or not, so the UI's progress bar
  // moves and a give-up message can say how far the crawl got.
  const progress = {
    state: summary.crawlProgress,
    pagesCrawled: summary.pagesCrawled,
    pagesInQueue: summary.pagesInQueue,
    pagesLimit: summary.maxCrawlPages ?? record.pagesLimit,
  };

  if (!summary.finished) {
    await db
      .update(audits)
      .set({
        summaryJson: writeAuditRecord({
          ...record,
          progress,
          lighthouseTaskId,
        }),
      })
      .where(eq(audits.id, row.id));

    const nextJobId = await enqueueJob(db, {
      type: "audit_poll",
      workspaceId: row.workspaceId,
      payload: {
        ...payload,
        polls: payload.polls + 1,
        lighthousePosted,
      },
      runAt: new Date(now.getTime() + auditPollDelayMs(payload.polls)),
    });

    return {
      auditId: row.id,
      crawlProgress: summary.crawlProgress,
      pagesCrawled: summary.pagesCrawled,
      pagesInQueue: summary.pagesInQueue,
      polls: payload.polls,
      nextJobId,
    };
  }

  /*
   * The crawl is finished, so the audit finishes now — with Lighthouse if it
   * happens to be ready, without it otherwise. The audit is never held back
   * waiting: see `LIGHTHOUSE_WINDOW_MS`.
   */
  const lighthouse = await collectLighthouse(dfs, lighthouseTaskId, row.domain);

  /*
   * Everything below happens once, in one run: pull the sections, classify,
   * write the blobs, write the rollup, mark the audit done.
   *
   * Lighthouse is resolved *before* ingest, not after, because the Core Web
   * Vitals category is derived from it — classification needs the numbers in
   * hand to decide whether the homepage fails LCP, CLS or TBT.
   */
  const ingested = await ingestCrawl({
    dfs,
    bucket: env.BLOBS,
    workspaceId: row.workspaceId,
    auditId: row.id,
    taskId: row.dfsTaskId,
    domain: row.domain,
    pagesLimit: record.pagesLimit,
    renderJs: record.renderJs,
    crawlSummary: summary,
    lighthouse: lighthouse.state === "ready" ? lighthouse.lighthouse : null,
  });

  const finalSummary: AuditSummary = {
    ...ingested.summary,
    lighthouse: lighthouse.state === "ready" ? lighthouse.lighthouse : null,
    lighthouseNote:
      lighthouse.state === "ready"
        ? null
        : lighthouse.state === "pending"
          ? "Core Web Vitals are still being measured; they will appear here shortly. The crawl results below are complete."
          : lighthouse.note,
    ingestedAt: now.toISOString(),
  };

  await db
    .update(audits)
    .set({
      status: "done",
      summaryJson: writeAuditRecord({
        ...record,
        summary: finalSummary,
        progress,
        lighthouseTaskId,
        error: null,
      }),
    })
    .where(eq(audits.id, row.id));

  /*
   * The audit is published. If Lighthouse is still running, keep chasing it on
   * a follow-up job that patches the summary in place — the user has their
   * sixteen categories now, and the CWV strip fills in when it arrives.
   */
  let lighthouseJobId: string | null = null;
  if (lighthouse.state === "pending") {
    lighthouseJobId = await enqueueJob(db, {
      type: "audit_poll",
      workspaceId: row.workspaceId,
      payload: {
        ...payload,
        polls: payload.polls + 1,
        lighthousePosted,
        lighthouseOnly: true,
        crawlFinishedAt: payload.crawlFinishedAt ?? now.getTime(),
      },
      runAt: new Date(now.getTime() + auditPollDelayMs(0)),
    });
  }

  return {
    auditId: row.id,
    ingested: true,
    score: finalSummary.score,
    pagesCrawled: finalSummary.pagesCrawled,
    pagesWithIssues: finalSummary.pagesWithIssues,
    totalIssues: finalSummary.totalIssues,
    lighthouse: lighthouse.state,
    lighthouseJobId,
    sections: ingested.sectionsWritten,
    blobs: ingested.blobsWritten,
    polls: payload.polls,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** One row of the audit+project join the handler works from. */
type AuditRow = {
  id: string;
  projectId: string;
  dfsTaskId: string | null;
  status: string;
  summaryJson: Record<string, unknown>;
  workspaceId: string;
  domain: string;
};

/**
 * Attaches a late Lighthouse run to an audit that already published.
 *
 * Patches only what Lighthouse owns — the scores strip and the Core Web Vitals
 * category — rather than re-running ingest: the crawl data is unchanged, and
 * re-pulling every section to recompute one category would spend the
 * subrequest budget to arrive at the same sixteen answers.
 *
 * Gives up quietly at `LIGHTHOUSE_WINDOW_MS`, leaving the note in place. A
 * missing CWV strip on an otherwise complete audit is a small, honest gap.
 */
async function attachLighthouse(
  ctx: JobContext,
  row: AuditRow,
  payload: AuditPollPayload,
): Promise<JobDetail> {
  const { env, db, now } = ctx;
  const record = readAuditRecord(row.summaryJson);
  const summary = record.summary;

  if (summary === null || summary.lighthouse !== null) {
    return { skipped: "lighthouse_not_needed", auditId: row.id };
  }

  const since = payload.crawlFinishedAt ?? payload.postedAt;
  if (now.getTime() - since > LIGHTHOUSE_WINDOW_MS) {
    await db
      .update(audits)
      .set({
        summaryJson: writeAuditRecord({
          ...record,
          summary: {
            ...summary,
            lighthouseNote:
              "Core Web Vitals could not be measured for this audit. The crawl results are complete.",
          },
        }),
      })
      .where(eq(audits.id, row.id));
    return { auditId: row.id, lighthouse: "gave_up" };
  }

  const dfs = await createDataForSeoApi(env, db, row.workspaceId);
  const outcome = await collectLighthouse(
    dfs,
    record.lighthouseTaskId,
    row.domain,
  );

  if (outcome.state === "pending") {
    const nextJobId = await enqueueJob(db, {
      type: "audit_poll",
      workspaceId: row.workspaceId,
      payload: { ...payload, polls: payload.polls + 1 },
      runAt: new Date(now.getTime() + auditPollDelayMs(payload.polls)),
    });
    return { auditId: row.id, lighthouse: "pending", nextJobId };
  }

  if (outcome.state === "unavailable") {
    await db
      .update(audits)
      .set({
        summaryJson: writeAuditRecord({
          ...record,
          summary: { ...summary, lighthouseNote: outcome.note },
        }),
      })
      .where(eq(audits.id, row.id));
    return { auditId: row.id, lighthouse: "unavailable" };
  }

  const cwv = coreWebVitalsResult(outcome.lighthouse, row.domain);

  // The drill-down blob too, so "2 affected pages" in the table has something
  // behind it when someone clicks through.
  if (cwv.pages.length > 0) {
    await putAuditJson(
      env.BLOBS,
      auditIssuesKey(row.workspaceId, row.id, "core_web_vitals"),
      cwv.pages,
    );
  }

  await db
    .update(audits)
    .set({
      summaryJson: writeAuditRecord({
        ...record,
        summary: {
          ...summary,
          lighthouse: outcome.lighthouse,
          lighthouseNote: null,
          categories: withCoreWebVitals(
            summary.categories,
            outcome.lighthouse,
            row.domain,
          ),
        },
      }),
    })
    .where(eq(audits.id, row.id));

  return {
    auditId: row.id,
    lighthouse: "attached",
    performance: outcome.lighthouse.performance,
    lcpMs: outcome.lighthouse.lcpMs,
    cwvAffectedPages: cwv.category.affectedPages,
  };
}

type LighthouseOutcome =
  | { state: "ready"; lighthouse: NonNullable<AuditSummary["lighthouse"]> }
  | { state: "pending" }
  | { state: "unavailable"; note: string };

/**
 * Fetches the Lighthouse result, converting every failure into a note rather
 * than an exception. The audit is the crawl; Lighthouse is a bonus strip on
 * top of it, and no Lighthouse failure may cost a user the sixteen categories
 * they paid to crawl.
 */
async function collectLighthouse(
  dfs: Awaited<ReturnType<typeof createDataForSeoApi>>,
  taskId: string | null,
  domain: string,
): Promise<LighthouseOutcome> {
  if (taskId === null) {
    return {
      state: "unavailable",
      note: "Lighthouse could not be started for this audit.",
    };
  }
  try {
    const outcome = await dfs.onPage.lighthouseTaskGet(taskId, `https://${domain}/`);
    if (outcome.state === "pending") return { state: "pending" };
    if (outcome.state === "gone") {
      return {
        state: "unavailable",
        note: "The Lighthouse run expired before it could be collected.",
      };
    }
    return { state: "ready", lighthouse: outcome.lighthouse };
  } catch (err) {
    if (err instanceof ApiException) {
      return {
        state: "unavailable",
        note: `Lighthouse could not be collected: ${err.message}`,
      };
    }
    throw err;
  }
}

/** Marks an audit failed with a message meant for a person to read. */
async function failAudit(
  ctx: JobContext,
  auditId: string,
  message: string,
): Promise<void> {
  const [current] = await ctx.db
    .select({ summaryJson: audits.summaryJson })
    .from(audits)
    .where(eq(audits.id, auditId))
    .limit(1);

  const record = readAuditRecord(current?.summaryJson);
  await ctx.db
    .update(audits)
    .set({
      status: "failed",
      summaryJson: writeAuditRecord({ ...record, error: message }),
    })
    .where(eq(audits.id, auditId));
}

function readPayload(raw: Record<string, unknown>): AuditPollPayload {
  const projectId = raw["projectId"];
  const auditId = raw["auditId"];
  const postedAt = raw["postedAt"];

  if (
    typeof projectId !== "string" ||
    typeof auditId !== "string" ||
    typeof postedAt !== "number"
  ) {
    throw new ApiException(
      "internal_error",
      "audit_poll job has a malformed payload.",
    );
  }

  const sectionsRaw = raw["sectionsIngested"];
  const crawlFinishedAt = raw["crawlFinishedAt"];

  return {
    projectId,
    auditId,
    postedAt,
    polls: typeof raw["polls"] === "number" ? raw["polls"] : 0,
    lighthousePosted: raw["lighthousePosted"] === true,
    lighthouseOnly: raw["lighthouseOnly"] === true,
    sectionsIngested: Array.isArray(sectionsRaw)
      ? sectionsRaw.filter((s): s is string => typeof s === "string")
      : [],
    ...(typeof crawlFinishedAt === "number" ? { crawlFinishedAt } : {}),
  };
}
