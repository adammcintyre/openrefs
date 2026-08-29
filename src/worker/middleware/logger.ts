import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../types";

/**
 * One structured line per request, picked up by Workers observability.
 *
 * Deliberately logs only method, path, status and duration. Never add headers,
 * cookies, query strings or bodies here — DataForSEO credentials and session
 * tokens travel in all four, and CLAUDE.md forbids logging secrets.
 */
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const startedAt = Date.now();
  await next();
  console.log(
    JSON.stringify({
      requestId: c.get("requestId"),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    }),
  );
});
