import { defineConfig } from "drizzle-kit";

// Migrations are generated here and applied with
// `wrangler d1 migrations apply openrefs-db [--local]`, so drizzle-kit only
// needs the dialect — no D1 HTTP credentials are required or wanted.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
