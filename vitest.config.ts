import { defineConfig } from "vitest/config";

// Deliberately does NOT load vite.config.ts: tests run in plain Node, not the
// Workers runtime. Hono routing is exercised through `app.request()`, which
// needs no bindings. If a later phase needs real D1/KV/R2 in tests, add
// @cloudflare/vitest-plugin here rather than reaching for globals.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
