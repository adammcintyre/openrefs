import type { Hono } from "hono";

import type { AppEnv } from "../types";
import auth from "./auth";
import backlinks from "./backlinks";
import collections from "./collections";
import dev from "./dev";
import domains from "./domains";
import gap from "./gap";
import health from "./health";
import keywords from "./keywords";
import meta from "./meta";
import usage from "./usage";
import workspaces from "./workspaces";

/** Every API path lives under this prefix. Versioned, never unversioned. */
export const API_PREFIX = "/api/v1";

export interface RouteModule {
  /** Mount path relative to API_PREFIX, e.g. "/auth". */
  path: string;
  router: Hono<AppEnv>;
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
  { path: "/meta", router: meta },
  // Every route in this module 404s unless APP_ENV === "development".
  { path: "/dev", router: dev },
];

export function registerRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  for (const { path, router } of routeModules) {
    app.route(`${API_PREFIX}${path}`, router);
  }
  return app;
}
