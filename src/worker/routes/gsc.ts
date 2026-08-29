/**
 *   GET    /api/v1/gsc/status        configured / connected / property / broken
 *   GET    /api/v1/gsc/connect       302 → Google consent          (admin, human)
 *   GET    /api/v1/gsc/callback      302 → the SPA                 (admin, human)
 *   GET    /api/v1/gsc/sites         properties the grant can see  (admin)
 *   PATCH  /api/v1/gsc/connection    bind a property               (admin)
 *   DELETE /api/v1/gsc/connection    revoke + delete               (admin)
 *   GET    /api/v1/gsc/overview      totals + daily series         (member)
 *   GET    /api/v1/gsc/queries       top queries                   (member)
 *   GET    /api/v1/gsc/pages         top pages                     (member)
 *   GET    /api/v1/gsc/opportunities the three rules               (member)
 *
 * Three things are true of every route here and worth stating once.
 *
 * **Nothing costs money.** This module never touches DataForSEO, so there is
 * no spend cap to check and no `ResultMeta` to attach. Where other modules
 * report a cost, these report `freshTo`.
 *
 * **Every route is scoped by `?workspace=` *and* `?project=`, and the project
 * is re-proven against the workspace on every call.** A project id is never
 * trusted on its own — `requireProject` filters on `projects.workspace_id`, so
 * another tenant's project reads as "not found" rather than confirming it
 * exists.
 *
 * **Roles split on side effects, not on sensitivity.** Reports are `member`.
 * Anything that creates, re-points or destroys a Google grant is `admin`, and
 * the two OAuth legs additionally require a *human* session: they mint and
 * consume a token bound to a `userId`, which an API key does not have.
 */
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import type { Db } from "../../db";
import { gscConnections, projects } from "../../db";
import type {
  GscConnectionResponse,
  GscDateRange,
  GscDisconnectedResponse,
  GscOpportunitiesResponse,
  GscOverviewResponse,
  GscPagesResponse,
  GscQueriesResponse,
  GscSitesResponse,
  GscStatusResponse,
} from "../../shared/gsc";
import { updateGscConnectionSchema } from "../../shared/gsc";
import {
  buildAuthUrl,
  exchangeCode,
  listSites,
  revokeToken,
} from "../gsc/api";
import {
  appRedirect,
  callbackRedirectUri,
  isGscConfigured,
  requireGscConfig,
} from "../gsc/config";
import { computeOpportunities } from "../gsc/opportunities";
import {
  cachedPull,
  paginate,
  resolveRange,
  toDaily,
  toPageRows,
  toQueryPageRows,
  toQueryRows,
  totalsFromDaily,
} from "../gsc/reports";
import type { PullContext } from "../gsc/reports";
import { createOAuthState, verifyOAuthState } from "../gsc/state";
import {
  clearConnectionCache,
  getAccessToken,
  isConnectionBroken,
  loadConnection,
  requireConnection,
} from "../gsc/tokens";
import { ApiException } from "../http";
import { requireUserSession } from "../lib/authorization";
import { decryptSecret, encryptSecret } from "../lib/crypto";
import {
  authorizeWorkspace,
  limitParam,
  offsetParam,
  workspaceParam,
  DEFAULT_LIMIT,
} from "../lib/research";
import { readJson, readQuery } from "../lib/validate";
import { requireSession } from "../middleware/auth";
import type { AppEnv } from "../types";

const gsc = new Hono<AppEnv>();

gsc.use("*", requireSession);

/* -------------------------------------------------------------------------- */
/* Query schemas                                                               */
/* -------------------------------------------------------------------------- */

const projectParam = z.string().trim().min(1, "A project id is required.");

const connectionQuerySchema = z.object({
  workspace: workspaceParam,
  project: projectParam,
});

/** `YYYY-MM-DD`. Search Console speaks no other date format. */
const isoDateParam = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD.");

const reportQuerySchema = z.object({
  workspace: workspaceParam,
  project: projectParam,
  from: isoDateParam.optional(),
  to: isoDateParam.optional(),
});

const pagedReportQuerySchema = reportQuerySchema.extend({
  limit: limitParam.optional().default(DEFAULT_LIMIT),
  offset: offsetParam.optional().default(0),
});

/**
 * The callback's query string.
 *
 * `code` is optional because Google omits it on refusal — the response is
 * `?error=access_denied&state=…` instead. `state` is required in every case,
 * and nothing else in the query string is read.
 */
const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1, "Missing state."),
  error: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* GET /status                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The one route that never fails for a configuration reason — it *is* the
 * configuration report. `requireGscConfig` is deliberately not called.
 *
 * Answers entirely from D1 and KV: no Google call, so the Search Console page
 * renders its shell immediately and a dead grant is reported without waiting
 * on a token refresh that is going to fail.
 */
gsc.get("/status", async (c) => {
  const { workspace, project } = readQuery(c, connectionQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  await requireProject(db, workspace, project);

  const configured = isGscConfigured(c.env);
  const connection = await loadConnection(db, workspace, project);

  const body: GscStatusResponse = {
    configured,
    connected: connection !== null,
    property:
      connection === null || connection.property === ""
        ? null
        : connection.property,
    broken:
      connection !== null &&
      (await isConnectionBroken(c.env.CACHE, workspace, project)),
  };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* OAuth                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/v1/gsc/connect — 302 to Google's consent screen.
 *
 * A redirect rather than a JSON payload containing the URL, because the SPA
 * must leave the page anyway: Google refuses to be framed, and an XHR cannot
 * complete a consent flow. The browser follows this straight out of the app.
 */
gsc.get("/connect", async (c) => {
  const config = requireGscConfig(c.env);
  const { workspace, project } = readQuery(c, connectionQuerySchema);
  const { userId } = requireUserSession(c.get("session"));
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");
  await requireProject(db, workspace, project);

  const state = await createOAuthState(c.env.APP_MASTER_KEY, {
    userId,
    workspaceId: workspace,
    projectId: project,
  });

  return c.redirect(
    buildAuthUrl({
      clientId: config.clientId,
      redirectUri: callbackRedirectUri(c.req.url),
      state,
    }),
    302,
  );
});

/**
 * GET /api/v1/gsc/callback — where Google sends the browser back.
 *
 * **Everything actionable comes out of the signed state, never the query
 * string.** The workspace and project this grant will be bound to were fixed
 * when `/connect` minted the token; a caller who edits the URL can change
 * nothing but the signature, which then fails.
 *
 * Failures redirect rather than returning JSON, because the browser is
 * navigating: a JSON error body here would be a dead end with the user staring
 * at raw text. The SPA reads `?error=` and renders the right message. The one
 * exception is an anonymous caller, which `requireSession` answers with 401
 * before any of this runs — there is no page to send them back to.
 */
gsc.get("/callback", async (c) => {
  requireGscConfig(c.env);
  const { code, state, error } = readQuery(c, callbackQuerySchema);
  const { userId } = requireUserSession(c.get("session"));

  const back = (params: Record<string, string>) =>
    c.redirect(appRedirect(c.req.url, params), 302);

  // The user pressed Cancel. Google still returns the state; there is nothing
  // to verify it against, and nothing went wrong.
  if (error !== undefined) {
    return back({ error: error === "access_denied" ? "access_denied" : "gsc_error" });
  }

  const verified = await verifyOAuthState(c.env.APP_MASTER_KEY, state);
  if (!verified.ok) {
    return back({
      error: verified.reason === "expired" ? "expired_state" : "invalid_state",
    });
  }
  const { workspaceId, projectId } = verified.payload;

  /*
   * The state proves *a* signed-in admin started this flow; this proves it was
   * the person whose browser arrived. Without it, a leaked callback URL could
   * be finished by whoever else happens to be signed in on that machine, and
   * their Google account — not the initiator's — would end up bound.
   */
  if (verified.payload.userId !== userId) {
    return back({ error: "state_mismatch", project: projectId });
  }

  if (code === undefined) {
    return back({ error: "invalid_state", project: projectId });
  }

  try {
    const db = await authorizeWorkspace(
      c.env,
      c.get("session"),
      workspaceId,
      "admin",
    );
    await requireProject(db, workspaceId, projectId);

    const config = requireGscConfig(c.env);
    const tokens = await exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      // Byte-identical to the one /connect sent, or Google says
      // redirect_uri_mismatch. Both derive from the request origin.
      redirectUri: callbackRedirectUri(c.req.url),
    });

    if (tokens.refreshToken === null) {
      /*
       * Should be unreachable: `access_type=offline` + `prompt=consent` is
       * exactly the combination that guarantees one. If it ever happens we
       * have an access token good for an hour and no way to renew it, which is
       * worse than nothing — storing it would produce a connection that works
       * until lunchtime and then reports itself broken forever.
       */
      return back({ error: "no_refresh_token", project: projectId });
    }

    const refreshTokenEnc = await encryptSecret(
      c.env.APP_MASTER_KEY,
      tokens.refreshToken,
    );

    await db
      .insert(gscConnections)
      .values({
        projectId,
        refreshTokenEnc,
        // Empty until the user picks one from /sites.
        property: "",
        connectedBy: userId,
      })
      .onConflictDoUpdate({
        target: gscConnections.projectId,
        // `property` is deliberately absent: reconnecting a broken connection
        // should not make the user re-pick the property they already chose.
        set: { refreshTokenEnc, connectedBy: userId },
      });

    // The previous grant's access token must never serve the new connection,
    // and a stale "broken" mark must not survive a successful reconnect.
    await clearConnectionCache(c.env.CACHE, workspaceId, projectId);

    return back({ connected: "1", project: projectId });
  } catch (err) {
    if (err instanceof ApiException) {
      return back({ error: err.code, project: projectId });
    }
    throw err;
  }
});

/* -------------------------------------------------------------------------- */
/* Connection management                                                       */
/* -------------------------------------------------------------------------- */

/** GET /api/v1/gsc/sites — the property picker's options. */
gsc.get("/sites", async (c) => {
  const config = requireGscConfig(c.env);
  const { workspace, project } = readQuery(c, connectionQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");
  await requireProject(db, workspace, project);

  const connection = await requireConnection(db, workspace, project);
  const accessToken = await getAccessToken(
    {
      kv: c.env.CACHE,
      masterKey: c.env.APP_MASTER_KEY,
      config,
      workspaceId: workspace,
      projectId: project,
    },
    connection.refreshTokenEnc,
  );

  const body: GscSitesResponse = {
    sites: await listSites(accessToken),
    property: connection.property === "" ? null : connection.property,
  };
  return c.json(body);
});

/**
 * PATCH /api/v1/gsc/connection — bind the project to one property.
 *
 * The property is checked against `sites.list` rather than taken on trust.
 * Not for authorization — Google would refuse a property this grant cannot
 * read anyway — but for the error: a typo'd or stale property otherwise
 * produces a 403 on every report afterwards, days later, with nothing pointing
 * at the setting that caused it. Rejecting it here says so immediately.
 */
gsc.patch("/connection", async (c) => {
  const config = requireGscConfig(c.env);
  const { workspace, project } = readQuery(c, connectionQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");
  await requireProject(db, workspace, project);
  const { property } = await readJson(c, updateGscConnectionSchema);

  const connection = await requireConnection(db, workspace, project);
  const accessToken = await getAccessToken(
    {
      kv: c.env.CACHE,
      masterKey: c.env.APP_MASTER_KEY,
      config,
      workspaceId: workspace,
      projectId: project,
    },
    connection.refreshTokenEnc,
  );

  const sites = await listSites(accessToken);
  if (!sites.some((site) => site.siteUrl === property)) {
    throw new ApiException(
      "validation_failed",
      "That property is not one this Google account can read. Pick one from the list.",
    );
  }

  await db
    .update(gscConnections)
    .set({ property })
    .where(eq(gscConnections.projectId, project));

  const body: GscConnectionResponse = { connected: true, property };
  return c.json(body);
});

/**
 * DELETE /api/v1/gsc/connection — revoke at Google, then forget.
 *
 * Revoke first, delete second, for the same reason blobs go before rows in the
 * workspace cascade: once the row is gone the encrypted token is gone with it,
 * and the grant would sit in the user's Google account with nothing left able
 * to revoke it. A failed revocation still deletes — see `revokeToken`.
 */
gsc.delete("/connection", async (c) => {
  requireGscConfig(c.env);
  const { workspace, project } = readQuery(c, connectionQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace, "admin");
  await requireProject(db, workspace, project);

  const connection = await requireConnection(db, workspace, project);

  let revoked = false;
  try {
    const refreshToken = await decryptSecret(
      c.env.APP_MASTER_KEY,
      connection.refreshTokenEnc,
    );
    revoked = await revokeToken(refreshToken);
  } catch {
    // Undecryptable token: nothing to revoke. The row still goes.
  }

  await db.delete(gscConnections).where(eq(gscConnections.projectId, project));
  await clearConnectionCache(c.env.CACHE, workspace, project);

  const body: GscDisconnectedResponse = { disconnected: true, revoked };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

/** GET /api/v1/gsc/overview */
gsc.get("/overview", async (c) => {
  const { from, to } = readQuery(c, reportQuerySchema);
  const ctx = await reportContext(c, { from, to });

  const { rows, cached } = await cachedPull(ctx, "date");
  const daily = toDaily(rows);

  const body: GscOverviewResponse = {
    ...ctx.range,
    property: ctx.property,
    cached,
    totals: totalsFromDaily(daily),
    daily,
  };
  return c.json(body);
});

/** GET /api/v1/gsc/queries */
gsc.get("/queries", async (c) => {
  const { from, to, limit, offset } = readQuery(c, pagedReportQuerySchema);
  const ctx = await reportContext(c, { from, to });

  const { rows, cached } = await cachedPull(ctx, "query");
  const page = paginate(toQueryRows(rows), limit, offset);

  const body: GscQueriesResponse = {
    ...ctx.range,
    property: ctx.property,
    cached,
    rows: page.rows,
    total: page.total,
    limit,
    offset,
  };
  return c.json(body);
});

/** GET /api/v1/gsc/pages */
gsc.get("/pages", async (c) => {
  const { from, to, limit, offset } = readQuery(c, pagedReportQuerySchema);
  const ctx = await reportContext(c, { from, to });

  const { rows, cached } = await cachedPull(ctx, "page");
  const page = paginate(toPageRows(rows), limit, offset);

  const body: GscPagesResponse = {
    ...ctx.range,
    property: ctx.property,
    cached,
    rows: page.rows,
    total: page.total,
    limit,
    offset,
  };
  return c.json(body);
});

/**
 * GET /api/v1/gsc/opportunities
 *
 * Two pulls, both cached under the same keys `/queries` uses — so opening this
 * tab after the Queries tab costs one Google call, not two, and reloading it
 * costs none. The rules themselves are pure (gsc/opportunities.ts); this
 * handler only fetches and hands over.
 */
gsc.get("/opportunities", async (c) => {
  const { from, to } = readQuery(c, reportQuerySchema);
  const ctx = await reportContext(c, { from, to });

  const [queries, queryPages] = await Promise.all([
    cachedPull(ctx, "query"),
    cachedPull(ctx, "query,page"),
  ]);

  const computed = computeOpportunities({
    queryRows: toQueryRows(queries.rows),
    queryPageRows: toQueryPageRows(queryPages.rows),
  });

  const body: GscOpportunitiesResponse = {
    ...ctx.range,
    property: ctx.property,
    // Only wholly cached counts as cached; a mixed pair did hit Google.
    cached: queries.cached && queryPages.cached,
    ...computed,
  };
  return c.json(body);
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Everything the four report handlers need, in the order the checks have to
 * happen: config, membership, project, connection, property, token, dates.
 *
 * Config first and dates last is deliberate. An unconfigured deployment answers
 * `gsc_not_configured` without touching D1, and a project with no property
 * answers `gsc_no_property` without minting a Google token — so the cheap,
 * common "you have not finished setting this up" answers never pay for the
 * expensive checks behind them.
 */
async function reportContext(
  c: Context<AppEnv>,
  range: { from?: string; to?: string },
): Promise<PullContext & { range: GscDateRange }> {
  const config = requireGscConfig(c.env);
  const { workspace, project } = readQuery(c, connectionQuerySchema);
  const db = await authorizeWorkspace(c.env, c.get("session"), workspace);
  await requireProject(db, workspace, project);

  const connection = await requireConnection(db, workspace, project);
  if (connection.property === "") {
    throw new ApiException(
      "gsc_no_property",
      "Pick a Search Console property for this project before reading its data.",
    );
  }

  const accessToken = await getAccessToken(
    {
      kv: c.env.CACHE,
      masterKey: c.env.APP_MASTER_KEY,
      config,
      workspaceId: workspace,
      projectId: project,
    },
    connection.refreshTokenEnc,
  );

  return {
    kv: c.env.CACHE,
    accessToken,
    workspaceId: workspace,
    projectId: project,
    property: connection.property,
    range: resolveRange(range, new Date()),
  };
}

/**
 * The project, proven to belong to this workspace.
 *
 * `gsc_connections` is keyed by project id and has no workspace column, so
 * this join is the authorization for every route in the file — the same
 * pattern, for the same reason, as `requireAudit` in routes/audits.ts.
 */
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

export default gsc;
