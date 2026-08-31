/**
 * The MCP endpoint, driven end to end through `app.request()`.
 *
 * Two apps are used. `createApp()` — the real one — covers everything that can
 * be decided without a credential, because `loadSession` takes its anonymous
 * fast path and never touches D1. Anything past authentication runs against
 * `authedApp()`, which mounts the same router behind a middleware that sets the
 * session `loadSession` would have set. That keeps these tests in plain vitest
 * with no bindings, which is the rule vitest.config.ts sets out.
 *
 * The DataForSEO layer is faked at the service boundary rather than at the HTTP
 * one. That is the honest seam for this suite: the point under test is that a
 * tool call reaches the same service the REST route reaches and renders what it
 * returns, not that DataForSEO's wire format is parsed correctly — which
 * src/worker/dataforseo/*.test.ts already covers against the sandbox.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APP_VERSION } from "../../shared/version";
import { createApp } from "../app";
import { ApiException } from "../http";
import type { AppEnv } from "../types";
import {
  MCP_PROTOCOL_VERSION,
  META_PROTOCOL_VERSION,
  META_SERVER_INFO,
  RPC,
} from "./protocol";
import mcpRouter from "../routes/mcp";

const keywordOverview = vi.fn();

vi.mock("../services/keywords", () => ({
  keywordOverview: (...args: unknown[]) => keywordOverview(...args),
  keywordIdeas: vi.fn(),
  keywordSerp: vi.fn(),
}));

const env = { APP_ENV: "development", DB: {} } as unknown as Env;

const WORKSPACE = "ws_11111111-1111-1111-1111-111111111111";

/** The router behind an already-resolved API-key session. */
function authedApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", "test");
    c.set("session", {
      kind: "api_key",
      apiKeyId: "key_1",
      workspaceId: WORKSPACE,
      userId: null,
    });
    await next();
  });
  app.route("/mcp", mcpRouter);
  return app;
}

/** POSTs one JSON-RPC message, legacy-style (no per-request metadata). */
async function rpc(body: unknown, app = authedApp()): Promise<Response> {
  return app.request(
    "/mcp",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

/** POSTs one modern message, with the mirrored headers the revision requires. */
async function modernRpc(
  method: string,
  params: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const withMeta = {
    ...params,
    _meta: {
      [META_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION,
      "io.modelcontextprotocol/clientInfo": { name: "vitest", version: "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    "mcp-method": method,
    ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
    ...extraHeaders,
  };
  return authedApp().request(
    "/mcp",
    { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: withMeta }) },
    env,
  );
}

beforeEach(() => {
  keywordOverview.mockReset();
});

describe("authentication", () => {
  it("refuses an anonymous caller with 401 and a JSON-RPC error", async () => {
    const res = await createApp().request(
      "/api/v1/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      env,
    );

    expect(res.status).toBe(401);
    // A JSON-RPC frame, not our REST error envelope: an MCP client cannot read
    // the latter.
    const body = (await res.json()) as { jsonrpc: string; error: { code: number } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(RPC.unauthorized);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("tells an unauthenticated caller where to get a key", async () => {
    const res = await createApp().request(
      "/api/v1/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      },
      env,
    );
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/API Keys/);
  });

  it("is mounted at the bare /mcp alias too", async () => {
    const res = await createApp().request(
      "/mcp",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      env,
    );
    // 401 rather than 404 proves the alias resolves to this handler.
    expect(res.status).toBe(401);
  });
});

describe("initialize (legacy handshake)", () => {
  it("returns capabilities and serverInfo", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0.0" },
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: number;
      result: {
        protocolVersion: string;
        capabilities: { tools: { listChanged: boolean } };
        serverInfo: { name: string; version: string };
        instructions: string;
      };
    };

    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-11-25");
    expect(body.result.capabilities.tools).toEqual({ listChanged: false });
    expect(body.result.serverInfo).toMatchObject({
      name: "openrefs",
      version: APP_VERSION,
    });
    expect(body.result.instructions).toBeTypeOf("string");
  });

  it("mints no session id — the server is stateless", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: {} },
    });
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });

  it("names a version it supports when the client asks for one it does not", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: {} },
    });
    const body = (await res.json()) as { result: { protocolVersion: string } };
    // Negotiation, not rejection: the handshake exists to settle this.
    expect(body.result.protocolVersion).toBe("2025-11-25");
  });

  it("does not leak the modern resultType into a legacy result", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: {} },
    });
    const body = (await res.json()) as { result: Record<string, unknown> };
    expect(body.result).not.toHaveProperty("resultType");
  });
});

describe("server/discover (modern)", () => {
  it("reports supported versions, capabilities and identity", async () => {
    const res = await modernRpc("server/discover", {});
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      result: {
        resultType: string;
        supportedVersions: string[];
        capabilities: Record<string, unknown>;
        _meta: Record<string, { name: string; version: string }>;
      };
    };

    expect(body.result.resultType).toBe("complete");
    expect(body.result.supportedVersions[0]).toBe(MCP_PROTOCOL_VERSION);
    expect(body.result.capabilities).toHaveProperty("tools");
    expect(body.result._meta[META_SERVER_INFO]).toMatchObject({
      name: "openrefs",
      version: APP_VERSION,
    });
  });
});

describe("tools/list", () => {
  it("lists all twelve tools", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools).toHaveLength(12);
    expect(body.result.tools.map((entry) => entry.name)).toEqual([
      "keyword_overview",
      "keyword_ideas",
      "keyword_serp",
      "domain_overview",
      "domain_keywords",
      "backlinks_summary",
      "gap_keywords",
      "content_discover",
      "list_collections",
      "add_keywords_to_collection",
      "list_projects",
      "tracked_keywords",
    ]);
  });

  it("gives every tool a valid JSON Schema object", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = (await res.json()) as {
      result: {
        tools: {
          name: string;
          title: string;
          description: string;
          inputSchema: {
            $schema?: string;
            type: string;
            properties?: Record<string, unknown>;
            required?: string[];
            additionalProperties?: boolean;
          };
        }[];
      };
    };

    for (const entry of body.result.tools) {
      expect(entry.title, entry.name).toBeTruthy();
      expect(entry.description, entry.name).toBeTruthy();

      const schema = entry.inputSchema;
      // MUST be a valid JSON Schema object, never null.
      expect(schema, entry.name).toBeTypeOf("object");
      expect(schema.type, entry.name).toBe("object");
      expect(schema.$schema, entry.name).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect(schema.additionalProperties, entry.name).toBe(false);

      // Every required name must actually be a declared property, or a client
      // validating against this schema can never satisfy it.
      for (const name of schema.required ?? []) {
        expect(Object.keys(schema.properties ?? {}), `${entry.name}.${name}`).toContain(name);
      }
    }
  });

  it("declares no workspace argument anywhere — the key carries the scope", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = (await res.json()) as {
      result: { tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[] };
    };

    for (const entry of body.result.tools) {
      expect(Object.keys(entry.inputSchema.properties ?? {}), entry.name).not.toContain(
        "workspace",
      );
    }
  });

  it("returns tools in a stable order across calls", async () => {
    // The spec asks for deterministic ordering so clients and model prompt
    // caches can rely on the list.
    const first = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as {
      result: { tools: { name: string }[] };
    };
    const second = (await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(first.result.tools.map((t) => t.name)).toEqual(
      second.result.tools.map((t) => t.name),
    );
  });
});

describe("tools/call", () => {
  const overview = {
    keyword: "seo tools",
    locationCode: 2826,
    languageCode: "en",
    searchVolume: 8100,
    cpc: 6.42,
    competition: 0.51,
    competitionLevel: "MEDIUM",
    lowTopOfPageBid: 1.2,
    highTopOfPageBid: 9.8,
    keywordDifficulty: 74,
    intent: "commercial",
    intentProbability: null,
    secondaryIntents: [],
    monthlySearches: [],
    costUsd: 0,
    cached: true,
  };

  it("runs the tool and returns compact JSON as text content", async () => {
    keywordOverview.mockResolvedValue(overview);

    const res = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "keyword_overview", arguments: { keyword: "seo tools" } },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: { type: string; text: string }[]; isError: boolean };
    };

    expect(body.result.isError).toBe(false);
    expect(body.result.content[0]?.type).toBe("text");
    expect(JSON.parse(body.result.content[0]?.text ?? "")).toEqual(overview);
  });

  it("passes the key's workspace through, and never one from the arguments", async () => {
    keywordOverview.mockResolvedValue(overview);

    await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "keyword_overview",
        // A caller trying to reach another tenant. `workspace` is not in the
        // schema, so it is stripped before the service ever sees it.
        arguments: { keyword: "seo tools", workspace: "ws_someone_else" },
      },
    });

    expect(keywordOverview).toHaveBeenCalledTimes(1);
    const input = keywordOverview.mock.calls[0]?.[2] as { workspace: string };
    expect(input.workspace).toBe(WORKSPACE);
  });

  it("applies the documented default market when none is given", async () => {
    keywordOverview.mockResolvedValue(overview);

    await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "keyword_overview", arguments: { keyword: "seo tools" } },
    });

    const input = keywordOverview.mock.calls[0]?.[2] as {
      location: number;
      language: string;
    };
    expect(input).toMatchObject({ location: 2826, language: "en" });
  });

  it("maps an ApiException to a tool error carrying our code", async () => {
    keywordOverview.mockRejectedValue(
      new ApiException("spend_cap_exceeded", "This workspace is over its monthly spend cap."),
    );

    const res = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "keyword_overview", arguments: { keyword: "seo tools" } },
    });

    // A tool execution error, not a protocol error: the model can act on it.
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { content: { text: string }[]; isError: boolean };
      error?: unknown;
    };
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);

    const payload = JSON.parse(body.result.content[0]?.text ?? "") as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe("spend_cap_exceeded");
    expect(payload.error.message).toMatch(/spend cap/);
  });

  it("reports bad arguments as a fixable tool error", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      // `keyword` is required.
      params: { name: "keyword_overview", arguments: { location: 2840 } },
    });

    const body = (await res.json()) as { result: { content: { text: string }[]; isError: boolean } };
    expect(body.result.isError).toBe(true);
    expect(JSON.parse(body.result.content[0]?.text ?? "")).toMatchObject({
      error: { code: "validation_failed" },
    });
    expect(keywordOverview).not.toHaveBeenCalled();
  });

  it("rejects an unknown tool as a protocol error", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    });

    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(RPC.invalidParams);
    expect(body.error.message).toMatch(/no_such_tool/);
  });
});

describe("ping", () => {
  it("answers with an empty result", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 7, method: "ping" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });
});

describe("unknown methods", () => {
  it("is method-not-found, inside a 200, in the legacy era", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 8, method: "resources/list" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(RPC.methodNotFound);
  });

  it("is method-not-found inside a 404 in the modern era", async () => {
    // The revision is explicit: an unimplemented method is 404 carrying -32601,
    // so a client can tell it from a legacy server that lacks this path.
    const res = await modernRpc("resources/list", {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(RPC.methodNotFound);
  });
});

describe("notifications", () => {
  it("answers 202 with an empty body", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
});

describe("framing", () => {
  it("rejects a batch array", async () => {
    const res = await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(RPC.invalidRequest);
    expect(body.error.message).toMatch(/one JSON-RPC message per POST/);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await authedApp().request(
      "/mcp",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{{{" },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(RPC.parseError);
  });

  it("answers GET with 405 — the GET stream was removed", async () => {
    const res = await authedApp().request("/mcp", { method: "GET" }, env);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("answers DELETE with 405 — there is no session to end", async () => {
    const res = await authedApp().request("/mcp", { method: "DELETE" }, env);
    expect(res.status).toBe(405);
  });
});

describe("modern header validation", () => {
  it("rejects a Mcp-Method that disagrees with the body", async () => {
    const res = await modernRpc("tools/list", {}, { "mcp-method": "ping" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(RPC.headerMismatch);
  });

  it("rejects a modern request with no Mcp-Method header at all", async () => {
    const app = authedApp();
    const res = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: { [META_PROTOCOL_VERSION]: MCP_PROTOCOL_VERSION } },
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(RPC.headerMismatch);
  });

  it("rejects a protocol version it does not implement", async () => {
    const app = authedApp();
    const res = await app.request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "1999-01-01",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: { [META_PROTOCOL_VERSION]: "1999-01-01" } },
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: number; data: { supported: string[] } };
    };
    expect(body.error.code).toBe(RPC.unsupportedProtocolVersion);
    expect(body.error.data.supported).toContain(MCP_PROTOCOL_VERSION);
  });
});

describe("cross-origin", () => {
  it("refuses a browser request from another origin", async () => {
    // The cookie is not accepted here, so this is belt and braces — but the
    // transport requires an Origin check and a bill is the cost of getting it
    // wrong.
    const res = await authedApp().request(
      "/mcp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });
});
