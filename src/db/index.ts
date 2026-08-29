import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export * from "./schema";
export { schema };

/**
 * The single way to reach D1. Cheap to call — build one per request in a Hono
 * middleware rather than caching a module-level instance, because the D1
 * binding belongs to the request's `env`, not to the isolate.
 */
export function getDb(db: D1Database) {
  return drizzle(db, { schema });
}

export type Db = ReturnType<typeof getDb>;
