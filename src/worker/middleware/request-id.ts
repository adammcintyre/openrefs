import { createMiddleware } from "hono/factory";

import type { AppEnv } from "../types";

/**
 * Gives every request a stable id: reuses an inbound `x-request-id` when a
 * proxy supplied one, otherwise mints a UUID. Echoed on the response so a user
 * can quote it in a bug report and it can be grepped out of Workers logs.
 */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const inbound = c.req.header("x-request-id");
  const id = inbound && inbound.length <= 128 ? inbound : crypto.randomUUID();
  c.set("requestId", id);
  await next();
  c.header("x-request-id", id);
});
