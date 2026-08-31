/**
 * The one seam through which OpenRefs sends mail (Phase 8c).
 *
 * Two providers, chosen by the `EMAIL_PROVIDER` var:
 *
 *  - `console` (the default, and what every self-host starts on): writes a
 *    structured log line and returns success. Nothing reaches an inbox.
 *  - `sendgrid`: POSTs SendGrid's v3 Mail Send API, needing the
 *    `SENDGRID_API_KEY` secret and the `EMAIL_FROM` var.
 *
 * Three rules hold for every caller:
 *
 * 1. **Email is best-effort, everywhere.** `sendEmail` never throws and never
 *    rejects; a failure comes back as `{ sent: false, reason }`. No feature may
 *    fail because mail did not go out — an invite still exists to be copied,
 *    and a reset request is still answered 202. Callers that ignore the result
 *    entirely are behaving correctly.
 * 2. **Never log the body.** The log line carries the recipient and the subject
 *    and stops there. Message bodies contain invite links and password-reset
 *    links, and a link in a log file is a credential in a log file — readable
 *    by anyone with dashboard access, and outliving the token itself. This is
 *    the same reasoning that keeps session tokens out of `middleware/logger.ts`
 *    (CLAUDE.md hard rule 1).
 * 3. **`sent` is not "delivered".** It means the provider accepted the message.
 *    Whether a human ever sees it is between SendGrid and their mail server.
 */

import type { Context } from "hono";

import type { AppEnv } from "../types";

/** Providers this deployment knows how to be. */
export const EMAIL_PROVIDERS = ["console", "sendgrid"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export interface EmailMessage {
  /** A single recipient. Nothing here needs a fan-out, so there is no array. */
  to: string;
  subject: string;
  /** Required. Plain text is the body every mail client can render. */
  text: string;
  /** Optional richer alternative; clients that can render it will prefer it. */
  html?: string;
}

export interface EmailResult {
  /** True when a provider accepted the message. */
  sent: boolean;
  /**
   * Why it did not go, for logs and for tests. Short machine-ish tokens rather
   * than prose, and never anything secret — the API key is not echoed, and
   * neither is the body.
   */
  reason?: string;
}

/** SendGrid's own timeout. Long enough for a slow POST, short enough that a
 * hung API cannot pin a Worker invocation for its whole CPU budget. */
export const SENDGRID_TIMEOUT_MS = 15_000;

/** Documented in docs/specs/PHASE8.md §8c; EU tenants would use api.eu. */
export const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

/**
 * Which provider this deployment is running. Anything unrecognised — including
 * the empty string, a typo, or an unset var — reads as `console`, because the
 * safe failure for a misconfigured mailer is "logs instead of sends", never
 * "throws on every invite".
 */
export function emailProvider(env: Env): EmailProvider {
  const configured = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  return (EMAIL_PROVIDERS as readonly string[]).includes(configured)
    ? (configured as EmailProvider)
    : "console";
}

/**
 * True when this deployment can put mail in front of a human.
 *
 * The console provider still "sends" — it logs, and returns `sent: true` — but
 * no inbox is involved. Anything that *tells a user* their message was emailed
 * has to gate on this rather than on `sent`, or a stock self-host would claim
 * to have emailed an invite that only ever existed in `wrangler tail`.
 */
export function isEmailConfigured(env: Env): boolean {
  return emailProvider(env) !== "console";
}

/** The structured line both providers emit. Recipient and subject only. */
function logEmail(
  provider: EmailProvider,
  message: EmailMessage,
  result: EmailResult,
): void {
  console.log(
    JSON.stringify({
      event: "email",
      provider,
      to: message.to,
      subject: message.subject,
      sent: result.sent,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    }),
  );
}

/**
 * SendGrid's v3 Mail Send payload.
 *
 * Verified against the current API reference
 * (https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send):
 * `personalizations` is required and is "an array of messages and their
 * metadata", each carrying a required `to` array whose entries require
 * `email`; `from` (with a required `email`) and `subject` are message-level
 * and required; `content` is "an array of objects, each containing a message
 * body's content and MIME type", each entry requiring `type` and `value`. A
 * successful call answers **202 Accepted** with an empty body.
 *
 * `text/plain` is emitted first. The current reference no longer states an
 * ordering constraint, but older revisions of this API required the plain part
 * to precede the HTML one and rejected the reverse — and RFC 2046 §5.1.4 wants
 * multipart/alternative parts in increasing order of faithfulness regardless.
 * Emitting plain-first is correct under every one of those regimes, so there is
 * no reason to depend on the constraint having been relaxed.
 */
export function sendGridPayload(from: string, message: EmailMessage): unknown {
  return {
    personalizations: [{ to: [{ email: message.to }] }],
    from: { email: from },
    subject: message.subject,
    content: [
      { type: "text/plain", value: message.text },
      ...(message.html === undefined
        ? []
        : [{ type: "text/html", value: message.html }]),
    ],
  };
}

async function sendViaSendGrid(
  env: Env,
  message: EmailMessage,
): Promise<EmailResult> {
  const apiKey = (env.SENDGRID_API_KEY ?? "").trim();
  const from = (env.EMAIL_FROM ?? "").trim();

  // A half-configured mailer is an operator mistake, not a caller's problem:
  // report it and let the feature carry on without mail.
  if (apiKey === "") return { sent: false, reason: "missing_api_key" };
  if (from === "") return { sent: false, reason: "missing_email_from" };

  let response: Response;
  try {
    response = await fetch(SENDGRID_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(sendGridPayload(from, message)),
      signal: AbortSignal.timeout(SENDGRID_TIMEOUT_MS),
    });
  } catch (error) {
    // Timeout (AbortSignal fires a DOMException) or a network failure. The
    // message is ours to report, but never the request we sent.
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "network_error";
    return { sent: false, reason };
  }

  if (response.ok) return { sent: true };

  /*
   * SendGrid answers a rejected send with a JSON `errors` array. The status is
   * what matters operationally (401 = bad key, 403 = unverified sender, 413 =
   * too large), so it always appears; the first error message is appended when
   * one parses, because "403" alone has sent many people looking in the wrong
   * place. The body is SendGrid's prose about our request, not our credential.
   */
  const detail = await response
    .json()
    .then((body: unknown) => {
      const errors = (body as { errors?: { message?: unknown }[] } | null)
        ?.errors;
      const first = errors?.[0]?.message;
      return typeof first === "string" ? `: ${first}` : "";
    })
    .catch(() => "");

  return { sent: false, reason: `http_${response.status}${detail}` };
}

/**
 * Send one message. Resolves either way — see rule 1 in the file header.
 */
export async function sendEmail(
  env: Env,
  message: EmailMessage,
): Promise<EmailResult> {
  const provider = emailProvider(env);

  const result: EmailResult =
    provider === "sendgrid"
      ? await sendViaSendGrid(env, message)
      : // The console provider's whole job is this log line. It is deliberately
        // not a no-op: a self-hoster tailing their Worker can see that an
        // invite went out and to whom, which is the difference between "email
        // is off" and "email is silently broken".
        { sent: true };

  logEmail(provider, message, result);
  return result;
}

/**
 * Send after the response has gone out, ignoring the result.
 *
 * For `POST /auth/forgot`, which must not disclose whether an address is
 * registered. Awaiting the send inside the handler would answer that question
 * with a stopwatch: a known address would pay for a round trip to SendGrid
 * (hundreds of milliseconds, up to `SENDGRID_TIMEOUT_MS`) while an unknown one
 * returned immediately. Deferring the work makes both paths cost the same.
 *
 * Falls back to a detached promise when there is no `ExecutionContext`, which
 * is the case under `app.request()` in unit tests — mirroring `afterResponse`
 * in middleware/auth.ts.
 */
export function sendEmailInBackground(
  c: Context<AppEnv>,
  message: EmailMessage,
): void {
  const promise = sendEmail(c.env, message).catch(() => {
    // `sendEmail` already swallows provider failures; this catches only a bug
    // in the seam itself, which must still not break the request.
  });
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}
