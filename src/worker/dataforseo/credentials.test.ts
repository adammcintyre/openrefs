import { describe, expect, it } from "vitest";

import { ApiException } from "../http";
import type { CredentialsEnv } from "./credentials";
import { isDevelopment, maskLogin, selectCredentialSource } from "./credentials";

/**
 * Fake values only. The real ones live in .dev.vars, which is git-ignored and
 * must never be reachable from a test fixture.
 */
const OPERATOR_ENV_CREDS = {
  APP_MASTER_KEY: "00".repeat(32),
  DATAFORSEO_LOGIN: "operator@example.com",
  DATAFORSEO_PASSWORD: "not-a-real-password",
};

function env(appEnv: string, overrides: Partial<CredentialsEnv> = {}): CredentialsEnv {
  return { APP_ENV: appEnv, ...OPERATOR_ENV_CREDS, ...overrides };
}

const NO_STORED = { loginEnc: null, passwordEnc: null };
const STORED = { loginEnc: "v1$iv$ct", passwordEnc: "v1$iv$ct2" };

describe("selectCredentialSource — the hosted-tenant spend gate", () => {
  it("REFUSES the env fallback in production even though env credentials exist", () => {
    // The whole point of the gate: a hosted tenant with no key of their own
    // must never spend on the operator's account.
    const production = env("production");
    expect(production.DATAFORSEO_LOGIN).not.toBe("");

    expect(() => selectCredentialSource(production, NO_STORED)).toThrow(
      ApiException,
    );
    try {
      selectCredentialSource(production, NO_STORED);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).code).toBe("no_credentials");
      expect((err as ApiException).status).toBe(409);
      expect((err as ApiException).message).toBe(
        "Add your DataForSEO API credentials in Settings",
      );
    }
  });

  it.each(["production", "staging", "preview", "Development", "", "dev"])(
    "refuses the fallback for APP_ENV=%j — only the exact string unlocks it",
    (appEnv) => {
      expect(() => selectCredentialSource(env(appEnv), NO_STORED)).toThrow(
        ApiException,
      );
    },
  );

  it("uses the env fallback in development", () => {
    expect(selectCredentialSource(env("development"), NO_STORED)).toEqual({
      source: "env",
    });
  });

  it("prefers stored workspace credentials over the env fallback in development", () => {
    expect(selectCredentialSource(env("development"), STORED)).toEqual({
      source: "workspace",
      loginEnc: STORED.loginEnc,
      passwordEnc: STORED.passwordEnc,
    });
  });

  it("uses stored workspace credentials in production — the normal hosted path", () => {
    expect(selectCredentialSource(env("production"), STORED)).toEqual({
      source: "workspace",
      loginEnc: STORED.loginEnc,
      passwordEnc: STORED.passwordEnc,
    });
  });

  it.each([
    ["login only", { loginEnc: "v1$iv$ct", passwordEnc: null }],
    ["password only", { loginEnc: null, passwordEnc: "v1$iv$ct" }],
    ["empty strings", { loginEnc: "", passwordEnc: "" }],
  ])("treats a half-set pair (%s) as unset and refuses in production", (_label, stored) => {
    expect(() => selectCredentialSource(env("production"), stored)).toThrow(
      ApiException,
    );
  });

  it("refuses in development when the operator has not set env credentials either", () => {
    const bare = env("development", {
      DATAFORSEO_LOGIN: "",
      DATAFORSEO_PASSWORD: "",
    });
    expect(() => selectCredentialSource(bare, NO_STORED)).toThrow(ApiException);
  });
});

describe("isDevelopment", () => {
  it("is an exact match on the one unlocking value", () => {
    expect(isDevelopment({ APP_ENV: "development" })).toBe(true);
    expect(isDevelopment({ APP_ENV: "production" })).toBe(false);
    expect(isDevelopment({ APP_ENV: "DEVELOPMENT" })).toBe(false);
    expect(isDevelopment({ APP_ENV: "development " })).toBe(false);
  });
});

describe("maskLogin", () => {
  it("keeps two characters and the domain, which is all a log line needs", () => {
    expect(maskLogin("team@brandpacks.com")).toBe("te***@brandpacks.com");
  });

  it("never returns the full local part", () => {
    for (const login of ["a@b.com", "ab@b.com", "abcdef@b.com"]) {
      const masked = maskLogin(login);
      const local = login.slice(0, login.indexOf("@"));
      if (local.length > 2) expect(masked).not.toContain(local);
      expect(masked).toContain("***");
    }
  });

  it("masks a login that is not an email address", () => {
    expect(maskLogin("someapikeyvalue")).toBe("so***");
    expect(maskLogin("ab")).toBe("***");
    expect(maskLogin("")).toBe("***");
  });
});
