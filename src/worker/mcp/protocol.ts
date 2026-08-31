/**
 * MCP wire protocol: framing, versioning and header validation.
 *
 * Hand-rolled JSON-RPC 2.0 — no SDK. Every SDK that speaks Streamable HTTP
 * today assumes a server object it can keep alive between messages, which on
 * Workers means a Durable Object. docs/ARCHITECTURE.md forbids those (the free
 * plan has none), so the transport is implemented here instead. It is a small
 * surface: one POST, one message, one response.
 *
 * ## Which revision this is
 *
 * We implement **2026-07-28**, verified against
 * https://modelcontextprotocol.io/specification/2026-07-28 on 2026-08-31.
 *
 * That revision is a bigger break than its date suggests, and the shape of
 * this file follows from it. In 2026-07-28 there is **no `initialize`
 * handshake at all**: protocol sessions were removed, the GET stream endpoint
 * was removed, and every request now carries its own version, client identity
 * and client capabilities in `params._meta`, mirrored into HTTP headers. The
 * spec calls that the "modern" era and calls `initialize`-based revisions
 * (`2025-11-25` and earlier) "legacy".
 *
 * ## Why this server answers both
 *
 * The spec explicitly blesses it: "A dual-era server MAY serve both eras
 * concurrently on the same endpoint or process." We do, because the two eras
 * have opposite failure modes and we want neither:
 *
 *  - A modern-only server rejects every client shipping today. Legacy clients
 *    have no fall-forward mechanism — the compatibility matrix marks
 *    Legacy→Modern simply "Fails" — so refusing `initialize` would make this
 *    server unusable from current tooling.
 *  - A legacy-only server is already obsolete, and a modern client that meets
 *    one gets an implementation-defined error at best.
 *
 * Era is selected per request, from the message itself:
 *
 *  - `initialize` always selects legacy ("An `initialize` request selects
 *    legacy semantics"). We answer it, and mint **no session id** — statelessness
 *    is ours to keep, and `Mcp-Session-Id` is optional in every legacy revision.
 *  - Anything carrying `_meta["io.modelcontextprotocol/protocolVersion"]`, or an
 *    `MCP-Protocol-Version` header naming a modern version, is served modern:
 *    headers are validated against the body, and results carry `resultType`.
 *  - Anything else is served legacy-leniently. A legacy client that has already
 *    handshaked sends a bare `tools/list`, and there is nothing in a stateless
 *    request to distinguish that from a malformed modern one.
 *
 * ## Deliberate non-features
 *
 *  - **No batching.** Both eras we implement forbid it: 2026-07-28 says the
 *    POST body "MUST be a single JSON-RPC request or notification", and JSON-RPC
 *    batching was dropped in 2025-06-18. An array gets `-32600`.
 *  - **No SSE.** Every method here answers in one shot from one upstream call,
 *    so `application/json` is always the honest content type. The spec lets the
 *    server choose per request.
 *  - **No sessions, no resumability.** `Mcp-Session-Id` and `Last-Event-ID` are
 *    ignored, exactly as the revision instructs a non-session server to do.
 */

/** The revision this server implements and advertises first. */
export const MCP_PROTOCOL_VERSION = "2026-07-28";

/**
 * Revisions whose semantics are the per-request-metadata ("modern") ones.
 *
 * A bare `MCP-Protocol-Version` header naming one of these is enough to select
 * modern handling even before the body is inspected.
 */
export const MCP_MODERN_VERSIONS: readonly string[] = [MCP_PROTOCOL_VERSION];

/**
 * `initialize`-era revisions we still answer.
 *
 * Both define the `MCP-Protocol-Version` header and the same
 * initialize/tools-list/tools-call surface we expose, so serving them is a
 * matter of echoing the right version string back. Older revisions
 * (`2025-03-26`, `2024-11-05`) are deliberately absent: `2025-03-26` allowed
 * JSON-RPC batches and `2024-11-05` used the deprecated HTTP+SSE transport, and
 * claiming support we do not implement is worse than declining.
 */
export const MCP_LEGACY_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18"];

/** Everything `server/discover` and `UnsupportedProtocolVersionError` advertise. */
export const MCP_SUPPORTED_VERSIONS: readonly string[] = [
  ...MCP_MODERN_VERSIONS,
  ...MCP_LEGACY_VERSIONS,
];

/** The `_meta` key carrying the per-request protocol version (modern era). */
export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
/** The `_meta` key carrying client identity (modern era). */
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
/** The `_meta` key `server/discover` returns our identity under. */
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

/**
 * JSON-RPC and MCP error codes.
 *
 * `-32020` and `-32022` are allocated by the MCP spec from the range it
 * reserves for protocol-defined errors; the rest are plain JSON-RPC 2.0.
 * `-32001` is ours, from JSON-RPC's implementation-defined server range
 * (-32000..-32099) — MCP defines no code for "your credential was rejected",
 * because it expects OAuth to have answered that at the HTTP layer.
 */
export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Ours: no usable `Authorization: Bearer orf_...`. Paired with HTTP 401. */
  unauthorized: -32001,
  /** MCP: headers disagree with the body, or a required header is missing. */
  headerMismatch: -32020,
  /** MCP: we do not implement the requested protocol version. */
  unsupportedProtocolVersion: -32022,
} as const;

/** A JSON-RPC id. `null` is legal on an error response to an unparseable call. */
export type RpcId = string | number | null;

export interface RpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcRequest {
  jsonrpc: "2.0";
  id: RpcId;
  method: string;
  params?: Record<string, unknown>;
}

/** A notification is a request with no `id` — it gets 202 and no body. */
export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type RpcMessage = RpcRequest | RpcNotification;

export interface RpcSuccess {
  jsonrpc: "2.0";
  id: RpcId;
  result: Record<string, unknown>;
}

export interface RpcFailure {
  jsonrpc: "2.0";
  id: RpcId;
  error: RpcErrorObject;
}

export type RpcResponse = RpcSuccess | RpcFailure;

/** Which set of semantics one request selected. See the file header. */
export type McpEra = "modern" | "legacy";

export function rpcResult(id: RpcId, result: Record<string, unknown>): RpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: RpcId,
  code: number,
  message: string,
  data?: unknown,
): RpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/**
 * What a parsed POST body turned out to be.
 *
 * `invalid` carries the failure verbatim rather than throwing, because the
 * transport has to answer differently depending on *why* it failed — a bad
 * envelope is 400, an unknown method is 404 — and that decision belongs to the
 * caller, not here.
 */
export type ParsedMessage =
  | { kind: "request"; message: RpcRequest }
  | { kind: "notification"; message: RpcNotification }
  | { kind: "invalid"; id: RpcId; code: number; message: string };

/** Narrows an unknown JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An id is only usable when it is a string or a number; anything else is null. */
function readId(value: unknown): RpcId {
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

/**
 * Validates one JSON-RPC envelope.
 *
 * Arrays are rejected on purpose — see "Deliberate non-features" above. A
 * JSON-RPC *response* posted by a client is rejected too: the spec is explicit
 * that "clients MUST NOT send JSON-RPC responses", and quietly accepting one
 * would leave a client believing a message was delivered somewhere.
 */
export function parseMcpMessage(body: unknown): ParsedMessage {
  if (Array.isArray(body)) {
    return {
      kind: "invalid",
      id: null,
      code: RPC.invalidRequest,
      message:
        "Batched arrays are not supported. Send one JSON-RPC message per POST.",
    };
  }

  if (!isRecord(body)) {
    return {
      kind: "invalid",
      id: null,
      code: RPC.invalidRequest,
      message: "Expected a JSON-RPC 2.0 object.",
    };
  }

  const id = readId(body.id);

  if (body.jsonrpc !== "2.0") {
    return {
      kind: "invalid",
      id,
      code: RPC.invalidRequest,
      message: 'Expected "jsonrpc": "2.0".',
    };
  }

  if ("result" in body || "error" in body) {
    return {
      kind: "invalid",
      id,
      code: RPC.invalidRequest,
      message: "This endpoint accepts requests and notifications, not responses.",
    };
  }

  if (typeof body.method !== "string" || body.method === "") {
    return {
      kind: "invalid",
      id,
      code: RPC.invalidRequest,
      message: "A JSON-RPC message needs a method.",
    };
  }

  const params = isRecord(body.params) ? body.params : undefined;

  // No `id` member at all — not `id: null`, which is a request with a null id.
  if (!("id" in body)) {
    return {
      kind: "notification",
      message: { jsonrpc: "2.0", method: body.method, params },
    };
  }

  return {
    kind: "request",
    message: { jsonrpc: "2.0", id, method: body.method, params },
  };
}

/** `params._meta`, when the caller sent one. */
export function readMeta(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const meta = params?._meta;
  return isRecord(meta) ? meta : undefined;
}

/**
 * The protocol version declared in the body, if any.
 *
 * Modern requests carry it in `_meta`; legacy `initialize` carries it as a bare
 * `params.protocolVersion`. Both are read here so one helper answers "what did
 * the caller say it speaks" regardless of era.
 */
export function readBodyProtocolVersion(
  params: Record<string, unknown> | undefined,
): string | undefined {
  const fromMeta = readMeta(params)?.[META_PROTOCOL_VERSION];
  if (typeof fromMeta === "string") return fromMeta;
  const bare = params?.protocolVersion;
  return typeof bare === "string" ? bare : undefined;
}

/**
 * Which era a message selects.
 *
 * `initialize` is pinned to legacy by the spec even if the caller decorates it
 * with modern `_meta`, so it is checked first.
 */
export function detectEra(
  method: string,
  params: Record<string, unknown> | undefined,
  headerVersion: string | undefined,
): McpEra {
  if (method === "initialize") return "legacy";
  if (typeof readMeta(params)?.[META_PROTOCOL_VERSION] === "string") return "modern";
  if (headerVersion !== undefined && MCP_MODERN_VERSIONS.includes(headerVersion)) {
    return "modern";
  }
  return "legacy";
}

/**
 * Decodes the `=?base64?…?=` sentinel the transport uses for header values that
 * are not plain ASCII. Returns the input unchanged when it is not encoded, so
 * callers can compare the result to the body value either way.
 */
export function decodeHeaderValue(value: string): string {
  if (!value.startsWith("=?base64?") || !value.endsWith("?=")) return value;
  const encoded = value.slice("=?base64?".length, -"?=".length);
  try {
    // atob gives bytes-as-latin1; re-decode as UTF-8 so a non-ASCII tool name
    // round-trips to the same string the body holds.
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    // Undecodable is not equal to anything, which is the correct outcome: the
    // caller compares it to the body value and raises HeaderMismatch.
    return value;
  }
}

/** The `Mcp-Name` source value for a method, or null when none is required. */
export function expectedMcpName(
  method: string,
  params: Record<string, unknown> | undefined,
): string | null {
  if (method === "tools/call" || method === "prompts/get") {
    return typeof params?.name === "string" ? params.name : "";
  }
  if (method === "resources/read") {
    return typeof params?.uri === "string" ? params.uri : "";
  }
  return null;
}

export interface McpHeaders {
  protocolVersion?: string;
  method?: string;
  name?: string;
}

/**
 * Modern-era header validation.
 *
 * Returns an error message, or null when the request is well-formed. The rule
 * the spec is protecting is worth restating: an intermediary may route on
 * `Mcp-Method` while we execute `body.method`, so any disagreement between the
 * two is a security bug, not a formatting nit. Hence a hard 400 rather than
 * "prefer the body".
 */
export function validateModernHeaders(
  headers: McpHeaders,
  message: RpcRequest | RpcNotification,
): string | null {
  const bodyVersion = readBodyProtocolVersion(message.params);

  if (headers.protocolVersion === undefined) {
    return "Missing required MCP-Protocol-Version header.";
  }
  if (bodyVersion === undefined) {
    return `MCP-Protocol-Version header is '${headers.protocolVersion}' but the body carries no _meta['${META_PROTOCOL_VERSION}'].`;
  }
  if (headers.protocolVersion !== bodyVersion) {
    return `MCP-Protocol-Version header '${headers.protocolVersion}' does not match body value '${bodyVersion}'.`;
  }

  if (headers.method === undefined) {
    return "Missing required Mcp-Method header.";
  }
  if (headers.method !== message.method) {
    return `Mcp-Method header '${headers.method}' does not match body value '${message.method}'.`;
  }

  const expectedName = expectedMcpName(message.method, message.params);
  if (expectedName !== null) {
    if (headers.name === undefined) {
      return `Missing required Mcp-Name header for ${message.method}.`;
    }
    if (decodeHeaderValue(headers.name) !== expectedName) {
      return `Mcp-Name header does not match the body value '${expectedName}'.`;
    }
  }

  return null;
}

/** True when we implement the revision the caller asked for. */
export function isSupportedVersion(version: string): boolean {
  return MCP_SUPPORTED_VERSIONS.includes(version);
}

/** The `UnsupportedProtocolVersionError` payload, per the spec's example. */
export function unsupportedVersionError(id: RpcId, requested: string): RpcFailure {
  return rpcError(id, RPC.unsupportedProtocolVersion, "Unsupported protocol version", {
    supported: [...MCP_SUPPORTED_VERSIONS],
    requested,
  });
}
