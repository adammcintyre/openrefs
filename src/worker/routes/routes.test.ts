import { describe, expect, it } from "vitest";

import { isApiErrorBody } from "../../shared/api";
import { APP_VERSION } from "../../shared/version";
import { createApp } from "../app";
import { API_PREFIX, routeModules } from "./index";

const app = createApp();

describe("route registry", () => {
  it("mounts every module under the versioned prefix", async () => {
    // A development env so /dev is visible; see dev.test.ts for the gate
    // itself. No binding is touched — every module answers this bare request
    // from validation or a stub, before it reaches D1.
    const env = { APP_ENV: "development" } as Env;
    for (const { path } of routeModules) {
      const res = await app.request(`${API_PREFIX}${path}`, undefined, env);
      expect(res.status, `${path} should be mounted`).not.toBe(404);
    }
  });

  it("returns the standard error shape for an unknown endpoint", async () => {
    const res = await app.request(`${API_PREFIX}/does-not-exist`);
    expect(res.status).toBe(404);

    const body: unknown = await res.json();
    expect(isApiErrorBody(body)).toBe(true);
    expect(body).toMatchObject({ error: { code: "not_found" } });
  });

  it("echoes a request id on every response", async () => {
    const res = await app.request(`${API_PREFIX}/health`, {
      headers: { "x-request-id": "abc-123" },
    });
    expect(res.headers.get("x-request-id")).toBe("abc-123");
  });
});

describe("GET /api/v1/health", () => {
  it("reports ok with the app version", async () => {
    const res = await app.request(`${API_PREFIX}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      version: APP_VERSION,
    });
  });
});

describe("unimplemented module stubs", () => {
  // /usage is implemented; see usage.test.ts.
  const stubs = ["/auth", "/workspaces"];

  it.each(stubs)("%s responds 501 with code not_implemented", async (path) => {
    const res = await app.request(`${API_PREFIX}${path}`);
    expect(res.status).toBe(501);

    const body: unknown = await res.json();
    expect(isApiErrorBody(body)).toBe(true);
    expect(body).toMatchObject({ error: { code: "not_implemented" } });
  });

  it.each(stubs)("%s stubs every sub-path and method", async (path) => {
    const res = await app.request(`${API_PREFIX}${path}/anything/deep`, {
      method: "POST",
    });
    expect(res.status).toBe(501);
  });
});
