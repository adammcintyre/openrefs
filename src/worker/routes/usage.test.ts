import { describe, expect, it } from "vitest";

import { isApiErrorBody } from "../../shared/api";
import { ApiException } from "../http";
import { createApp } from "../app";
import { API_PREFIX } from "./index";
import { requireSessionOrDevBypass } from "./usage";

const app = createApp();

const PRODUCTION = { APP_ENV: "production" } as Env;

const paths = [`${API_PREFIX}/usage`, `${API_PREFIX}/usage/balance`];

describe("usage routes — workspace scoping", () => {
  it.each(paths)("%s rejects a request with no workspace", async (path) => {
    const res = await app.request(path, undefined, PRODUCTION);
    expect(res.status).toBe(422);

    const body: unknown = await res.json();
    expect(isApiErrorBody(body)).toBe(true);
    expect(body).toMatchObject({ error: { code: "validation_failed" } });
  });

  it.each(paths)("%s rejects a blank workspace id", async (path) => {
    const res = await app.request(`${path}?workspace=%20`, undefined, PRODUCTION);
    expect(res.status).toBe(422);
  });

  it.each(paths)(
    "%s is 401 without a session once APP_ENV is not development",
    async (path) => {
      // The stub middleware always yields a null session, so this is the
      // deployed behaviour: no session, no data, whatever workspace is asked
      // for. The check runs before any D1 access, which is why this test needs
      // no bindings.
      const res = await app.request(`${path}?workspace=ws-1`, undefined, PRODUCTION);
      expect(res.status).toBe(401);

      const body: unknown = await res.json();
      expect(body).toMatchObject({ error: { code: "unauthorized" } });
    },
  );
});

describe("requireSessionOrDevBypass", () => {
  const session = { userId: "user-1" };

  it("returns the session when there is one", () => {
    expect(requireSessionOrDevBypass({ APP_ENV: "production" }, session)).toBe(
      session,
    );
    expect(requireSessionOrDevBypass({ APP_ENV: "development" }, session)).toBe(
      session,
    );
  });

  it("throws 401 for a null session outside development", () => {
    try {
      requireSessionOrDevBypass({ APP_ENV: "production" }, null);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).code).toBe("unauthorized");
      expect((err as ApiException).status).toBe(401);
    }
  });

  it("bypasses in development while the auth middleware is still a stub", () => {
    // Documented, temporary, and self-removing: the bypass is conditional on
    // AUTH_ENFORCED being false, so it disappears when auth lands rather than
    // needing to be remembered.
    expect(requireSessionOrDevBypass({ APP_ENV: "development" }, null)).toBeNull();
  });
});
