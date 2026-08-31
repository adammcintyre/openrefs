/**
 *   GET    /api/v1/projects/:id/audits              history list
 *   POST   /api/v1/projects/:id/audits              start a crawl      (admin)
 *   GET    /api/v1/audits/:auditId                  summary + categories
 *   GET    /api/v1/audits/:auditId/issues/:category drill-down (from R2)
 *   DELETE /api/v1/audits/:auditId                  remove row + blobs (admin)
 *
 * Two routers, one file. The project-scoped pair is mounted by the projects
 * router at `/:id/audits`; the audit-scoped three are mounted at `/audits`.
 * They live together because they are one feature with one set of invariants —
 * splitting them by URL shape would put the authorization helper in a third
 * file and invite the two halves to scope differently.
 *
 * **Every route scopes through the project to the workspace.** An audit id is
 * never trusted on its own: `requireAudit` joins `audits → projects` and
 * filters on `projects.workspace_id`, so an id belonging to another tenant
 * reads as "not found" rather than leaking that it exists.
 *
 * Nothing here spends money any more. `POST` queues an `audit_post` job that
 * buys the crawl on the sweeper's schedule, with its retry and backoff; every
 * other route is D1 and R2 reads.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Db } from "../../db";
import { audits, projects } from "../../db";
import type {
  AuditCategory,
  AuditComparison,
  AuditCreatedResponse,
  AuditDeletedResponse,
  AuditDetailResponse,
  AuditIssuePage,
  AuditIssuesResponse,
  AuditListItem,
  AuditListResponse,
} from "../../shared/audits";
import {
  AUDIT_CATEGORIES,
  AUDIT_ISSUES_PAGE_SIZE,
  createAuditSchema,
} from "../../shared/audits";
import { newAuditRecord, readAuditRecord, writeAuditRecord } from "../audit/record";
import { CATEGORY_DEFINITIONS } from "../audit/taxonomy";
import { auditIssuesKey, deleteAuditBlobs, getAuditJson } from "../audit/storage";
import { createDataForSeoApi } from "../dataforseo";
import {
  estimateCrawlCostUsd,
  perPageCostUsd,
} from "../dataforseo/on-page";
import { ApiException } from "../http";
import { enqueueJob } from "../jobs";
import type { AuditPostPayload } from "../jobs/audit_post";
import { authorizeWorkspace, workspaceParam } from "../lib/research";
import { readJson, readParams, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const workspaceQuerySchema = z.object({ workspace: workspaceParam });

/* -------------------------------------------------------------------------- */
/* /api/v1/projects/:id/audits                                                 */
/* -------------------------------------------------------------------------- */

export const projectAuditsRouter = new Hono<AppEnv>();

/**
 * The session guard is re-applied here even though the projects router already
 * applies it to `*`. Mounting is a caller's choice; a router that only
 * authenticates when its parent happens to is one refactor away from being
 * public.
 */
projectAuditsRouter.use("*", requireSession);

projectAuditsRouter.get("/", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const projectId = requireProjectIdParam(c.req.param("id"));
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const project = await requireProject(db, workspace, projectId);

  const [rows, auditInProgress] = await Promise.all([
    db
      .select(auditColumns)
      .from(audits)
      .where(eq(audits.projectId, projectId))
      .orderBy(desc(audits.createdAt)),
    hasUnfinishedAudit(db, projectId),
  ]);

  const body: AuditListResponse = {
    projectId: project.id,
    domain: project.domain,
    audits: rows.map(toListItem),
    auditInProgress,
  };
  return c.json(body);
});

/**
 * POST /api/v1/projects/:id/audits
 *
 * Queues a crawl. The row is written `pending` with no task id and an
 * `audit_post` job buys the crawl behind the queue's retry and backoff; the
 * response is still a 202 carrying the same cost estimate.
 *
 * This used to post inline, on the argument that the caller needs to know it
 * worked. What that traded away was resilience: a DataForSEO tarpit — minutes
 * of hung connections from a shared Cloudflare egress IP, observed in
 * production — turned this click into a 504 with nothing queued and nothing to
 * retry, and the click is the one moment we cannot ask a user to repeat.
 *
 * What that argument was right about is preserved by two things rather than by
 * blocking the request: the audit row exists immediately (so there is always
 * something to show and something the duplicate guard can see), and every way
 * the post can fail lands on that row as a status and an `errorCode` the SPA
 * switches on — see `audit_post`. The failures that are *decisions* rather
 * than accidents still surface here and now: no credentials and an already-
 * running crawl are both answered 409 before anything is queued.
 */
projectAuditsRouter.post("/", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const projectId = requireProjectIdParam(c.req.param("id"));
  const db = await authorizeWorkspace(
    c.env,
    c.get("session"),
    workspace,
    "admin",
  );
  const input = await readJson(c, createAuditSchema);

  // Scoping, not data: a project id from another tenant must 404 here rather
  // than queue a job naming it. The domain is read later, by `audit_post`,
  // from the row it will actually crawl.
  await requireProject(db, workspace, projectId);

  /*
   * One crawl at a time per project. Not a rate limit — a duplicate guard: a
   * double-clicked "Run audit" would otherwise buy two identical crawls of up
   * to 1000 pages each, and the second tells nobody anything the first will
   * not. The check is advisory (two requests could both read "no"), which is
   * acceptable for the same reason the check-now limiter is.
   */
  if (await hasUnfinishedAudit(db, projectId)) {
    throw new ApiException(
      "conflict",
      "An audit of this project is already running. Wait for it to finish before starting another.",
    );
  }

  /*
   * Resolved here even though nothing is spent yet, purely so a workspace with
   * no DataForSEO credentials is told so by this request — a 409 with a CTA —
   * rather than by an audit that queues, fails a minute later and has to be
   * explained after the fact. It is the one pre-flight check worth the round
   * trip: it reads D1, cannot hang on DataForSEO, and answers a question the
   * user can act on immediately.
   */
  await createDataForSeoApi(c.env, db, workspace);

  const record = newAuditRecord({
    pagesLimit: input.maxCrawlPages,
    renderJs: input.renderJs,
  });

  const [created] = await db
    .insert(audits)
    .values({
      projectId,
      // No task id yet, and `pending` until `audit_post` buys the crawl. The
      // duplicate guard counts this state as in-progress precisely so a second
      // click in the gap cannot queue a second crawl.
      dfsTaskId: null,
      status: "pending",
      summaryJson: writeAuditRecord(record),
    })
    .returning(auditColumns);

  if (created === undefined) {
    throw new ApiException(
      "internal_error",
      "The audit could not be recorded, so no crawl was queued.",
    );
  }

  const payload: AuditPostPayload = { projectId, auditId: created.id };
  await enqueueJob(db, {
    type: "audit_post",
    workspaceId: workspace,
    payload: { ...payload },
    // Now: the next sweep should buy it. The delay before a crawl starts is
    // the sweep interval, not a deliberate wait.
    runAt: new Date(),
  });

  const body: AuditCreatedResponse = {
    audit: toListItem(created),
    // Null until `audit_post` has bought the crawl. The field has always been
    // nullable; it is now null for the first minute of every audit's life.
    taskId: null,
    estimatedCostUsd: estimateCrawlCostUsd(input.maxCrawlPages, input.renderJs),
    costPerPageUsd: perPageCostUsd(input.renderJs),
    pagesLimit: input.maxCrawlPages,
    renderJs: input.renderJs,
  };
  return c.json(body, 202);
});

/* -------------------------------------------------------------------------- */
/* /api/v1/audits/:auditId                                                     */
/* -------------------------------------------------------------------------- */

const auditsRouter = new Hono<AppEnv>();

auditsRouter.use("*", requireSession);

const auditParamSchema = z.object({ auditId: z.string().trim().min(1) });
const issuesParamSchema = z.object({
  auditId: z.string().trim().min(1),
  category: z.enum(AUDIT_CATEGORIES),
});
const issuesQuerySchema = z.object({
  workspace: workspaceParam,
  /** 1-based. */
  page: z.coerce.number().int().min(1).optional().default(1),
});

auditsRouter.get("/:auditId", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { auditId } = readParams(c, auditParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const audit = await requireAudit(db, workspace, auditId);
  const record = readAuditRecord(audit.summaryJson);

  const body: AuditDetailResponse = {
    id: audit.id,
    projectId: audit.projectId,
    domain: audit.domain,
    status: audit.status,
    createdAt: audit.createdAt.toISOString(),
    summary: record.summary,
    error: record.error,
    progress: record.progress,
    previous: await previousComparison(db, audit.projectId, audit.createdAt),
  };
  return c.json(body);
});

/**
 * GET /api/v1/audits/:auditId/issues/:category?page=
 *
 * Hydrated from the pre-computed index in R2, one object per category, sliced
 * here. The index is built once at ingest precisely so this route does not
 * re-read every `pages-*.json` blob and re-run the taxonomy to answer one
 * question about one category.
 */
auditsRouter.get("/:auditId/issues/:category", async (c) => {
  const { workspace, page } = readQuery(c, issuesQuerySchema);
  const { auditId, category } = readParams(c, issuesParamSchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);

  const audit = await requireAudit(db, workspace, auditId);

  const stored = await getAuditJson<AuditIssuePage[]>(
    c.env.BLOBS,
    auditIssuesKey(workspace, auditId, category),
  );
  // No blob means no findings in this category — a legitimate empty result,
  // not a missing resource. See `getAuditJson`.
  const all = Array.isArray(stored) ? stored : [];

  const start = (page - 1) * AUDIT_ISSUES_PAGE_SIZE;
  const definition = CATEGORY_DEFINITIONS[category as AuditCategory];
  const summaryCategory = readAuditRecord(audit.summaryJson).summary?.categories.find(
    (entry) => entry.category === category,
  );

  const body: AuditIssuesResponse = {
    auditId: audit.id,
    category: category as AuditCategory,
    label: definition.label,
    severity: summaryCategory?.severity ?? definition.baseSeverity,
    page,
    pageSize: AUDIT_ISSUES_PAGE_SIZE,
    total: all.length,
    pages: all.slice(start, start + AUDIT_ISSUES_PAGE_SIZE),
  };
  return c.json(body);
});

/**
 * DELETE /api/v1/audits/:auditId
 *
 * Blobs first, row second — the same ordering, for the same reason, as
 * workspace deletion: if the R2 purge fails halfway the row still exists, so
 * the delete can simply be retried. Dropping the row first would strand
 * megabytes of crawl data under an audit id nothing points at any more.
 */
auditsRouter.delete("/:auditId", async (c) => {
  const { workspace } = readQuery(c, workspaceQuerySchema);
  const { auditId } = readParams(c, auditParamSchema);
  const db = await authorizeWorkspace(
    c.env,
    c.get("session"),
    workspace,
    "admin",
  );

  const audit = await requireAudit(db, workspace, auditId);

  const blobsDeleted = await deleteAuditBlobs(c.env.BLOBS, workspace, audit.id);
  await db.delete(audits).where(eq(audits.id, audit.id));

  const body: AuditDeletedResponse = {
    deleted: true,
    id: audit.id,
    blobsDeleted,
  };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const auditColumns = {
  id: audits.id,
  projectId: audits.projectId,
  dfsTaskId: audits.dfsTaskId,
  status: audits.status,
  summaryJson: audits.summaryJson,
  createdAt: audits.createdAt,
};

type AuditRow = {
  id: string;
  projectId: string;
  dfsTaskId: string | null;
  status: AuditListItem["status"];
  summaryJson: Record<string, unknown>;
  createdAt: Date;
};

/**
 * A list row. Reads the envelope for the few fields the history table shows,
 * rather than shipping the whole rollup for every audit ever run — a fifty-row
 * history would otherwise be fifty complete category breakdowns.
 */
function toListItem(row: AuditRow): AuditListItem {
  const record = readAuditRecord(row.summaryJson);
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    score: record.summary?.score ?? null,
    pagesCrawled: record.summary?.pagesCrawled ?? record.progress?.pagesCrawled ?? 0,
    pagesLimit: record.pagesLimit,
    renderJs: record.renderJs,
    error: record.error,
    errorCode: record.errorCode,
  };
}

/**
 * Whether a crawl for this project is still going.
 *
 * `pending` counts, and since crawls became queue-posted that is what makes
 * the duplicate guard work at all: for the first minute of its life an audit
 * is `pending` with no task id, and a second "Run audit" click in that window
 * must be refused exactly as one during the crawl is. The status list below is
 * the guard.
 *
 * Asks the `audits` table, not the `jobs` table, and the difference is not
 * cosmetic. A finished audit can still have a live `audit_poll` job attached
 * to it — the follow-up that waits up to an hour for a late Lighthouse run —
 * so "is a job queued?" answers yes for an audit that is complete and
 * published. Observed live: an audit that finished in 98 seconds reported
 * `auditInProgress: true` for as long as its Lighthouse chase continued, which
 * would have shown a spinner over finished results and, worse, made the
 * duplicate guard refuse a re-run for the rest of the hour.
 *
 * The audit's own status is the thing being asked about, so it is the thing to
 * read.
 */
async function hasUnfinishedAudit(
  db: Db,
  projectId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ total: sql<number>`count(*)` })
    .from(audits)
    .where(
      and(
        eq(audits.projectId, projectId),
        inArray(audits.status, ["pending", "running"]),
      ),
    );
  return Number(row?.total ?? 0) > 0;
}

/** The project, scoped to the workspace. */
async function requireProject(
  db: Db,
  workspaceId: string,
  projectId: string,
): Promise<{ id: string; domain: string }> {
  const [row] = await db
    .select({ id: projects.id, domain: projects.domain })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
    )
    .limit(1);

  if (row === undefined) {
    throw new ApiException("not_found", "No such project.");
  }
  return row;
}

/**
 * The audit, its project, and proof both belong to this workspace.
 *
 * The join is the authorization: `audits` has no workspace column, so an audit
 * id alone says nothing about who may read it. Filtering on
 * `projects.workspace_id` here is what makes another tenant's audit a 404.
 */
async function requireAudit(
  db: Db,
  workspaceId: string,
  auditId: string,
): Promise<AuditRow & { domain: string }> {
  const [row] = await db
    .select({ ...auditColumns, domain: projects.domain })
    .from(audits)
    .innerJoin(projects, eq(projects.id, audits.projectId))
    .where(and(eq(audits.id, auditId), eq(projects.workspaceId, workspaceId)))
    .limit(1);

  if (row === undefined) {
    throw new ApiException("not_found", "No such audit.");
  }
  return row;
}

/**
 * The previous finished audit of the same project, reduced to what the
 * comparison chips need.
 *
 * One extra small query on the detail view, rather than making the UI fetch
 * the history list and pick the right row: the "+3 / −7 vs previous" chip is
 * part of what the detail view *is*, and computing it here means both the
 * chips and the numbers above them come from one consistent read.
 */
async function previousComparison(
  db: Db,
  projectId: string,
  before: Date,
): Promise<AuditComparison | null> {
  const [row] = await db
    .select({
      id: audits.id,
      summaryJson: audits.summaryJson,
      createdAt: audits.createdAt,
    })
    .from(audits)
    .where(
      and(
        eq(audits.projectId, projectId),
        eq(audits.status, "done"),
        sql`${audits.createdAt} < ${before.getTime()}`,
      ),
    )
    .orderBy(desc(audits.createdAt))
    .limit(1);

  if (row === undefined) return null;
  const summary = readAuditRecord(row.summaryJson).summary;
  if (summary === null) return null;

  const categoryCounts: Record<string, number> = {};
  for (const category of summary.categories) {
    categoryCounts[category.category] = category.affectedPages;
  }

  return {
    auditId: row.id,
    createdAt: row.createdAt.toISOString(),
    score: summary.score,
    categoryCounts,
  };
}

/**
 * The `:id` the projects router matched.
 *
 * Read from the raw param rather than through `readParams`, because this
 * router is mounted *inside* another router's path — the parameter belongs to
 * the parent's pattern, and a schema here would be validating a value this
 * router does not own.
 */
function requireProjectIdParam(id: string | undefined): string {
  if (typeof id !== "string" || id.trim() === "") {
    throw new ApiException("not_found", "No such project.");
  }
  return id;
}

export default auditsRouter;
