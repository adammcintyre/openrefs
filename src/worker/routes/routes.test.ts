import { describe, expect, it } from "vitest";

import { isApiErrorBody } from "../../shared/api";
import { APP_VERSION } from "../../shared/version";
import { createApp } from "../app";
import { API_PREFIX, routeModules } from "./index";

const app = createApp();

/**
 * A path per module that must resolve to *something*. Modules whose root is
 * not a route (auth) need an explicit probe, and a new module with no entry
 * here fails the mount test rather than silently skipping it.
 *
 * These requests carry no cookie and no bearer key, so `loadSession` takes its
 * anonymous fast path and never touches D1 — which is why they run under plain
 * vitest with no bindings.
 */
const MOUNT_PROBES: Record<string, string> = {
  "/health": "/health",
  "/auth": "/auth/me",
  "/workspaces": "/workspaces",
  "/usage": "/usage",
  "/keywords": "/keywords/overview",
  "/domains": "/domains/overview",
  "/backlinks": "/backlinks/summary",
  "/gap": "/gap/keywords",
  "/collections": "/collections",
  "/meta": "/meta/locations",
  "/dev": "/dev/dfs-smoke",
};

describe("route registry", () => {
  it("mounts every module under the versioned prefix", async () => {
    // A development env so /dev is visible; see dev.test.ts for the gate
    // itself. No binding is touched — every module answers this bare request
    // from validation or a stub, before it reaches D1.
    const env = { APP_ENV: "development" } as Env;
    for (const { path } of routeModules) {
      const probe = MOUNT_PROBES[path];
      expect(probe, `add a MOUNT_PROBES entry for ${path}`).toBeDefined();

      const res = await app.request(`${API_PREFIX}${probe as string}`, undefined, env);
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

  it("stays public — health checks have no session", async () => {
    const res = await app.request(`${API_PREFIX}/health`);
    expect(res.status).not.toBe(401);
  });
});

describe("session guard", () => {
  const guarded: [string, string][] = [
    ["GET", "/auth/me"],
    ["DELETE", "/auth/me"],
    ["GET", "/workspaces"],
    ["POST", "/workspaces"],
    ["GET", "/workspaces/8f8f0b9e-1f3a-4a2e-9a1a-9a2b3c4d5e6f/members"],
    ["POST", "/workspaces/invites/accept"],
    // Phase 1. Every one of these can spend money or read tenant data, so the
    // 401 must land before validation — a caller with no session should never
    // learn whether their query was well-formed.
    ["GET", "/keywords/overview"],
    ["GET", "/keywords/ideas"],
    ["GET", "/keywords/suggestions"],
    ["GET", "/keywords/related"],
    ["GET", "/keywords/serp"],
    ["GET", "/domains/overview"],
    ["GET", "/domains/history"],
    ["GET", "/domains/keywords"],
    ["GET", "/domains/pages"],
    ["GET", "/domains/competitors"],
    ["GET", "/domains/countries"],
    // Phase 2. Same rule as above: these spend money, so the 401 lands before
    // validation and an anonymous caller never learns whether their query was
    // well-formed.
    ["GET", "/backlinks/summary"],
    ["GET", "/backlinks/list"],
    ["GET", "/backlinks/referring-domains"],
    ["GET", "/backlinks/anchors"],
    ["GET", "/backlinks/history"],
    ["POST", "/backlinks/scores"],
    ["GET", "/gap/keywords"],
    ["GET", "/gap/keywords/export.csv"],
    ["GET", "/gap/pages"],
    ["GET", "/collections"],
    ["POST", "/collections"],
    ["GET", "/collections/abc"],
    ["PATCH", "/collections/abc"],
    ["DELETE", "/collections/abc"],
    ["POST", "/collections/abc/keywords"],
    ["DELETE", "/collections/abc/keywords"],
    ["GET", "/collections/abc/export.csv"],
    // Free and non-tenant, but still not public.
    ["GET", "/meta/locations"],
    ["GET", "/meta/languages"],
  ];

  it.each(guarded)(
    "%s %s rejects an anonymous caller with 401",
    async (method, path) => {
      const res = await app.request(`${API_PREFIX}${path}`, { method });
      expect(res.status).toBe(401);

      const body: unknown = await res.json();
      expect(body).toMatchObject({ error: { code: "unauthorized" } });
    },
  );

  it("ignores a bearer token that is not an OpenRefs API key", async () => {
    // Must not be treated as a credential, and must not reach D1 looking it up.
    const res = await app.request(`${API_PREFIX}/workspaces`, {
      headers: { authorization: "Bearer github_pat_totally_unrelated" },
    });
    expect(res.status).toBe(401);
  });
});

describe("request validation", () => {
  it("rejects a login with no JSON body as bad_request", async () => {
    const res = await app.request(`${API_PREFIX}/auth/login`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "bad_request" } });
  });

  it("rejects a malformed registration before touching any binding", async () => {
    const res = await app.request(`${API_PREFIX}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "short" }),
    });
    expect(res.status).toBe(422);

    const body: unknown = await res.json();
    expect(isApiErrorBody(body)).toBe(true);
    expect(body).toMatchObject({ error: { code: "validation_failed" } });
  });

  it("reports which fields failed so the form can highlight them", async () => {
    const res = await app.request(`${API_PREFIX}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "tooshort" }),
    });
    expect(res.status).toBe(422);

    const body = (await res.json()) as {
      error: { details?: { fieldErrors?: Record<string, string[]> } };
    };
    expect(body.error.details?.fieldErrors).toHaveProperty("password");
  });
});
