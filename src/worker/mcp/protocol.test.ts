import { describe, expect, it } from "vitest";

import {
  MCP_LEGACY_VERSIONS,
  MCP_PROTOCOL_VERSION,
  MCP_SUPPORTED_VERSIONS,
  META_PROTOCOL_VERSION,
  RPC,
  decodeHeaderValue,
  detectEra,
  expectedMcpName,
  isSupportedVersion,
  parseMcpMessage,
  readBodyProtocolVersion,
  unsupportedVersionError,
  validateModernHeaders,
} from "./protocol";

/** A well-formed modern request, for tests that vary one thing about it. */
function modernCall(overrides: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/call",
    params: {
      name: "keyword_overview",
      arguments: { keyword: "seo tools" },
      _meta: { [META_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION },
    },
    ...overrides,
  };
}

describe("protocol revisions", () => {
  it("advertises the revision this server was written against first", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2026-07-28");
    expect(MCP_SUPPORTED_VERSIONS[0]).toBe(MCP_PROTOCOL_VERSION);
  });

  it("keeps the legacy handshake revisions supported", () => {
    // Every MCP client shipping today opens with `initialize`. Dropping these
    // would make the endpoint unreachable from real tooling, so it is worth a
    // test rather than a comment.
    expect(MCP_LEGACY_VERSIONS).toContain("2025-11-25");
    expect(MCP_SUPPORTED_VERSIONS).toContain("2025-06-18");
  });

  it("rejects revisions it does not implement", () => {
    expect(isSupportedVersion("1900-01-01")).toBe(false);
    // Batching-era. Deliberately unsupported — see the note in protocol.ts.
    expect(isSupportedVersion("2025-03-26")).toBe(false);
  });

  it("names what it does support when it refuses one", () => {
    const error = unsupportedVersionError(7, "1900-01-01");
    expect(error.error.code).toBe(RPC.unsupportedProtocolVersion);
    expect(error.error.data).toEqual({
      supported: [...MCP_SUPPORTED_VERSIONS],
      requested: "1900-01-01",
    });
  });
});

describe("parseMcpMessage", () => {
  it("reads a request", () => {
    const parsed = parseMcpMessage({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect(parsed.kind).toBe("request");
  });

  it("reads a notification as one — no id member, not a null id", () => {
    const parsed = parseMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(parsed.kind).toBe("notification");
  });

  it("treats an explicit null id as a request, not a notification", () => {
    const parsed = parseMcpMessage({ jsonrpc: "2.0", id: null, method: "ping" });
    expect(parsed.kind).toBe("request");
  });

  it("refuses a batch array", () => {
    // Neither revision we implement allows batching: 2026-07-28 requires a
    // single message per POST and 2025-06-18 removed JSON-RPC batches.
    const parsed = parseMcpMessage([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(parsed).toMatchObject({ kind: "invalid", code: RPC.invalidRequest });
  });

  it("refuses a client-sent response", () => {
    const parsed = parseMcpMessage({ jsonrpc: "2.0", id: 1, result: {} });
    expect(parsed).toMatchObject({ kind: "invalid", code: RPC.invalidRequest });
  });

  it("refuses anything that is not JSON-RPC 2.0", () => {
    expect(parseMcpMessage({ jsonrpc: "1.0", id: 1, method: "ping" })).toMatchObject({
      kind: "invalid",
    });
    expect(parseMcpMessage({ id: 1, method: "ping" })).toMatchObject({ kind: "invalid" });
    expect(parseMcpMessage("nope")).toMatchObject({ kind: "invalid" });
  });

  it("refuses a message with no method", () => {
    expect(parseMcpMessage({ jsonrpc: "2.0", id: 1 })).toMatchObject({ kind: "invalid" });
  });

  it("keeps a usable id on a rejection so the client can correlate it", () => {
    const parsed = parseMcpMessage({ jsonrpc: "2.0", id: 42, method: "" });
    expect(parsed).toMatchObject({ kind: "invalid", id: 42 });
  });
});

describe("era detection", () => {
  it("treats per-request _meta as modern", () => {
    expect(detectEra("tools/list", { _meta: { [META_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION } }, undefined)).toBe(
      "modern",
    );
  });

  it("treats a modern protocol header as modern even with no body _meta", () => {
    // The header alone selects modern handling, which then fails header
    // validation — the correct outcome, since the body is required to match.
    expect(detectEra("tools/list", undefined, MCP_PROTOCOL_VERSION)).toBe("modern");
  });

  it("pins initialize to legacy however it is decorated", () => {
    // The spec: "An `initialize` request selects legacy semantics."
    expect(
      detectEra("initialize", { _meta: { [META_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION } }, MCP_PROTOCOL_VERSION),
    ).toBe("legacy");
  });

  it("falls back to legacy for a bare request", () => {
    // A legacy client that has already handshaked sends exactly this, and a
    // stateless server cannot tell it from a malformed modern call.
    expect(detectEra("tools/list", undefined, undefined)).toBe("legacy");
  });

  it("does not treat a legacy version header as modern", () => {
    expect(detectEra("tools/list", undefined, "2025-06-18")).toBe("legacy");
  });
});

describe("readBodyProtocolVersion", () => {
  it("reads the modern _meta field", () => {
    expect(
      readBodyProtocolVersion({ _meta: { [META_PROTOCOL_VERSION]: "2026-07-28" } }),
    ).toBe("2026-07-28");
  });

  it("reads legacy initialize's bare protocolVersion", () => {
    expect(readBodyProtocolVersion({ protocolVersion: "2025-11-25" })).toBe("2025-11-25");
  });

  it("is undefined when neither is present", () => {
    expect(readBodyProtocolVersion(undefined)).toBeUndefined();
    expect(readBodyProtocolVersion({ name: "x" })).toBeUndefined();
  });
});

describe("modern header validation", () => {
  const headers = {
    protocolVersion: MCP_PROTOCOL_VERSION,
    method: "tools/call",
    name: "keyword_overview",
  };

  it("accepts headers that agree with the body", () => {
    expect(validateModernHeaders(headers, modernCall())).toBeNull();
  });

  it("requires MCP-Protocol-Version", () => {
    expect(
      validateModernHeaders({ ...headers, protocolVersion: undefined }, modernCall()),
    ).toMatch(/MCP-Protocol-Version/);
  });

  it("requires Mcp-Method", () => {
    expect(validateModernHeaders({ ...headers, method: undefined }, modernCall())).toMatch(
      /Mcp-Method/,
    );
  });

  it("rejects a Mcp-Method that disagrees with the body", () => {
    // The attack this closes: a gateway routes on the header while we execute
    // the body, so the two must never be allowed to differ.
    expect(validateModernHeaders({ ...headers, method: "tools/list" }, modernCall())).toMatch(
      /does not match/,
    );
  });

  it("rejects a version header that disagrees with the body _meta", () => {
    expect(
      validateModernHeaders({ ...headers, protocolVersion: "2025-06-18" }, modernCall()),
    ).toMatch(/does not match/);
  });

  it("requires Mcp-Name on tools/call", () => {
    expect(validateModernHeaders({ ...headers, name: undefined }, modernCall())).toMatch(
      /Mcp-Name/,
    );
  });

  it("rejects a Mcp-Name that disagrees with the tool being called", () => {
    expect(validateModernHeaders({ ...headers, name: "domain_overview" }, modernCall())).toMatch(
      /Mcp-Name/,
    );
  });

  it("accepts a base64-sentinel Mcp-Name that decodes to the body value", () => {
    const encoded = `=?base64?${btoa("keyword_overview")}?=`;
    expect(validateModernHeaders({ ...headers, name: encoded }, modernCall())).toBeNull();
  });

  it("does not require Mcp-Name on a method that has no name", () => {
    const listCall = {
      jsonrpc: "2.0" as const,
      id: 2,
      method: "tools/list",
      params: { _meta: { [META_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION } },
    };
    expect(
      validateModernHeaders(
        { protocolVersion: MCP_PROTOCOL_VERSION, method: "tools/list" },
        listCall,
      ),
    ).toBeNull();
  });
});

describe("header value decoding", () => {
  it("passes plain ASCII through untouched", () => {
    expect(decodeHeaderValue("keyword_overview")).toBe("keyword_overview");
  });

  it("decodes the base64 sentinel, UTF-8 included", () => {
    expect(decodeHeaderValue(`=?base64?${btoa("hello")}?=`)).toBe("hello");
  });

  it("returns undecodable input unchanged, so it compares unequal", () => {
    expect(decodeHeaderValue("=?base64?!!!not-base64!!!?=")).toBe("=?base64?!!!not-base64!!!?=");
  });
});

describe("expectedMcpName", () => {
  it("is params.name for tools/call and prompts/get", () => {
    expect(expectedMcpName("tools/call", { name: "x" })).toBe("x");
    expect(expectedMcpName("prompts/get", { name: "y" })).toBe("y");
  });

  it("is params.uri for resources/read", () => {
    expect(expectedMcpName("resources/read", { uri: "file:///a" })).toBe("file:///a");
  });

  it("is null for methods that carry no name", () => {
    expect(expectedMcpName("tools/list", undefined)).toBeNull();
    expect(expectedMcpName("ping", undefined)).toBeNull();
  });
});
