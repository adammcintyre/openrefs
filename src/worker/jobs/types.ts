/**
 * The contract between the sweeper and a job handler.
 *
 * In its own file so handlers can import it without importing the registry
 * that imports them.
 */
import type { Db } from "../../db";
import type { JobStatus } from "../../db";

/** One claimed row of `jobs`, as the sweeper hands it to a handler. */
export interface JobRecord {
  id: string;
  type: string;
  workspaceId: string | null;
  payloadJson: Record<string, unknown>;
  runAt: Date;
  status: JobStatus;
  /** Already incremented by the claim — this run is attempt number `attempts`. */
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

export interface JobContext {
  env: Env;
  /** Request-scoped Drizzle handle, shared with the sweeper. */
  db: Db;
  job: JobRecord;
  /** The sweep's clock. Passed rather than read so runs are reproducible. */
  now: Date;
}

/**
 * Whatever the handler wants surfaced in the sweep log and the dev endpoint.
 * Diagnostics only — nothing branches on it.
 */
export type JobDetail = Record<string, unknown>;

/**
 * A handler either returns (success → `done`) or throws (failure → retry with
 * backoff, or `failed` once attempts are exhausted). There is no third
 * outcome: a job that wants to run again later enqueues its successor and
 * returns, rather than pretending to fail.
 */
export type JobHandler = (ctx: JobContext) => Promise<JobDetail | void>;
