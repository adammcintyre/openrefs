/**
 * Whether this deployment has a Google OAuth client, and what it is.
 *
 * Search Console is the one module OpenRefs cannot ship pre-configured: every
 * operator has to create their own OAuth client, because Google issues clients
 * to *projects*, not to software. So "unconfigured" is a first-class, expected
 * state rather than a broken one — `GET /gsc/status` reports it calmly and the
 * UI renders setup instructions, while every route that would actually need to
 * talk to Google refuses with `gsc_not_configured` (409).
 */
import { ApiException } from "../http";

/**
 * The only scope OpenRefs ever requests.
 *
 * Read-only by deliberate choice: nothing in this product needs to submit a
 * sitemap or request indexing, and asking for write access would (a) put a
 * scarier consent screen in front of every user and (b) make a compromised
 * refresh token able to change a customer's Search Console rather than merely
 * read it. Verified against Google's Search Console API scope list
 * (https://developers.google.com/webmaster-tools/v1/how-tos/authorizing).
 */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** Where the SPA's Search Console module lives; the callback lands back here. */
export const GSC_APP_PATH = "/app/search-console";

/** The redirect URI's path. Registered with Google verbatim by the operator. */
export const GSC_CALLBACK_PATH = "/api/v1/gsc/callback";

export interface GscConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * The configured client, or null.
 *
 * Both halves are required. A deployment with an id but no secret cannot
 * complete a code exchange, so reporting it "configured" would trade a clear
 * setup card for a mystifying failure three clicks later.
 *
 * Vars arrive as `""` when declared-but-empty (wrangler.jsonc's default) and
 * secrets are simply absent when unset, so both emptiness and `undefined` have
 * to count as "not configured".
 */
export function gscConfig(env: Env): GscConfig | null {
  const clientId = trimmed(env.GOOGLE_CLIENT_ID);
  const clientSecret = trimmed(env.GOOGLE_CLIENT_SECRET);
  if (clientId === null || clientSecret === null) return null;
  return { clientId, clientSecret };
}

/** True when the OAuth flow can run at all. Drives `status.configured`. */
export function isGscConfigured(env: Env): boolean {
  return gscConfig(env) !== null;
}

/**
 * The config, or a 409 that tells the operator exactly what to set.
 *
 * Every `/gsc/*` route except `status` calls this first — before validating
 * query params, before touching D1 — so an unconfigured deployment gives one
 * consistent answer rather than a different error per endpoint.
 */
export function requireGscConfig(env: Env): GscConfig {
  const config = gscConfig(env);
  if (config === null) {
    throw new ApiException(
      "gsc_not_configured",
      "Search Console is not configured on this deployment. An operator needs to create a Google OAuth client and set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  return config;
}

/**
 * The `redirect_uri` for this deployment, derived from the request's own
 * origin.
 *
 * Derived rather than configured so a self-hoster has one fewer variable to
 * get wrong: whatever host they reached the Worker on is the host Google must
 * redirect back to. Both the auth request and the code exchange call this, so
 * the two strings are identical by construction — Google compares them exactly
 * and a mismatch is the single most common setup failure.
 *
 * A spoofed `Host` header cannot turn this into an exfiltration channel: the
 * value only ever appears in an auth URL, and Google rejects any `redirect_uri`
 * that is not on the operator's registered list. Nothing secret is sent to it.
 */
export function callbackRedirectUri(requestUrl: string): string {
  return new URL(GSC_CALLBACK_PATH, new URL(requestUrl).origin).toString();
}

/** Absolute URL of the SPA page the callback returns the browser to. */
export function appRedirect(
  requestUrl: string,
  params: Record<string, string>,
): string {
  const url = new URL(GSC_APP_PATH, new URL(requestUrl).origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function trimmed(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out === "" ? null : out;
}
