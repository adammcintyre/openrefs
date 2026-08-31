/**
 * The MCP endpoint's request handler: authenticate, frame, dispatch, answer.
 *
 * See `./protocol.ts` for the revision this implements (2026-07-28, with the
 * `initialize`-era revisions still answered) and why. This file is the part
 * that touches Hono, D1 and the tool catalogue; everything version-shaped is
 * next door and unit-testable on its own.
 *
 * ## Auth is bearer-only, and that is a security decision
 *
 * `loadSession` accepts either an `orf_session` cookie or an `orf_` API key,
 * and this endpoint deliberately accepts only the second. A cookie is sent by
 * the browser automatically, so if a cookie session were honoured here, any
 * page on the internet could POST a `tools/call` at this endpoint and spend a
 * signed-in user's DataForSEO credits — a plain CSRF, with a bill attached.
 * An `Authorization` header is never attached automatically, so requiring one
 * closes that without needing a token dance. It also matches how agents
 * actually connect: a bearer key in the client's config file.
 */
import type { Context } from "hono";

import { getDb } from "../../db";
import { ApiException } from "../http";
import { APP_VERSION } from "../../shared/version";
import type { AppEnv } from "../types";
import { MCP_TOOLS, type ToolContext, findTool } from "./tools";
import type { McpEra, RpcFailure, RpcId, RpcResponse } from "./protocol";
import {
  MCP_LEGACY_VERSIONS,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
  META_SERVER_INFO,
  RPC,
  detectEra,
  isSupportedVersion,
  parseMcpMessage,
  readBodyProtocolVersion,
  rpcError,
  rpcResult,
  unsupportedVersionError,
  validateModernHeaders,
} from "./protocol";

/** How this server names itself. */
const SERVER_INFO = {
  name: "openrefs",
  title: "OpenRefs",
  version: APP_VERSION,
} as const;

/**
 * What we can do. No resources, no prompts, no subscriptions — this server is
 * a set of read-and-save tools over one workspace's SEO data.
 *
 * `listChanged: false` is honest rather than modest: the catalogue is a
 * compile-time array, it cannot change while a client is connected, and there
 * is no stream on which we could announce it if it did.
 */
const CAPABILITIES = { tools: { listChanged: false } } as const;

const INSTRUCTIONS = [
  "OpenRefs exposes SEO research over one workspace's own DataForSEO account.",
  "Every tool call runs against the workspace the API key was minted for; there is no workspace argument.",
  "Most tools spend real money from that workspace's balance and are refused with `spend_cap_exceeded` once its monthly cap is reached.",
  "Answers are cached per workspace, so repeating a query is normally free — pass `fresh: true` only when the caller explicitly wants current data.",
  "`null` in a metric means the provider did not report it. It never means zero.",
].join(" ");

/** The legacy revision we prefer when a client asks for one we do not know. */
const PREFERRED_LEGACY_VERSION = MCP_LEGACY_VERSIONS[0] as string;

/** Modern results carry `resultType`; legacy ones must not. */
function shape(era: McpEra, result: Record<string, unknown>): Record<string, unknown> {
  return era === "modern" ? { resultType: "complete", ...result } : result;
}

/** A JSON-RPC body plus the HTTP status it should travel with. */
interface Answer {
  status: 200 | 202 | 400 | 401 | 403 | 404;
  body: RpcResponse | null;
}

function fail(
  status: Answer["status"],
  id: RpcId,
  code: number,
  message: string,
  data?: unknown,
): Answer {
  return { status, body: rpcError(id, code, message, data) as RpcFailure };
}

/**
 * Same-origin check, per the transport's DNS-rebinding rule.
 *
 * Only enforced when an `Origin` header is actually present: every non-browser
 * client (curl, an agent runtime, a desktop MCP host) sends none, and rejecting
 * those would break the endpoint's main audience. A browser that does send one
 * must be pointing at us.
 */
function originAllowed(c: Context<AppEnv>): boolean {
  const origin = c.req.header("origin");
  if (origin === undefined || origin === "") return true;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

/**
 * Runs one tool and renders the result as MCP content.
 *
 * Two failure modes, deliberately different:
 *
 *  - An `ApiException` — a spend cap, missing credentials, a 404, an upstream
 *    timeout — becomes a *tool execution error*: `isError: true` with our own
 *    error envelope as the text. The spec asks for exactly this, because these
 *    are things a model can act on ("the cap is reached, tell the user" or
 *    "that collection id was wrong, list them again"). Turning them into
 *    JSON-RPC errors would strip them out of the model's reach.
 *  - Anything else is a bug in our code. It becomes a protocol error, and the
 *    message is logged rather than returned — an unexpected exception can
 *    carry SQL or upstream credentials.
 */
async function callTool(
  c: Context<AppEnv>,
  ctx: ToolContext,
  era: McpEra,
  id: RpcId,
  params: Record<string, unknown> | undefined,
): Promise<Answer> {
  const name = typeof params?.name === "string" ? params.name : "";
  const tool = findTool(name);
  if (tool === undefined) {
    // "Unknown tool" is a protocol error in the spec's own list: the model
    // cannot fix it by retrying with better arguments.
    return fail(era === "modern" ? 404 : 200, id, RPC.invalidParams, `Unknown tool: ${name}`);
  }

  const args = params?.arguments;

  try {
    const result = await tool.run(ctx, args);
    return {
      status: 200,
      body: rpcResult(
        id,
        shape(era, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: false,
        }),
      ),
    };
  } catch (err) {
    if (err instanceof ApiException) {
      return {
        status: 200,
        body: rpcResult(
          id,
          shape(era, {
            content: [
              {
                type: "text",
                // The same envelope the REST API returns, so an agent that has
                // seen one of our HTTP errors recognises this one.
                text: JSON.stringify({
                  error: { code: err.code, message: err.message },
                }),
              },
            ],
            isError: true,
          }),
        ),
      };
    }

    // A zod failure on the tool's own arguments. The spec files input
    // validation under tool execution errors precisely so the model can read
    // the complaint and retry with corrected arguments.
    if (err instanceof Error && err.name === "ZodError") {
      return {
        status: 200,
        body: rpcResult(
          id,
          shape(era, {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: {
                    code: "validation_failed",
                    message: `Invalid arguments for ${name}.`,
                    details: JSON.parse(err.message) as unknown,
                  },
                }),
              },
            ],
            isError: true,
          }),
        ),
      };
    }

    console.error(
      JSON.stringify({
        requestId: c.get("requestId"),
        level: "error",
        event: "mcp.tool.failed",
        tool: name,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return fail(200, id, RPC.internalError, "Internal error.");
  }
}

/**
 * Handles one POST to the MCP endpoint.
 *
 * Returns a `Response` directly rather than throwing into `app.onError`,
 * because every failure here has to be a JSON-RPC frame — the app-wide error
 * handler would render our REST envelope, which an MCP client cannot read.
 */
export async function handleMcpPost(c: Context<AppEnv>): Promise<Response> {
  if (!originAllowed(c)) {
    return c.json(
      rpcError(null, RPC.invalidRequest, "Cross-origin requests are not accepted."),
      403,
    );
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(rpcError(null, RPC.parseError, "Invalid JSON."), 400);
  }

  const parsed = parseMcpMessage(raw);
  if (parsed.kind === "invalid") {
    return c.json(rpcError(parsed.id, parsed.code, parsed.message), 400);
  }

  // Narrowed off `parsed` rather than off `message`: a notification has no id
  // member at all, and only the discriminant proves which one we are holding.
  const id: RpcId = parsed.kind === "request" ? parsed.message.id : null;
  const message = parsed.message;
  const headerVersion = c.req.header("mcp-protocol-version");
  const era = detectEra(message.method, message.params, headerVersion);

  if (era === "modern") {
    const problem = validateModernHeaders(
      {
        protocolVersion: headerVersion,
        method: c.req.header("mcp-method"),
        name: c.req.header("mcp-name"),
      },
      message,
    );
    if (problem !== null) {
      return c.json(rpcError(id, RPC.headerMismatch, problem), 400);
    }
  }

  // Version check. Legacy `initialize` negotiates instead of rejecting — that
  // is the whole point of the handshake — so it is exempt.
  const declared = readBodyProtocolVersion(message.params) ?? headerVersion;
  if (
    message.method !== "initialize" &&
    declared !== undefined &&
    !isSupportedVersion(declared)
  ) {
    return c.json(unsupportedVersionError(id, declared), 400);
  }

  /*
   * Authentication, before dispatch and before any work.
   *
   * `loadSession` has already resolved the credential app-wide; all this does
   * is insist it was an API key. `WWW-Authenticate` tells a well-behaved client
   * what kind of credential to go and find.
   */
  const session = c.get("session");
  if (session === null || session.kind !== "api_key") {
    return c.json(
      rpcError(
        id,
        RPC.unauthorized,
        "This endpoint requires an OpenRefs workspace API key: Authorization: Bearer orf_... Mint one in Settings -> API Keys.",
      ),
      401,
      { "www-authenticate": 'Bearer realm="openrefs"' },
    );
  }

  const ctx: ToolContext = {
    env: c.env,
    db: getDb(c.env.DB),
    workspaceId: session.workspaceId,
  };

  const answer = await dispatch(c, ctx, era, parsed.kind, id, message.method, message.params);

  if (answer.body === null) {
    // A notification the server accepted. 202 with no body, per the transport.
    return c.body(null, 202);
  }
  return c.json(answer.body, answer.status);
}

async function dispatch(
  c: Context<AppEnv>,
  ctx: ToolContext,
  era: McpEra,
  kind: "request" | "notification",
  id: RpcId,
  method: string,
  params: Record<string, unknown> | undefined,
): Promise<Answer> {
  // Notifications get 202 and nothing else, whatever they were. The only one
  // the legacy handshake sends is `notifications/initialized`, and a stateless
  // server has nothing to record when it arrives.
  if (kind === "notification") {
    return { status: 202, body: null };
  }

  switch (method) {
    case "initialize":
      return { status: 200, body: rpcResult(id, initializeResult(params)) };

    case "server/discover":
      return {
        status: 200,
        body: rpcResult(
          id,
          shape(era, {
            supportedVersions: [...MCP_SUPPORTED_VERSIONS],
            capabilities: CAPABILITIES,
            instructions: INSTRUCTIONS,
            _meta: { [META_SERVER_INFO]: SERVER_INFO },
            ttlMs: 3_600_000,
            // The catalogue is identical for every caller, but reaching it
            // needs a key, so a shared cache must not hold this response.
            cacheScope: "private",
          }),
        ),
      };

    case "ping":
      // The spec's ping returns an empty result. Nothing to report.
      return { status: 200, body: rpcResult(id, shape(era, {})) };

    case "tools/list":
      return {
        status: 200,
        body: rpcResult(
          id,
          shape(era, {
            tools: MCP_TOOLS.map((entry) => ({
              name: entry.name,
              title: entry.title,
              description: entry.description,
              inputSchema: entry.inputSchema,
            })),
          }),
        ),
      };

    case "tools/call":
      return callTool(c, ctx, era, id, params);

    default:
      /*
       * 404 in the modern era — the revision is explicit that an unimplemented
       * method is `404 Not Found` carrying a `-32601`, so a client can tell it
       * apart from a legacy server that simply does not host this path. Legacy
       * revisions have no such rule and expect the error inside a 200.
       */
      return fail(
        era === "modern" ? 404 : 200,
        id,
        RPC.methodNotFound,
        `Unknown method: ${method}`,
      );
  }
}

/**
 * The legacy handshake's reply.
 *
 * Version negotiation is the whole job: echo the client's version when we know
 * it, otherwise name one we do support and let the client decide. **No session
 * id is minted** — `Mcp-Session-Id` is optional in every revision that has it,
 * and this server keeps no state between requests, so claiming a session would
 * be a promise we do not keep.
 */
function initializeResult(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
  const negotiated = MCP_LEGACY_VERSIONS.includes(requested)
    ? requested
    : PREFERRED_LEGACY_VERSION;

  return {
    protocolVersion: negotiated,
    capabilities: CAPABILITIES,
    serverInfo: SERVER_INFO,
    instructions: `${INSTRUCTIONS} This server also implements MCP ${MCP_PROTOCOL_VERSION}, which needs no handshake — send per-request _meta instead.`,
  };
}
