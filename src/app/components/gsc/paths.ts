/**
 * The two API paths this module names as *text* rather than calls.
 *
 * `/connect` is a full-page navigation and `/callback` is a string the operator
 * types into Google Cloud, so neither goes through `lib/api.ts` and neither is
 * covered by its `/api/v1` prefixing. Keeping them here means the setup card
 * and the connect button cannot drift apart, and that the redirect URI shown to
 * an operator is the one the worker actually serves.
 */

/** Where Google sends the browser back to. Must match the worker's route. */
export const GSC_CALLBACK_PATH = "/api/v1/gsc/callback";

/** Where the browser goes to start a connection. */
export const GSC_CONNECT_PATH = "/api/v1/gsc/connect";

/** The module's own route, which the callback redirects back to. */
export const GSC_APP_PATH = "/app/search-console";
