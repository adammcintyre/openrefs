/**
 * `audit_post` — buys the crawl that `POST /projects/:id/audits` promised.
 *
 * The post used to happen inline, in the request, on the argument that the
 * caller needs to know it worked. What that traded away was resilience: a
 * DataForSEO tarpit — minutes of hung connections from a shared Cloudflare
 * egress IP, observed in production — turned a user's "Run audit" click into a
 * 504, with nothing queued and nothing to retry. The click is the one moment
 * we cannot ask them to repeat.
 *
 * So the row is written `pending` with no task id, this job buys the crawl
 * with the queue's retry and backoff behind it, and `audit_poll` takes over
 * once a task id exists. Three consequences worth stating, because each is a
 * rule the handler below enforces:
 *
 *  1. **The spend cap is checked HERE, at post time, not at click time.** It is
 *     the moment money would actually be spent, and a job that waited 80
 *     minutes for its last retry must not spend against a cap the workspace
 *     has since exhausted. The client enforces it; this handler's job is to
 *     turn that refusal into a failed audit rather than a retry loop.
 *  2. **A failure has to land on the audit row.** The 202 has already been
 *     sent, so there is no HTTP status left to carry the news. An audit stuck
 *     on `pending` with nobody able to say why is exactly the failure mode the
 *     old inline comment warned about, and avoiding it is most of this file.
 *  3. **Only a no-response failure is worth retrying.** A refusal — the cap,
 *     missing credentials — will refuse identically five times over the next
 *     hour and a half. It fails the audit immediately, with a code the UI can
 *     switch on.
 */
import { eq } from "drizzle-orm";

import { audits, projects } from "../../db";
import { readAuditRecord, writeAuditRecord } from "../audit/record";
import { createDataForSeoApi } from "../dataforseo";
import { ApiException } from "../http";
import { enqueueJob, isExhausted } from "./queue";
import { AUDIT_FIRST_POLL_DELAY_MS } from "./audit_poll";
import type { AuditPollPayload } from "./audit_poll";
import type { JobContext, JobDetail } from "./types";

export interface AuditPostPayload {
  projectId: string;
  auditId: string;
}

/**
 * Failures that will never come good by waiting, mapped to what they are.
 *
 * Both are decisions about the workspace rather than accidents of the network:
 * a `$0` cap and absent credentials are equally true on the fifth attempt as
 * on the first, and each has its own CTA in the UI — which is why the code is
 * stored alongside the message rather than the message being pattern-matched.
 */
const TERMINAL_CODES = new Set(["spend_cap_exceeded", "no_credentials"]);

export async function auditPost(ctx: JobContext): Promise<JobDetail> {
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
   * The idempotency guard, and it is load-bearing: `run_at` doubles as the
   * job lease, so a Worker that dies mid-post leaves a job another sweep will
   * claim. Without this check that second run would buy a second crawl of up
   * to 1000 pages and overwrite the first task id — paying twice and losing
   * the handle to the crawl already running.
   */
  if (row.dfsTaskId !== null) {
    return { skipped: "already_posted", auditId: row.id, taskId: row.dfsTaskId };
  }
  if (row.status !== "pending") {
    return { skipped: `already_${row.status}`, auditId: row.id };
  }

  const record = readAuditRecord(row.summaryJson);
  const dfs = await createDataForSeoApi(env, db, row.workspaceId);

  let posted;
  try {
    posted = await dfs.onPage.taskPost({
      target: row.domain,
      // What was bought is what the row says was bought — the request's
      // choices, recorded at creation and never re-read from current defaults.
      maxCrawlPages: record.pagesLimit,
      enableJavascript: record.renderJs,
    });
  } catch (err) {
    if (!(err instanceof ApiException)) throw err;

    if (TERMINAL_CODES.has(err.code)) {
      await failAudit(ctx, row.id, err.message, err.code);
      return { auditId: row.id, failed: err.code };
    }

    /*
     * Retryable: a timeout, or an upstream error that may be transient. Let
     * the queue back off and try again — that is the entire point of moving
     * the post off the request path.
     *
     * Except on the last attempt, where rethrowing alone would fail the *job*
     * and leave the *audit* on `pending` forever. The audit is failed first,
     * then the error is rethrown so the job record carries the reason too.
     */
    if (isExhausted(job.attempts)) {
      await failAudit(
        ctx,
        row.id,
        `The crawl could not be started after ${job.attempts} attempts: ${err.message}`,
        err.code,
      );
    }
    throw err;
  }

  /*
   * Recorded before anything else that can throw. We have just paid for a
   * crawl, and the task id is the only handle that can collect it — the same
   * rule `rank_post` follows.
   */
  await db
    .update(audits)
    .set({
      dfsTaskId: posted.taskId,
      status: "running",
      summaryJson: writeAuditRecord({ ...record, error: null, errorCode: null }),
    })
    .where(eq(audits.id, row.id));

  const pollPayload: AuditPollPayload = {
    projectId: row.projectId,
    auditId: row.id,
    // The 24-hour give-up window runs from the real post, not from the click:
    // a crawl that waited in this queue has not been crawling that whole time.
    postedAt: now.getTime(),
    polls: 0,
    lighthousePosted: false,
    sectionsIngested: [],
  };
  const pollJobId = await enqueueJob(db, {
    type: "audit_poll",
    workspaceId: row.workspaceId,
    payload: { ...pollPayload },
    runAt: new Date(now.getTime() + AUDIT_FIRST_POLL_DELAY_MS),
  });

  return {
    auditId: row.id,
    taskId: posted.taskId,
    costUsd: posted.costUsd,
    pagesLimit: record.pagesLimit,
    renderJs: record.renderJs,
    pollJobId,
  };
}

/**
 * Marks an audit failed with a message meant for a person and, where there is
 * one, a code meant for the SPA.
 *
 * Re-reads the row rather than patching the record the handler already holds:
 * this runs after a failed upstream call, and the audit may have been touched
 * in between.
 */
async function failAudit(
  ctx: JobContext,
  auditId: string,
  message: string,
  code: string | null,
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
      summaryJson: writeAuditRecord({
        ...record,
        error: message,
        errorCode: code,
      }),
    })
    .where(eq(audits.id, auditId));
}

function readPayload(raw: Record<string, unknown>): AuditPostPayload {
  const projectId = raw["projectId"];
  const auditId = raw["auditId"];

  if (typeof projectId !== "string" || typeof auditId !== "string") {
    throw new ApiException(
      "internal_error",
      "audit_post job has a malformed payload.",
    );
  }
  return { projectId, auditId };
}
