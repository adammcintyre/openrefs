/**
 *   POST /api/v1/mcp   Model Context Protocol, Streamable HTTP
 *   POST /mcp          the same router, mounted again (see app.ts)
 *
 * Everything this endpoint does lives in `../mcp/`. The router is here so the
 * module appears in the route registry like any other, which is what makes the
 * OpenAPI drift test see it.
 *
 * Note the absence of `requireSession`: the MCP handler does its own
 * authentication, because a rejection has to be a JSON-RPC frame rather than
 * our REST error envelope, and because it accepts only API keys — never the
 * session cookie. See `../mcp/server.ts` for why.
 */
import { Hono } from "hono";

import { handleMcpPost } from "../mcp/server";
import { RPC, rpcError } from "../mcp/protocol";
import type { AppEnv } from "../types";

const mcp = new Hono<AppEnv>();

mcp.post("/", handleMcpPost);

/**
 * GET and DELETE are 405.
 *
 * Both were real parts of the transport up to revision 2025-11-25: GET opened
 * a standalone SSE stream for server-initiated messages, DELETE terminated a
 * session. This revision removed both, and instructs a server that receives
 * them from an older client to answer exactly this way rather than pretending.
 */
mcp.get("/", (c) =>
  c.json(
    rpcError(
      null,
      RPC.invalidRequest,
      "This MCP endpoint accepts POST only. The GET stream was removed in protocol revision 2026-07-28.",
    ),
    405,
    { allow: "POST" },
  ),
);

mcp.delete("/", (c) =>
  c.json(
    rpcError(
      null,
      RPC.invalidRequest,
      "This MCP endpoint accepts POST only. It is stateless, so there is no session to delete.",
    ),
    405,
    { allow: "POST" },
  ),
);

export default mcp;
