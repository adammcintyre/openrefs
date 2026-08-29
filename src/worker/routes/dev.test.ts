import { describe, expect, it } from "vitest";

import { createApp } from "../app";
import { API_PREFIX } from "./index";

const app = createApp();

const DEV = { APP_ENV: "development" } as Env;
const PRODUCTION = { APP_ENV: "production" } as Env;

/**
 * The dev router spends real money against a real DataForSEO account, so the
 * only property worth testing hard is that it does not exist anywhere except
 * a developer's laptop.
 */
describe("/api/v1/dev visibility gate", () => {
  const paths = [`${API_PREFIX}/dev`, `${API_PREFIX}/dev/dfs-smoke`];

  it.each(paths)("%s is 404 when APP_ENV is not development", async (path) => {
    const res = await app.request(path, undefined, PRODUCTION);
    expect(res.status).toBe(404);
  });

  it.each(paths)(
    "%s is indistinguishable from an endpoint that does not exist",
    async (path) => {
      const gated = await app.request(path, undefined, PRODUCTION);
      const missing = await app.request(
        `${API_PREFIX}/no-such-thing`,
        undefined,
        PRODUCTION,
      );
      expect(gated.status).toBe(missing.status);
      await expect(gated.json()).resolves.toEqual(await missing.json());
    },
  );

  it.each(["", "dev", "Development", "staging", "preview"])(
    "stays hidden for the near-miss APP_ENV value %j",
    async (appEnv) => {
      const res = await app.request(
        `${API_PREFIX}/dev/dfs-smoke`,
        undefined,
        { APP_ENV: appEnv } as Env,
      );
      expect(res.status).toBe(404);
    },
  );

  it("is visible in development", async () => {
    const res = await app.request(`${API_PREFIX}/dev`, undefined, DEV);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { routes: { path: string }[] };
    expect(body.routes.map((r) => r.path)).toContain(
      `${API_PREFIX}/dev/dfs-smoke`,
    );
  });
});
