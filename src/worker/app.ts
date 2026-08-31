import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ApiErrorBody } from "../shared/api";
import { ApiException, apiError } from "./http";
import { loadSession } from "./middleware/auth";
import { requestLogger } from "./middleware/logger";
import { requestId } from "./middleware/request-id";
import { registerRoutes } from "./routes";
import mcp from "./routes/mcp";
import type { AppEnv } from "./types";

/**
 * Builds the API. Exported as a factory rather than a module-level singleton
 * so tests can construct a fresh app and drive it with `app.request(...)`.
 */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", requestId);
  app.use("*", requestLogger);
  app.use("*", loadSession);

  registerRoutes(app);

  /*
   * The MCP endpoint again, at a bare `/mcp`.
   *
   * It is already mounted at `/api/v1/mcp` by the registry above, and that is
   * the canonical path. This alias exists because MCP clients are configured
   * with a single URL typed by a human into a JSON config file, and every
   * server in the ecosystem publishes that URL as `https://host/mcp`. Making
   * people discover a versioned path buys nothing: the protocol carries its own
   * version in every message, so this endpoint has no use for ours.
   *
   * Note that `wrangler.jsonc` has to list `/mcp` in `run_worker_first`, or the
   * asset server answers it with the SPA's index.html before the Worker ever
   * sees it.
   */
  app.route("/mcp", mcp);

  // Anything reaching the Worker that isn't a route is an API miss: static
  // assets are served ahead of us by the assets binding.
  app.notFound((c) => apiError(c, "not_found", "No such endpoint."));

  app.onError((err, c) => {
    if (err instanceof ApiException) {
      return apiError(c, err.code, err.message, err.details);
    }

    if (err instanceof HTTPException) {
      const body: ApiErrorBody = {
        error: {
          code: err.status === 404 ? "not_found" : "bad_request",
          message: err.message,
        },
      };
      return c.json(body, err.status);
    }

    // Unexpected. Log with the request id for correlation, but never leak the
    // message to the client — it can contain upstream credentials or SQL.
    console.error(
      JSON.stringify({
        requestId: c.get("requestId"),
        level: "error",
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    return apiError(c, "internal_error", "Something went wrong.");
  });

  return app;
}
