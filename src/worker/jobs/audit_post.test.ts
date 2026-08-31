/**
 * `audit_post` — the branch decisions that decide whether a user's crawl
 * happens, silently does not, or happens twice.
 *
 * The handler's whole value is in choosing between retry, terminal failure and
 * "someone already did this", so those are what is pinned here. The DataForSEO
 * call itself is stubbed: its own behaviour belongs to on-page.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDataForSeoApi } from "../dataforseo";
import { ApiException } from "../http";
import { auditPost } from "./audit_post";
import { JOB_MAX_ATTEMPTS } from "./queue";
import type { JobContext, JobRecord } from "./types";

vi.mock("../dataforseo", () => ({
  createDataForSeoApi: vi.fn(),
}));

const mockCreateApi = vi.mocked(createDataForSeoApi);

const WS = "11111111-2222-3333-4444-555555555555";
const PROJECT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AUDIT = "audit-1";
const NOW = new Date("2026-08-31T09:00:00.000Z");

interface AuditRowState {
  id: string;
  projectId: string;
  dfsTaskId: string | null;
  status: string;
  summaryJson: Record<string, unknown>;
  workspaceId: string;
  domain: string;
}

/**
 * A Drizzle double over one audit row.
 *
 * The two select shapes are told apart by whether `innerJoin` is called — the
 * handler's join-scoped lookup versus `failAudit`'s re-read — which is enough
 * to answer both without parsing SQL.
 */
function fakeDb(row: AuditRowState | null) {
  const updates: Record<string, unknown>[] = [];
  const enqueued: Record<string, unknown>[] = [];

  const rowsFor = (joined: boolean): unknown[] => {
    if (row === null) return [];
    return joined ? [row] : [{ summaryJson: row.summaryJson }];
  };

  const selectChain = (joined: boolean): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      from: () => self,
      innerJoin: () => selectChain(true),
      where: () => self,
      limit: () => self,
      then: (resolve: (value: unknown[]) => unknown) => resolve(rowsFor(joined)),
    };
    return self;
  };

  const db = {
    select: () => selectChain(false),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        // Applied to the double so a later read in the same run sees it.
        if (row !== null) {
          if (typeof values["status"] === "string") row.status = values["status"];
          if ("dfsTaskId" in values) {
            row.dfsTaskId = values["dfsTaskId"] as string | null;
          }
          if ("summaryJson" in values) {
            row.summaryJson = values["summaryJson"] as Record<string, unknown>;
          }
        }
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: async (job: Record<string, unknown>) => {
        enqueued.push(job);
      },
    }),
  };

  return { db, updates, enqueued };
}

function context(
  row: AuditRowState | null,
  options: { attempts?: number } = {},
): JobContext & { updates: Record<string, unknown>[]; enqueued: Record<string, unknown>[] } {
  const { db, updates, enqueued } = fakeDb(row);
  const job: JobRecord = {
    id: "job-1",
    type: "audit_post",
    workspaceId: WS,
    payloadJson: { projectId: PROJECT, auditId: AUDIT },
    runAt: NOW,
    status: "running",
    attempts: options.attempts ?? 1,
    lastError: null,
    createdAt: NOW,
  };
  return {
    env: {} as Env,
    db: db as never,
    job,
    now: NOW,
    updates,
    enqueued,
  };
}

/** A pending audit with nothing bought yet — the state this job expects. */
function pendingRow(overrides: Partial<AuditRowState> = {}): AuditRowState {
  return {
    id: AUDIT,
    projectId: PROJECT,
    dfsTaskId: null,
    status: "pending",
    summaryJson: {
      summary: null,
      progress: null,
      error: null,
      errorCode: null,
      lighthouseTaskId: null,
      pagesLimit: 100,
      renderJs: false,
    },
    workspaceId: WS,
    domain: "example.com",
    ...overrides,
  };
}

/** Stubs `dfs.onPage.taskPost` with a result or a failure. */
function stubTaskPost(impl: () => Promise<{ taskId: string; costUsd: number }>) {
  const taskPost = vi.fn(impl);
  mockCreateApi.mockResolvedValue({
    onPage: { taskPost },
  } as never);
  return taskPost;
}

beforeEach(() => {
  mockCreateApi.mockReset();
});

describe("auditPost", () => {
  it("buys the crawl the row describes and hands the task to audit_poll", async () => {
    const row = pendingRow({ summaryJson: { pagesLimit: 250, renderJs: true } });
    const taskPost = stubTaskPost(async () => ({
      taskId: "dfs-task-1",
      costUsd: 0.38,
    }));
    const ctx = context(row);

    const detail = await auditPost(ctx);

    // What was bought is what the row says was bought — not today's defaults.
    expect(taskPost).toHaveBeenCalledWith({
      target: "example.com",
      maxCrawlPages: 250,
      enableJavascript: true,
    });
    expect(detail).toMatchObject({ auditId: AUDIT, taskId: "dfs-task-1" });
    expect(row.dfsTaskId).toBe("dfs-task-1");
    expect(row.status).toBe("running");
    expect(ctx.enqueued).toHaveLength(1);
    expect(ctx.enqueued[0]).toMatchObject({ type: "audit_poll" });
  });

  it("dates the poll window from the real post, not from the click", async () => {
    // A crawl that sat in this queue has not been crawling that whole time;
    // starting audit_poll's 24-hour give-up clock at click time would spend
    // part of it on the queue.
    stubTaskPost(async () => ({ taskId: "dfs-task-1", costUsd: 0.38 }));
    const ctx = context(pendingRow());

    await auditPost(ctx);

    const payload = ctx.enqueued[0]?.["payloadJson"] as { postedAt: number };
    expect(payload.postedAt).toBe(NOW.getTime());
  });

  it("refuses to post twice for one audit", async () => {
    // `run_at` doubles as the job lease, so a Worker that died mid-post leaves
    // a job another sweep will claim. Without this, that second run buys a
    // second crawl and overwrites the handle to the first.
    const taskPost = stubTaskPost(async () => ({
      taskId: "dfs-task-2",
      costUsd: 0.38,
    }));
    const ctx = context(pendingRow({ dfsTaskId: "dfs-task-1", status: "running" }));

    const detail = await auditPost(ctx);

    expect(taskPost).not.toHaveBeenCalled();
    expect(detail).toMatchObject({ skipped: "already_posted" });
    expect(ctx.enqueued).toHaveLength(0);
  });

  it("does nothing for an audit deleted between enqueue and run", async () => {
    const ctx = context(null);
    const detail = await auditPost(ctx);
    // Succeeds, so the job stops rather than retrying five times over an hour.
    expect(detail).toMatchObject({ skipped: "audit_deleted" });
  });

  it("skips an audit that is no longer pending", async () => {
    const taskPost = stubTaskPost(async () => ({ taskId: "x", costUsd: 0 }));
    const detail = await auditPost(context(pendingRow({ status: "failed" })));
    expect(taskPost).not.toHaveBeenCalled();
    expect(detail).toMatchObject({ skipped: "already_failed" });
  });

  describe("the spend cap, checked at post time", () => {
    it("fails the audit with a code the UI can switch on, and does not retry", async () => {
      const row = pendingRow();
      stubTaskPost(async () => {
        throw new ApiException(
          "spend_cap_exceeded",
          "Monthly DataForSEO spend cap reached: $25.00 of $25.00 used this month.",
        );
      });
      const ctx = context(row);

      // Returns rather than throws: a cap refuses identically on the fifth
      // attempt as on the first, so retrying for 80 minutes helps nobody.
      const detail = await auditPost(ctx);

      expect(detail).toMatchObject({ failed: "spend_cap_exceeded" });
      expect(row.status).toBe("failed");
      expect(row.summaryJson["errorCode"]).toBe("spend_cap_exceeded");
      expect(String(row.summaryJson["error"])).toContain("spend cap");
      expect(ctx.enqueued).toHaveLength(0);
    });

    it("treats missing credentials the same way", async () => {
      const row = pendingRow();
      stubTaskPost(async () => {
        throw new ApiException("no_credentials", "No DataForSEO credentials.");
      });

      const detail = await auditPost(context(row));

      expect(detail).toMatchObject({ failed: "no_credentials" });
      expect(row.summaryJson["errorCode"]).toBe("no_credentials");
    });
  });

  describe("a tarpit", () => {
    it("throws so the queue retries with backoff, leaving the audit pending", async () => {
      // The whole reason this job exists: a hung upstream must cost a retry,
      // not the user's click.
      const row = pendingRow();
      stubTaskPost(async () => {
        throw new ApiException("upstream_timeout", "DataForSEO didn't respond.");
      });

      await expect(auditPost(context(row))).rejects.toMatchObject({
        code: "upstream_timeout",
      });
      // Still pending, so the retry can pick it up and the duplicate guard
      // still sees a crawl in progress.
      expect(row.status).toBe("pending");
      expect(row.dfsTaskId).toBeNull();
    });

    it("fails the audit on the LAST attempt, so nothing is left pending forever", async () => {
      // Rethrowing alone would fail the job and leave the audit on `pending`
      // with nobody able to explain it — the exact failure mode the inline
      // post was defended on.
      const row = pendingRow();
      stubTaskPost(async () => {
        throw new ApiException("upstream_timeout", "DataForSEO didn't respond.");
      });

      await expect(
        auditPost(context(row, { attempts: JOB_MAX_ATTEMPTS })),
      ).rejects.toMatchObject({ code: "upstream_timeout" });

      expect(row.status).toBe("failed");
      expect(row.summaryJson["errorCode"]).toBe("upstream_timeout");
      expect(String(row.summaryJson["error"])).toContain("could not be started");
    });

    it("retries an upstream error too — it may be transient", async () => {
      const row = pendingRow();
      stubTaskPost(async () => {
        throw new ApiException("upstream_error", "DataForSEO on_page failed (500)");
      });

      await expect(auditPost(context(row))).rejects.toMatchObject({
        code: "upstream_error",
      });
      expect(row.status).toBe("pending");
    });
  });

  it("rethrows a non-ApiException untouched", async () => {
    // A TypeError here is our bug, not DataForSEO's, and must not be recorded
    // on the audit as though the crawl were at fault.
    const row = pendingRow();
    stubTaskPost(async () => {
      throw new TypeError("undefined is not a function");
    });

    await expect(auditPost(context(row))).rejects.toBeInstanceOf(TypeError);
    expect(row.status).toBe("pending");
  });

  it("rejects a malformed payload rather than guessing an audit id", async () => {
    const ctx = context(pendingRow());
    ctx.job.payloadJson = { projectId: PROJECT };
    await expect(auditPost(ctx)).rejects.toMatchObject({
      code: "internal_error",
    });
  });
});
