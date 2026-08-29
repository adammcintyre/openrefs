import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ApiErrorBody } from "../shared/api";
import { ApiException, apiError } from "./http";
import { loadSession } from "./middleware/auth";
import { requestLogger } from "./middleware/logger";
import { requestId } from "./middleware/request-id";
import { registerRoutes } from "./routes";
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
