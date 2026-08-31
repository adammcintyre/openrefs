import type { Hono } from "hono";

import type { AppEnv } from "../types";
import ai from "./ai";
import audits from "./audits";
import auth from "./auth";
import backlinks from "./backlinks";
import collections from "./collections";
import content from "./content";
import dashboard from "./dashboard";
import dev from "./dev";
import domains from "./domains";
import gap from "./gap";
import gsc from "./gsc";
import health from "./health";
import history from "./history";
import keywords from "./keywords";
import mcp from "./mcp";
import meta from "./meta";
import openapi from "./openapi";
import projects from "./projects";
import usage from "./usage";
import workspaces from "./workspaces";

/** Every API path lives under this prefix. Versioned, never unversioned. */
export const API_PREFIX = "/api/v1";

export interface RouteModule {
  /** Mount path relative to API_PREFIX, e.g. "/auth". */
  path: string;
  router: Hono<AppEnv>;
  /**
   * Registry key, when `path` is not a unique one.
   *
   * Two modules may legitimately share a mount point — AI Visibility hangs off
   * `/projects` beside the projects module — and the mount test keys its probe
   * table by module. Defaults to `path`.
   */
  label?: string;
}

/**
 * The router registry. One entry per module, one file per module, so agents
 * working on different features never edit the same file — adding a feature
 * means a new file plus one line here.
 */
export const routeModules: RouteModule[] = [
  { path: "/health", router: health },
  { path: "/auth", router: auth },
  { path: "/workspaces", router: workspaces },
  { path: "/usage", router: usage },
  { path: "/keywords", router: keywords },
  { path: "/domains", router: domains },
  { path: "/backlinks", router: backlinks },
  { path: "/gap", router: gap },
  { path: "/collections", router: collections },
  // The research trail. Written by the keywords/domains/gap routes, read and
  // cleared here; pure D1, so nothing under it can spend.
  { path: "/history", router: history },
  { path: "/content", router: content },
  { path: "/projects", router: projects },
  /*
   * AI Visibility mounts on the same prefix rather than as a sub-router of
   * routes/projects.ts: its paths all begin `/:id/ai/`, Hono matches both
   * routers under `/projects`, and the module stays one file with one owner.
   */
  { path: "/projects", label: "/projects/ai", router: ai },
  // Audits are reached two ways: `/projects/:id/audits` (list + create), which
  // the projects router mounts as a sub-router, and `/audits/:auditId` for one
  // audit, mounted here. Both live in routes/audits.ts.
  { path: "/audits", router: audits },
  { path: "/dashboard", router: dashboard },
  // Search Console. Config-gated: with no Google OAuth client set, /gsc/status
  // reports `configured: false` and every other route here answers 409.
  { path: "/gsc", router: gsc },
  { path: "/meta", router: meta },
  // The public API description. No auth: it documents how to authenticate.
  { path: "/openapi.json", router: openapi },
  // Model Context Protocol, for agent clients. Also mounted at a bare `/mcp`
  // by createApp — see the note there.
  { path: "/mcp", router: mcp },
  // Every route in this module 404s unless APP_ENV === "development".
  { path: "/dev", router: dev },
];

export function registerRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  for (const { path, router } of routeModules) {
    app.route(`${API_PREFIX}${path}`, router);
  }
  return app;
}
