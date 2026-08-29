import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiException } from "../http";
import {
  GSC_API_BASE,
  GOOGLE_AUTH_ENDPOINT,
  buildAuthUrl,
  exchangeCode,
  listSites,
  refreshAccessToken,
  revokeToken,
  searchAnalyticsQuery,
} from "./api";
import { GSC_SCOPE } from "./config";

const CLIENT = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "secret" };
const REDIRECT = "https://openrefs.example/api/v1/gsc/callback";
const TOKEN = "ya29.access-token";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* -------------------------------------------------------------------------- */

describe("buildAuthUrl", () => {
  const url = () =>
    new URL(
      buildAuthUrl({
        clientId: CLIENT.clientId,
        redirectUri: REDIRECT,
        state: "g1.payload.signature",
      }),
    );

  it("points at Google's documented v2 auth endpoint over HTTPS", () => {
    const parsed = url();
    expect(`${parsed.origin}${parsed.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
    // "This endpoint is accessible only over HTTPS. Plain HTTP is refused."
    expect(parsed.protocol).toBe("https:");
  });

  it("carries every parameter the web-server flow requires", () => {
    const params = url().searchParams;
    expect(params.get("client_id")).toBe(CLIENT.clientId);
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe(GSC_SCOPE);
    expect(params.get("state")).toBe("g1.payload.signature");
  });

  it("asks for offline access with a forced consent screen", () => {
    // Together these are what guarantee a refresh token: Google only issues
    // one on the *first* grant otherwise, so a reconnect would complete and
    // leave us with nothing to store.
    const params = url().searchParams;
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
  });

  it("requests exactly one scope, and a read-only one", () => {
    const scope = url().searchParams.get("scope") as string;
    // The parameter is space-delimited; one scope means no spaces.
    expect(scope.split(" ")).toHaveLength(1);
    expect(scope).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(scope).toContain(".readonly");
  });

  it("omits include_granted_scopes — no incremental widening", () => {
    expect(url().searchParams.has("include_granted_scopes")).toBe(false);
  });

  it("percent-encodes the redirect URI rather than splicing it raw", () => {
    const raw = buildAuthUrl({
      clientId: CLIENT.clientId,
      redirectUri: REDIRECT,
      state: "s",
    });
    expect(raw).toContain("redirect_uri=https%3A%2F%2Fopenrefs.example%2F");
  });
});

/* -------------------------------------------------------------------------- */

describe("exchangeCode", () => {
  it("sends a form-encoded authorization_code grant", async () => {
    fetchMock.mockResolvedValue(
      json({
        access_token: TOKEN,
        expires_in: 3599,
        refresh_token: "1//refresh",
        scope: GSC_SCOPE,
        token_type: "Bearer",
      }),
    );

    const tokens = await exchangeCode({
      ...CLIENT,
      code: "4/auth-code",
      redirectUri: REDIRECT,
    });

    expect(tokens).toEqual({
      accessToken: TOKEN,
      expiresIn: 3599,
      refreshToken: "1//refresh",
      scope: GSC_SCOPE,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("4/auth-code");
    // Must be byte-identical to the auth request's, or redirect_uri_mismatch.
    expect(body.get("redirect_uri")).toBe(REDIRECT);
  });

  it("reports a missing refresh token as null rather than inventing one", async () => {
    fetchMock.mockResolvedValue(json({ access_token: TOKEN, expires_in: 3599 }));
    const tokens = await exchangeCode({
      ...CLIENT,
      code: "c",
      redirectUri: REDIRECT,
    });
    expect(tokens.refreshToken).toBeNull();
  });

  it("defaults expires_in when Google omits it", async () => {
    fetchMock.mockResolvedValue(json({ access_token: TOKEN }));
    const tokens = await exchangeCode({
      ...CLIENT,
      code: "c",
      redirectUri: REDIRECT,
    });
    expect(tokens.expiresIn).toBe(3600);
  });

  it("maps invalid_grant to a reconnect, not a retry", async () => {
    fetchMock.mockResolvedValue(
      json({ error: "invalid_grant", error_description: "Bad Request" }, 400),
    );
    await expect(
      exchangeCode({ ...CLIENT, code: "used", redirectUri: REDIRECT }),
    ).rejects.toMatchObject({ code: "gsc_reconnect_required" });
  });

  it("rejects a 200 whose body is not a token response", async () => {
    fetchMock.mockResolvedValue(json({ hello: "world" }));
    await expect(
      exchangeCode({ ...CLIENT, code: "c", redirectUri: REDIRECT }),
    ).rejects.toMatchObject({ code: "gsc_error" });
  });

  it("rejects a non-JSON body without leaking it", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", { status: 502 }),
    );
    const err = await exchangeCode({
      ...CLIENT,
      code: "c",
      redirectUri: REDIRECT,
    }).catch((e: unknown) => e);
    expect((err as ApiException).code).toBe("gsc_error");
    expect((err as ApiException).message).not.toContain("<html>");
  });

  it("does not retry — an authorization code is single-use", async () => {
    fetchMock.mockResolvedValue(json({ access_token: TOKEN, expires_in: 60 }));
    await exchangeCode({ ...CLIENT, code: "c", redirectUri: REDIRECT });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("refreshAccessToken", () => {
  it("omits redirect_uri, which is not part of this grant", async () => {
    fetchMock.mockResolvedValue(json({ access_token: TOKEN, expires_in: 3599 }));
    await refreshAccessToken({ ...CLIENT, refreshToken: "1//r" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URLSearchParams(init.body as string).get("redirect_uri")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe("revokeToken", () => {
  it("reports success on HTTP 200", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(revokeToken("1//r")).resolves.toBe(true);
  });

  it("reports failure on HTTP 400 without throwing", async () => {
    // Google returns 400 for "error conditions", which includes a token that
    // was already invalid. Its callers delete regardless.
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    await expect(revokeToken("1//r")).resolves.toBe(false);
  });

  it("swallows a network failure — deletion must never depend on Google", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(revokeToken("1//r")).resolves.toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("listSites", () => {
  it("reads the documented siteEntry array", async () => {
    fetchMock.mockResolvedValue(
      json({
        siteEntry: [
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
          { siteUrl: "https://blog.example.com/", permissionLevel: "siteFullUser" },
        ],
      }),
    );

    await expect(listSites(TOKEN)).resolves.toEqual([
      { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
      { siteUrl: "https://blog.example.com/", permissionLevel: "siteFullUser" },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${GSC_API_BASE}sites`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("treats an omitted siteEntry as no properties, not a failure", async () => {
    // Google's serializer drops empty arrays, so an account with no verified
    // properties answers `{}`.
    fetchMock.mockResolvedValue(json({}));
    await expect(listSites(TOKEN)).resolves.toEqual([]);
  });

  it("keeps unverified properties in the list", async () => {
    // Filtering them out would make a property silently absent from the
    // picker; showing it lets Google give the truthful refusal instead.
    fetchMock.mockResolvedValue(
      json({
        siteEntry: [
          { siteUrl: "sc-domain:x.com", permissionLevel: "siteUnverifiedUser" },
        ],
      }),
    );
    await expect(listSites(TOKEN)).resolves.toHaveLength(1);
  });

  it("maps a 403 to gsc_error, not to a reconnect prompt", async () => {
    // Reconnecting the same account would not grant it access to a property
    // it cannot read, so this must not show a reconnect CTA.
    fetchMock.mockResolvedValue(
      json(
        { error: { code: 403, message: "User does not have sufficient permission." } },
        403,
      ),
    );
    const err = await listSites(TOKEN).catch((e: unknown) => e);
    expect((err as ApiException).code).toBe("gsc_error");
    expect((err as ApiException).message).toContain("sufficient permission");
  });

  it("maps a 401 to a reconnect", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 401, message: "Invalid Credentials" } }, 401),
    );
    await expect(listSites(TOKEN)).rejects.toMatchObject({
      code: "gsc_reconnect_required",
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("searchAnalyticsQuery", () => {
  const base = {
    startDate: "2026-08-01",
    endDate: "2026-08-28",
    dimensions: ["query"],
    rowLimit: 5000,
  };

  it("percent-encodes a domain property into the path", async () => {
    fetchMock.mockResolvedValue(json({ rows: [] }));
    await searchAnalyticsQuery(TOKEN, {
      ...base,
      siteUrl: "sc-domain:example.com",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    // The colon would otherwise read as a path-segment delimiter.
    expect(url).toBe(
      `${GSC_API_BASE}sites/sc-domain%3Aexample.com/searchAnalytics/query`,
    );
  });

  it("percent-encodes a URL-prefix property, trailing slash included", async () => {
    fetchMock.mockResolvedValue(json({ rows: [] }));
    await searchAnalyticsQuery(TOKEN, {
      ...base,
      siteUrl: "https://example.com/",
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      `${GSC_API_BASE}sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query`,
    );
  });

  it("posts the documented request body and omits the defaulted fields", async () => {
    fetchMock.mockResolvedValue(json({ rows: [] }));
    await searchAnalyticsQuery(TOKEN, {
      ...base,
      siteUrl: "sc-domain:example.com",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-28",
      dimensions: ["query"],
      rowLimit: 5000,
    });
    // Defaults we rely on: type=web, dataState=final, aggregationType=auto.
    expect(body).not.toHaveProperty("type");
    expect(body).not.toHaveProperty("dataState");
    expect(body).not.toHaveProperty("aggregationType");
    // Deprecated; sending it is a mistake.
    expect(body).not.toHaveProperty("searchType");
  });

  it("normalises rows, keeping keys in the requested dimension order", async () => {
    fetchMock.mockResolvedValue(
      json({
        rows: [
          {
            keys: ["seo tools", "https://example.com/tools"],
            clicks: 12,
            impressions: 340,
            ctr: 0.0352941176,
            position: 6.4,
          },
        ],
        responseAggregationType: "byPage",
      }),
    );

    await expect(
      searchAnalyticsQuery(TOKEN, {
        ...base,
        dimensions: ["query", "page"],
        siteUrl: "sc-domain:example.com",
      }),
    ).resolves.toEqual([
      {
        keys: ["seo tools", "https://example.com/tools"],
        clicks: 12,
        impressions: 340,
        ctr: 0.0352941176,
        position: 6.4,
      },
    ]);
  });

  it("treats an omitted rows array as no data", async () => {
    // Documented: "a successful response with zero rows", and days without
    // data are omitted rather than zero-filled.
    fetchMock.mockResolvedValue(json({}));
    await expect(
      searchAnalyticsQuery(TOKEN, { ...base, siteUrl: "sc-domain:example.com" }),
    ).resolves.toEqual([]);
  });

  it("fills absent metrics with zero rather than undefined", async () => {
    fetchMock.mockResolvedValue(json({ rows: [{ keys: ["x"] }] }));
    await expect(
      searchAnalyticsQuery(TOKEN, { ...base, siteUrl: "sc-domain:example.com" }),
    ).resolves.toEqual([
      { keys: ["x"], clicks: 0, impressions: 0, ctr: 0, position: 0 },
    ]);
  });

  it("maps a timeout to upstream_timeout", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error("slow"), { name: "TimeoutError" }),
    );
    await expect(
      searchAnalyticsQuery(TOKEN, { ...base, siteUrl: "sc-domain:example.com" }),
    ).rejects.toMatchObject({ code: "upstream_timeout" });
  });

  it("forwards Google's message on an unexpected status", async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 429, message: "Quota exceeded." } }, 429),
    );
    const err = await searchAnalyticsQuery(TOKEN, {
      ...base,
      siteUrl: "sc-domain:example.com",
    }).catch((e: unknown) => e);
    expect((err as ApiException).code).toBe("gsc_error");
    expect((err as ApiException).message).toContain("Quota exceeded.");
  });
});
