/**
 * Reading the OAuth callback's landing parameters.
 *
 * The callback is a browser navigation, not an XHR, so the worker cannot answer
 * with a JSON error body — it redirects here and hands the reason over in the
 * query string (`src/worker/routes/gsc.ts`). This module turns that string into
 * one of four outcomes and nothing else; it performs no side effects, which is
 * what makes the whole flow testable without a browser.
 *
 * **Cancelling is not a failure.** `access_denied` means the user looked at
 * Google's consent screen and decided not to. They know exactly what happened
 * and they meant it, so the page must not greet them with a red banner
 * explaining their own decision back to them. It resolves to `cancelled`, which
 * the page dismisses quietly — the Connect button is still right there if they
 * change their mind. Every other code is something they did *not* choose, and
 * those get a notice that says what to do next.
 *
 * **The parameters are cleaned afterwards.** Left in place, a reload would
 * re-announce a success that already happened, and — worse — a shared or
 * bookmarked URL would keep reporting a stale failure long after the connection
 * was fixed. `project` is deliberately *not* cleaned: it is the module's own
 * selection parameter, and dropping it would bounce the user to the picker
 * immediately after they connected the project they were looking at.
 */
import type { GscCallbackError } from "../../../shared/gsc";

/** `?connected=1` — the flow finished and a refresh token is stored. */
export const GSC_CONNECTED_PARAM = "connected";
/** `?error=<code>` — the flow ended some other way. */
export const GSC_ERROR_PARAM = "error";

/** The parameters this module consumes and then removes from the URL. */
export const GSC_CALLBACK_PARAMS = [
  GSC_CONNECTED_PARAM,
  GSC_ERROR_PARAM,
] as const;

/** What the landing page should do about the query string it arrived with. */
export type GscCallbackOutcome =
  /** Nothing to announce — an ordinary visit. */
  | { kind: "none" }
  /** Connected. Toast, then refetch status so the picker or reports appear. */
  | { kind: "connected"; projectId: string | null }
  /** The user pressed Cancel. Say nothing; just clean the URL. */
  | { kind: "cancelled"; projectId: string | null }
  /** Something went wrong that the user did not choose. Explain it. */
  | {
      kind: "failed";
      code: string;
      projectId: string | null;
      title: string;
      body: string;
    };

interface Notice {
  title: string;
  body: string;
}

/**
 * Copy per code.
 *
 * Every entry names the next action, because a message that only reports a
 * failure leaves the user on a page whose one button they have already pressed
 * once. The keys cover `GSC_CALLBACK_ERRORS` plus the `ApiErrorCode`s the
 * callback passes through once the state has checked out.
 */
const NOTICES: Record<string, Notice> = {
  invalid_state: {
    title: "That connection link wasn't valid",
    body: "The token binding this connection to your account was missing or altered on the way back from Google. Nothing was changed. Start the connection again from this page.",
  },
  expired_state: {
    title: "That connection attempt timed out",
    body: "A connection link is good for ten minutes. Press Connect again and complete Google's consent screen without leaving it open.",
  },
  state_mismatch: {
    title: "Someone else finished that connection",
    body: "The Google consent screen was completed by a different OpenRefs account than the one that started it, so nothing was stored. Start again from this browser.",
  },
  no_refresh_token: {
    title: "Google didn't grant offline access",
    body: "Google signed you in but issued no refresh token, so OpenRefs cannot read your data on its own. Remove OpenRefs from your Google account's third-party access list, then connect again.",
  },
  gsc_error: {
    title: "Google refused the connection",
    body: "Google returned an error while completing the connection. Nothing was stored. Try again, and if it keeps happening check that this deployment's OAuth client is still enabled in Google Cloud.",
  },
  gsc_reconnect_required: {
    title: "That connection needs setting up again",
    body: "Google would not accept the stored grant. Connect the project again to issue a fresh one.",
  },
  forbidden: {
    title: "You don't have permission to connect this project",
    body: "Connecting Search Console is an admin action. Ask a workspace owner or admin to connect it, and the reports will appear here for everyone.",
  },
  not_found: {
    title: "That project no longer exists",
    body: "The project this connection was for has been deleted, so there was nothing to connect. Pick another project to continue.",
  },
};

const FALLBACK: Notice = {
  title: "That connection didn't complete",
  body: "Google sent you back without finishing the connection, and nothing was stored. Try connecting again.",
};

/** The one code that means "the user said no", rather than "something broke". */
const CANCELLED: GscCallbackError = "access_denied";

function trimmed(value: string | null): string | null {
  if (value === null) return null;
  const out = value.trim();
  return out === "" ? null : out;
}

/**
 * Classify the query string this page was loaded with.
 *
 * `error` is checked before `connected`: if both somehow arrive, the failure is
 * the honest report, and announcing a success that a following error contradicts
 * would be the worse of the two mistakes.
 */
export function readGscCallback(
  search: string | URLSearchParams,
): GscCallbackOutcome {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;

  const projectId = trimmed(params.get("project"));
  const error = trimmed(params.get(GSC_ERROR_PARAM));

  if (error !== null) {
    if (error === CANCELLED) return { kind: "cancelled", projectId };
    const notice = NOTICES[error] ?? FALLBACK;
    return { kind: "failed", code: error, projectId, ...notice };
  }

  const connected = trimmed(params.get(GSC_CONNECTED_PARAM));
  // Any truthy value counts. The worker sends "1"; being strict about that
  // would turn a harmless change at the other end into a silent no-op here.
  if (connected !== null && connected !== "0" && connected !== "false") {
    return { kind: "connected", projectId };
  }

  return { kind: "none" };
}

/** True when the URL carries anything this module needs to consume. */
export function hasGscCallbackParams(
  search: string | URLSearchParams,
): boolean {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  return GSC_CALLBACK_PARAMS.some((key) => params.has(key));
}

/**
 * The same query string with the callback parameters removed.
 *
 * Built from the existing params rather than from scratch so `project` — and
 * anything a later sub-screen puts in the URL — survives the clean-up.
 */
export function clearedGscCallbackParams(
  current: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of GSC_CALLBACK_PARAMS) next.delete(key);
  return next;
}
