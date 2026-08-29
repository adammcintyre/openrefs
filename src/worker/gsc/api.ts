/**
 * The only place OpenRefs talks to Google.
 *
 * **Why this is not the DataForSEO client.** CLAUDE.md hard rule #4 — "every
 * DataForSEO call goes through src/worker/dataforseo/client.ts" — exists
 * because those calls cost money, need per-workspace credentials, and must be
 * metered against a spend cap. None of that is true here: Search Console is
 * free, authenticated by the *user's own* OAuth grant, and cannot spend a
 * cent. Routing it through a client built around billing would mean faking a
 * cost for every call and meaning nothing by it. So this module is the
 * equivalent seam for Google: one place that owns the timeout, the error
 * mapping and the wire shapes, and which nothing bypasses.
 *
 * Every shape below is transcribed from Google's documentation, cited inline.
 * Nothing here is guessed; where a field is optional in the docs it is optional
 * in the parser.
 */
import { z } from "zod";

import type { GscMetrics } from "../../shared/gsc";
import { ApiException } from "../http";
import { GSC_SCOPE } from "./config";

/* -------------------------------------------------------------------------- */
/* Endpoints                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * OAuth 2.0 for Web Server Applications:
 * https://developers.google.com/identity/protocols/oauth2/web-server
 */
export const GOOGLE_AUTH_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Revocation. Documented under "Revoking a token" in the same guide:
 * https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
 */
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/**
 * Search Console API v3.
 *
 * Two hosts serve this identically: the HTML reference documents every method
 * against `https://www.googleapis.com/webmasters/v3/…`, while the discovery
 * document gives `rootUrl: "https://searchconsole.googleapis.com/"` with the
 * same `webmasters/v3/…` path. The documented one is used here so the code
 * matches the pages it cites:
 * https://developers.google.com/webmaster-tools/v1/sites/list
 * https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 *
 * (Only `urlInspection.index.inspect` is exclusive to the newer host, and this
 * module does not call it.)
 */
export const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3/";

/**
 * One attempt, twenty seconds, no retry.
 *
 * The DataForSEO client retries a hung connection because its endpoints
 * genuinely stall for a minute at a time. Google's do not — and one of the
 * calls made here, the authorization-code exchange, is **single-use**: a
 * retried code is a burnt code, and the user would be sent back through
 * consent for no reason. A blanket no-retry rule is simpler than a per-call
 * exception list, and the failure mode is a visible error with a retry button
 * rather than a silent double-spend.
 */
export const GSC_TIMEOUT_MS = 20_000;

/* -------------------------------------------------------------------------- */
/* Authorization URL                                                           */
/* -------------------------------------------------------------------------- */

export interface AuthUrlOptions {
  clientId: string;
  redirectUri: string;
  /** The signed token from gsc/state.ts. */
  state: string;
}

/**
 * The URL the browser is redirected to for consent.
 *
 * Parameter names and semantics from
 * https://developers.google.com/identity/protocols/oauth2/web-server#creatingclient:
 *
 *  - `access_type=offline` is what makes Google issue a **refresh token**.
 *    Without it we would get a one-hour access token and no way to renew it,
 *    so every report would need the user to re-consent.
 *  - `prompt=consent` forces the consent screen even for a user who has
 *    already granted the scope. Google only returns a refresh token on the
 *    *first* grant otherwise, so a user who disconnects and reconnects — or
 *    who connects a second project — would complete the flow and leave us with
 *    nothing to store. docs/specs/PHASE5.md requires this for that reason.
 *  - `include_granted_scopes` is deliberately **omitted**: incremental
 *    authorization would silently widen the token to scopes granted elsewhere,
 *    and this integration wants exactly one, read-only scope and no more.
 */
export function buildAuthUrl({
  clientId,
  redirectUri,
  state,
}: AuthUrlOptions): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GSC_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A successful token response.
 * https://developers.google.com/identity/protocols/oauth2/web-server#exchange-authorization-code
 *
 * `refresh_token` is optional in the schema because it is optional on the
 * wire: Google returns it on the authorization-code exchange (with
 * `access_type=offline`) and **never** on a refresh-token exchange. Callers
 * treat its absence differently in each case.
 */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

/**
 * The OAuth 2.0 error body (RFC 6749 §5.2), which Google returns from the
 * token and revoke endpoints — note it is a *flat* `error` string, unlike the
 * nested object the Search Console API returns.
 *
 * The web-server guide lists the error *codes* but never shows the body; the
 * shape is documented verbatim at
 * https://developers.google.com/identity/protocols/oauth2/limited-input-device
 * as `{ "error": "access_denied", "error_description": "Forbidden" }`.
 * `error_description` is a terse reason phrase, not an explanation, which is
 * why the messages below do not simply forward it to the user.
 */
const oauthErrorSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
});

/**
 * The Google API error envelope, used by the Search Console API:
 * https://developers.google.com/webmaster-tools/v1/errors
 */
const googleApiErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  }),
});

/**
 * `sites.list` — https://developers.google.com/webmaster-tools/v1/sites/list
 *
 * `siteEntry` is absent, not empty, for an account with no verified
 * properties, so it is optional here and defaulted by the caller.
 */
const sitesListSchema = z.object({
  siteEntry: z
    .array(
      z.object({
        siteUrl: z.string(),
        permissionLevel: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * `searchanalytics.query` —
 * https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 *
 * `rows` is omitted entirely when a query matches nothing, which is why it is
 * optional rather than an empty array. `keys` holds one entry per requested
 * dimension, in the order they were requested.
 */
const searchAnalyticsSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).optional(),
        clicks: z.number().optional(),
        impressions: z.number().optional(),
        ctr: z.number().optional(),
        position: z.number().optional(),
      }),
    )
    .optional(),
  responseAggregationType: z.string().optional(),
});

/** One `searchanalytics.query` row, normalised: no optionals, keys unpacked. */
export interface SearchAnalyticsRow extends GscMetrics {
  /** One value per requested dimension, in the order requested. */
  keys: string[];
}

export interface GoogleTokens {
  accessToken: string;
  /** Seconds until the access token expires. Google documents 3600. */
  expiresIn: number;
  /** Only present on the authorization-code exchange. */
  refreshToken: string | null;
  scope: string | null;
}

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One HTTP round trip to Google, with the timeout and the network-error
 * mapping. Response *interpretation* is the caller's, because the token
 * endpoint and the API endpoints report failure in two different shapes.
 */
async function call(
  label: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(GSC_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiException(
        "upstream_timeout",
        `Google didn't respond in time (${GSC_TIMEOUT_MS / 1000}s) for ${label}. Try again shortly.`,
        { label },
      );
    }
    // The underlying message can carry the request URL, which contains the
    // client id and, on the token endpoint, would carry more. Not forwarded.
    throw new ApiException("gsc_error", `Could not reach Google (${label}).`);
  }
}

async function readJson(res: Response, label: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new ApiException(
      "gsc_error",
      `Google returned a non-JSON response (HTTP ${res.status}) for ${label}.`,
    );
  }
}

/**
 * Turns a failed token-endpoint response into ours.
 *
 * `invalid_grant` is the one that matters and the one that is mapped
 * specially. Google's OAuth docs list it for an expired or revoked refresh
 * token, a revoked grant, a user who changed their password, and an
 * authorization code that was already used — every one of which means "this
 * grant is dead", never "try again". Mapping it to `gsc_reconnect_required`
 * is what lets the UI show a reconnect CTA instead of a retry button, and what
 * marks the stored connection broken.
 */
function tokenError(label: string, status: number, body: unknown): ApiException {
  const parsed = oauthErrorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error : "";
  const description = parsed.success ? parsed.data.error_description : undefined;

  if (code === "invalid_grant") {
    return new ApiException(
      "gsc_reconnect_required",
      "Google no longer accepts this Search Console connection. Someone revoked OpenRefs' access, or the grant expired. Reconnect to restore it.",
      { label },
    );
  }

  /*
   * `invalid_client` means the operator's GOOGLE_CLIENT_ID / SECRET are wrong
   * or mismatched — a configuration fault, not a user one, and worth saying so
   * plainly rather than hiding behind "Google said no".
   */
  if (code === "invalid_client") {
    return new ApiException(
      "gsc_error",
      "Google rejected this deployment's OAuth client credentials. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      { label },
    );
  }

  return new ApiException(
    "gsc_error",
    `Google's token endpoint failed (HTTP ${status}${code === "" ? "" : `, ${code}`})${description === undefined ? "" : `: ${description}`}`,
    { label, status },
  );
}

/** Turns a failed Search Console API response into ours. */
function apiCallError(
  label: string,
  status: number,
  body: unknown,
): ApiException {
  const parsed = googleApiErrorSchema.safeParse(body);
  const message = parsed.success ? parsed.data.error.message : undefined;

  /*
   * 401 here means the *access* token is bad. Callers refresh proactively from
   * the cached expiry, so reaching this is either a clock skew or a grant that
   * died between the refresh and the call — both fixed by reconnecting if a
   * fresh refresh also fails, so the honest signal is "reconnect".
   */
  if (status === 401) {
    return new ApiException(
      "gsc_reconnect_required",
      "Google rejected this Search Console connection. Reconnect to restore it.",
      { label },
    );
  }

  /*
   * 403 is a permissions answer about the *property*, not the connection: the
   * connected Google account cannot read the property this project is bound
   * to. Reconnecting the same account would not help, so it must not be a
   * reconnect prompt.
   */
  if (status === 403) {
    return new ApiException(
      "gsc_error",
      message === undefined
        ? "The connected Google account does not have access to this Search Console property."
        : `Google refused the request: ${message}`,
      { label, status },
    );
  }

  return new ApiException(
    "gsc_error",
    `Google ${label} failed (HTTP ${status})${message === undefined ? "" : `: ${message}`}`,
    { label, status },
  );
}

/* -------------------------------------------------------------------------- */
/* OAuth                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Both token-endpoint flows are `application/x-www-form-urlencoded` POSTs —
 * https://developers.google.com/identity/protocols/oauth2/web-server#exchange-authorization-code
 * — never JSON. Sending JSON gets a bare `invalid_request`.
 *
 * Google's parameter table marks `client_secret` **Optional**, which is the
 * PKCE/public-client wording and does not apply to us: OpenRefs registers a
 * *confidential* Web application client, and omitting the secret gets
 * `invalid_client`. It is always sent.
 */
async function postToken(
  label: string,
  params: Record<string, string>,
): Promise<GoogleTokens> {
  const res = await call(label, GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });

  const body = await readJson(res, label);
  if (!res.ok) throw tokenError(label, res.status, body);

  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiException(
      "gsc_error",
      `Google's token endpoint returned an unrecognised response for ${label}.`,
    );
  }

  return {
    accessToken: parsed.data.access_token,
    // Google documents 3600; defaulting rather than failing keeps a response
    // that omits it usable, and the cache TTL is clamped below it anyway.
    expiresIn: parsed.data.expires_in ?? 3600,
    refreshToken: parsed.data.refresh_token ?? null,
    scope: parsed.data.scope ?? null,
  };
}

/** Authorization-code exchange. The one call that yields a refresh token. */
export function exchangeCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<GoogleTokens> {
  return postToken("code exchange", {
    code: options.code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
    // Must be byte-identical to the one sent to the auth endpoint. Google
    // compares them, and a mismatch is `redirect_uri_mismatch`.
    redirect_uri: options.redirectUri,
    grant_type: "authorization_code",
  });
}

/**
 * Refresh-token exchange. Note there is **no** `redirect_uri` — it is not a
 * parameter of this grant type, and sending it is an error.
 */
export function refreshAccessToken(options: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<GoogleTokens> {
  return postToken("token refresh", {
    client_id: options.clientId,
    client_secret: options.clientSecret,
    refresh_token: options.refreshToken,
    grant_type: "refresh_token",
  });
}

/**
 * Asks Google to revoke a grant. Best-effort by contract: returns whether it
 * worked and never throws.
 *
 * Never throwing is the whole point of its callers. Disconnecting and deleting
 * a workspace must both succeed even when Google is down, because the
 * alternative — refusing to delete the user's data because a third party is
 * unreachable — is far worse than a grant that lingers in the user's Google
 * account until they remove it themselves.
 *
 * https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
 * A refresh token may be passed as `token`; revoking it also invalidates every
 * access token derived from it. Google's own example puts the token in the
 * query string; their Node sample puts it in the form body. Both work, and the
 * body is used here so the token never appears in a URL.
 *
 * **Revocation is per Google account, not per connection.** Google: "Revocation
 * removes all OAuth 2.0 scopes previously granted to a project, invalidating
 * any issued access or refresh tokens for all clients registered under that
 * project." So a user who connected the same Google account to two OpenRefs
 * projects loses both when either one is disconnected — the second will report
 * `gsc_reconnect_required` on its next refresh, which is accurate, and
 * reconnecting fixes it. The workspace-deletion sweep sees the same effect:
 * the first revoke succeeds and the rest return 400 because the grant is
 * already gone, which is why `RevokeSummary` counts attempts separately from
 * successes rather than treating a `false` as a failure.
 */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await call("token revocation", GOOGLE_REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    /*
     * 200 is success. A 400 usually means the token was already invalid —
     * which is the outcome we wanted, but reporting it as `false` keeps the UI
     * honest: we cannot distinguish "already revoked" from "never valid".
     */
    return res.ok;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Search Console API                                                          */
/* -------------------------------------------------------------------------- */

async function apiCall(
  label: string,
  url: string,
  accessToken: string,
  body?: unknown,
): Promise<unknown> {
  const res = await call(label, url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const parsed = await readJson(res, label);
  if (!res.ok) throw apiCallError(label, res.status, parsed);
  return parsed;
}

/**
 * `GET /webmasters/v3/sites` — every property the grant can see.
 *
 * https://developers.google.com/webmaster-tools/v1/sites/list
 *
 * `permissionLevel` is one of `siteOwner`, `siteFullUser`,
 * `siteRestrictedUser` or `siteUnverifiedUser` — the lowercase forms the
 * reference page lists as the acceptable values. (Google's discovery document
 * declares the underlying proto enum names, `SITE_OWNER` and friends; those
 * are **not** what `webmasters/v3` puts on the wire. Do not match on them.)
 *
 * Unverified entries are deliberately **not** filtered out here: the picker
 * shows them and lets the API refuse, which produces a truthful "you do not
 * have access to this property" rather than a property that mysteriously does
 * not appear.
 */
export async function listSites(accessToken: string): Promise<GscSiteEntry[]> {
  const body = await apiCall("sites.list", `${GSC_API_BASE}sites`, accessToken);
  const parsed = sitesListSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiException(
      "gsc_error",
      "Google returned an unrecognised property list.",
    );
  }
  return (parsed.data.siteEntry ?? []).map((entry) => ({
    siteUrl: entry.siteUrl,
    permissionLevel: entry.permissionLevel ?? "",
  }));
}

export interface SearchAnalyticsRequest {
  /** `sc-domain:example.com` or `https://example.com/`. */
  siteUrl: string;
  /** `YYYY-MM-DD`, inclusive. */
  startDate: string;
  endDate: string;
  /** e.g. `["query"]`, `["query", "page"]`, `["date"]`. */
  dimensions: string[];
  rowLimit: number;
  startRow?: number;
}

/**
 * `POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query`
 *
 * https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 *
 * **The siteUrl must be percent-encoded into the path.** Both forms contain
 * characters that would otherwise be read as path structure —
 * `sc-domain:example.com` has a colon, `https://example.com/` has slashes —
 * and Google matches the decoded segment against the property exactly.
 * `encodeURIComponent` is what makes `https://example.com/` into
 * `https%3A%2F%2Fexample.com%2F`; `URL`'s own normalisation would not, which
 * is why the URL is assembled by string concatenation here.
 *
 * Three parameters are deliberately **not** sent:
 *
 *  - `type` — Google's default is `web`, which is what we want. (`searchType`
 *    is the old name for this and is documented as deprecated; never send it.)
 *  - `dataState` — the default is `final`, so only finalised rows come back.
 *    The `all` value would include fresh, still-moving numbers, which is
 *    exactly what `GSC_DATA_LAG_DAYS` exists to keep out of a 28-day
 *    comparison. A future phase wanting fresher data would set `all` here and
 *    honour `metadata.first_incomplete_date` in the response.
 *  - `aggregationType` — the default is `auto`; Google picks the aggregation
 *    that suits the requested dimensions, and it echoes its choice back in
 *    `responseAggregationType`.
 *
 * `rowLimit` is documented as "Valid range is 1–25,000; Default is 1,000", and
 * `startRow` as a zero-based offset. We ask for one page of `GSC_ROW_LIMIT`
 * rows and never paginate: the reports slice that set locally.
 */
export async function searchAnalyticsQuery(
  accessToken: string,
  request: SearchAnalyticsRequest,
): Promise<SearchAnalyticsRow[]> {
  const url = `${GSC_API_BASE}sites/${encodeURIComponent(request.siteUrl)}/searchAnalytics/query`;

  const body = await apiCall("searchanalytics.query", url, accessToken, {
    startDate: request.startDate,
    endDate: request.endDate,
    dimensions: request.dimensions,
    rowLimit: request.rowLimit,
    ...(request.startRow === undefined ? {} : { startRow: request.startRow }),
  });

  const parsed = searchAnalyticsSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiException(
      "gsc_error",
      "Google returned unrecognised Search Console performance data.",
    );
  }

  return (parsed.data.rows ?? []).map((row) => ({
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
}
