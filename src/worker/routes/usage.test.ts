import { describe, expect, it } from "vitest";

import { createApp } from "../app";
import { API_PREFIX } from "./index";

const app = createApp();

const PRODUCTION = { APP_ENV: "production" } as Env;
const DEVELOPMENT = { APP_ENV: "development" } as Env;

const paths = [`${API_PREFIX}/usage`, `${API_PREFIX}/usage/balance`];

/**
 * `requireSession` is mounted ahead of query validation, so an anonymous
 * caller learns nothing about the route's parameters — and the temporary
 * pre-auth dev bypass that existed before the auth module landed must stay
 * gone in every environment. Authorized-path behaviour (membership checks,
 * rollups, the balance micro-cache) is exercised against real bindings by the
 * dev-server transcript; these tests pin the guard itself.
 */
describe("usage routes — session guard", () => {
  it.each(paths)(
    "%s is 401 for an anonymous caller in production",
    async (path) => {
      const res = await app.request(
        `${path}?workspace=ws-1`,
        undefined,
        PRODUCTION,
      );
      expect(res.status).toBe(401);
      const body: unknown = await res.json();
      expect(body).toMatchObject({ error: { code: "unauthorized" } });
    },
  );

  it.each(paths)(
    "%s is 401 in development too — the pre-auth bypass is gone",
    async (path) => {
      const res = await app.request(
        `${path}?workspace=ws-1`,
        undefined,
        DEVELOPMENT,
      );
      expect(res.status).toBe(401);
    },
  );

  it.each(paths)(
    "%s rejects an anonymous caller before reading the query at all",
    async (path) => {
      // No workspace param: still 401, never 422 — auth runs first.
      const res = await app.request(path, undefined, PRODUCTION);
      expect(res.status).toBe(401);
    },
  );
});
