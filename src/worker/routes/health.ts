import { Hono } from "hono";

import type { HealthResponse } from "../../shared/api";
import { APP_VERSION } from "../../shared/version";
import type { AppEnv } from "../types";

const health = new Hono<AppEnv>();

/**
 * Liveness only. Deliberately does not touch D1/KV/R2: this is what uptime
 * checks and the deploy smoke test hit, and it must not cost anything or fail
 * because a binding is cold.
 */
health.get("/", (c) => {
  const body: HealthResponse = { status: "ok", version: APP_VERSION };
  return c.json(body);
});

export default health;
