/**
 *   GET /api/v1/openapi.json
 *
 * The machine-readable description of this API. Public and unauthenticated on
 * purpose: it documents how to authenticate, so requiring authentication to
 * read it would be a closed loop. It also contains nothing tenant-specific —
 * it is the same document for every deployment of OpenRefs at a given version.
 *
 * Cached for an hour at the edge and in the browser. The document only changes
 * when the Worker is redeployed, and `info.version` moves with `APP_VERSION`,
 * so a stale copy is at worst one deploy behind and is self-identifying.
 */
import { Hono } from "hono";

import { openApiDocument } from "../openapi";
import type { AppEnv } from "../types";

const openapi = new Hono<AppEnv>();

openapi.get("/", (c) =>
  c.json(openApiDocument, 200, {
    "cache-control": "public, max-age=3600",
  }),
);

export default openapi;
