/**
 * The email seam's three contracts (Phase 8c):
 *
 *  1. Provider selection never throws — anything unrecognised is `console`.
 *  2. The log line never contains the message body. Invite and reset links
 *     live in that body, and a log is the one place a single-use link must
 *     never be readable (CLAUDE.md hard rule 1).
 *  3. `sendEmail` always resolves. Callers treat email as best-effort, so a
 *     rejected promise here would break invite creation and password reset
 *     rather than degrade them.
 *
 * The SendGrid payload assertions are transcribed from the current Mail Send
 * reference (https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
 * — they exist so a future edit cannot quietly reshape a body their API would
 * reject, which is the kind of failure nobody sees until real mail stops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emailProvider,
  isEmailConfigured,
  sendEmail,
  sendGridPayload,
  SENDGRID_ENDPOINT,
  type EmailMessage,
} from "./email";

/** A body with a live-looking link in it — the thing that must not be logged. */
const SECRET_LINK = "https://openrefs.example/reset/9tPq-TOKEN-VALUE-xyz";
const MESSAGE: EmailMessage = {
  to: "ada@example.com",
  subject: "Reset your OpenRefs password",
  text: `Open this link to choose a new one:\n${SECRET_LINK}`,
};

const API_KEY = "SG.a-key-that-must-never-be-logged";

function env(overrides: Partial<Env> = {}): Env {
  return overrides as Env;
}

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  vi.unstubAllGlobals();
});

/** Everything console.log saw, joined — for "this string appears nowhere". */
function loggedText(): string {
  return logSpy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .join("\n");
}

describe("emailProvider", () => {
  it("defaults to console when nothing is configured", () => {
    expect(emailProvider(env())).toBe("console");
    expect(emailProvider(env({ EMAIL_PROVIDER: "" }))).toBe("console");
  });

  it("selects sendgrid, case- and whitespace-insensitively", () => {
    expect(emailProvider(env({ EMAIL_PROVIDER: "sendgrid" }))).toBe("sendgrid");
    expect(emailProvider(env({ EMAIL_PROVIDER: " SendGrid " }))).toBe("sendgrid");
  });

  it("reads an unknown provider as console rather than failing", () => {
    // A typo in a var must degrade to "logs instead of sends", never to a
    // deployment that throws on every invite.
    expect(emailProvider(env({ EMAIL_PROVIDER: "mailgun" }))).toBe("console");
  });

  it("counts only a non-console provider as configured", () => {
    expect(isEmailConfigured(env())).toBe(false);
    expect(isEmailConfigured(env({ EMAIL_PROVIDER: "console" }))).toBe(false);
    expect(isEmailConfigured(env({ EMAIL_PROVIDER: "sendgrid" }))).toBe(true);
  });
});

describe("console provider", () => {
  it('"sends" and reports success', async () => {
    await expect(sendEmail(env(), MESSAGE)).resolves.toEqual({ sent: true });
  });

  it("logs the recipient and subject", async () => {
    await sendEmail(env(), MESSAGE);

    const line = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as
      Record<string, unknown>;
    expect(line).toMatchObject({
      event: "email",
      provider: "console",
      to: "ada@example.com",
      subject: "Reset your OpenRefs password",
      sent: true,
    });
  });

  it("NEVER logs the body, the link, or the token inside it", async () => {
    await sendEmail(env(), MESSAGE);

    const logged = loggedText();
    expect(logged).not.toContain(SECRET_LINK);
    expect(logged).not.toContain("TOKEN-VALUE");
    expect(logged).not.toContain("/reset/");
    expect(logged).not.toContain(MESSAGE.text);
  });

  it("keeps an html alternative out of the log too", async () => {
    await sendEmail(env(), {
      ...MESSAGE,
      html: `<a href="${SECRET_LINK}">Reset</a>`,
    });
    expect(loggedText()).not.toContain(SECRET_LINK);
  });

  it("makes no network call at all", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await sendEmail(env(), MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendGridPayload", () => {
  const payload = sendGridPayload("no-reply@openrefs.example", MESSAGE) as {
    personalizations: { to: { email: string }[] }[];
    from: { email: string };
    subject: string;
    content: { type: string; value: string }[];
  };

  it("puts the recipient in personalizations[].to[].email", () => {
    // Required by the API: personalizations is an array of envelopes, each
    // with a `to` array whose entries require `email`.
    expect(payload.personalizations).toEqual([
      { to: [{ email: "ada@example.com" }] },
    ]);
  });

  it("sends from and subject at message level", () => {
    expect(payload.from).toEqual({ email: "no-reply@openrefs.example" });
    expect(payload.subject).toBe("Reset your OpenRefs password");
  });

  it("emits text/plain first, and only that when there is no html", () => {
    // Plain-first satisfies both the ordering older API revisions enforced and
    // RFC 2046 §5.1.4's increasing-faithfulness rule, so it stays correct
    // whichever regime SendGrid is running today.
    expect(payload.content).toEqual([
      { type: "text/plain", value: MESSAGE.text },
    ]);
  });

  it("appends text/html after the plain part when one is given", () => {
    const withHtml = sendGridPayload("no-reply@openrefs.example", {
      ...MESSAGE,
      html: "<p>hi</p>",
    }) as { content: { type: string }[] };

    expect(withHtml.content.map((part) => part.type)).toEqual([
      "text/plain",
      "text/html",
    ]);
  });
});

describe("sendgrid provider", () => {
  const configured = env({
    EMAIL_PROVIDER: "sendgrid",
    EMAIL_FROM: "no-reply@openrefs.example",
    SENDGRID_API_KEY: API_KEY,
  });

  it("POSTs the documented endpoint with a bearer key and JSON body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendEmail(configured, MESSAGE)).resolves.toEqual({
      sent: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(SENDGRID_ENDPOINT);
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers["content-type"]).toBe("application/json");

    // Abandoned rather than left to hang: a stuck mail API must not hold a
    // Worker invocation open for its whole budget.
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(JSON.parse(String(init.body))).toEqual(
      sendGridPayload("no-reply@openrefs.example", MESSAGE),
    );
  });

  it("treats 202 Accepted as sent — their documented success status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 202 })),
    );
    await expect(sendEmail(configured, MESSAGE)).resolves.toEqual({
      sent: true,
    });
  });

  it("reports a refusal with its status and their first error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              errors: [
                {
                  message:
                    "The from address does not match a verified Sender Identity.",
                },
              ],
            }),
            { status: 403, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const result = await sendEmail(configured, MESSAGE);
    expect(result.sent).toBe(false);
    // The status alone has sent many operators looking in the wrong place.
    expect(result.reason).toBe(
      "http_403: The from address does not match a verified Sender Identity.",
    );
  });

  it("still reports the status when the error body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>gateway</html>", { status: 502 })),
    );
    await expect(sendEmail(configured, MESSAGE)).resolves.toEqual({
      sent: false,
      reason: "http_502",
    });
  });

  it("resolves rather than throwing when the request times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // What AbortSignal.timeout produces when it fires.
        throw Object.assign(new Error("The operation timed out."), {
          name: "TimeoutError",
        });
      }),
    );
    await expect(sendEmail(configured, MESSAGE)).resolves.toEqual({
      sent: false,
      reason: "timeout",
    });
  });

  it("resolves rather than throwing on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network connection lost.");
      }),
    );
    await expect(sendEmail(configured, MESSAGE)).resolves.toEqual({
      sent: false,
      reason: "network_error",
    });
  });

  it("refuses without an API key, and never calls out", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmail(
      env({ EMAIL_PROVIDER: "sendgrid", EMAIL_FROM: "a@b.example" }),
      MESSAGE,
    );
    expect(result).toEqual({ sent: false, reason: "missing_api_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without a From address — SendGrid would 403 anyway", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmail(
      env({ EMAIL_PROVIDER: "sendgrid", SENDGRID_API_KEY: API_KEY }),
      MESSAGE,
    );
    expect(result).toEqual({ sent: false, reason: "missing_email_from" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the API key and the body out of the log on every path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    await sendEmail(configured, MESSAGE);

    const logged = loggedText();
    expect(logged).toContain("ada@example.com");
    expect(logged).not.toContain(API_KEY);
    expect(logged).not.toContain(SECRET_LINK);
  });
});
