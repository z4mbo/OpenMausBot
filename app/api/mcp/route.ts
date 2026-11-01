import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { api } from "@/convex/_generated/api";
import { getConvexClient, limitLocalAction } from "@/lib/localRealtime";
import { BodyTooLarge, readBoundedJson } from "@/lib/http-body";
import { mcpResourceMetadata, mcpScopes, resolveMcpToken } from "@/lib/mcp-oauth";
import { PAT_PREFIX } from "@/lib/mcp-tokens";
import { originMcpServer } from "@/lib/mcp-server";

// Remote MCP server, Streamable HTTP in stateless JSON mode: each POST carries one JSON-RPC message or batch and
// gets a JSON response. Auth is a Bearer token: an OAuth access token from /oauth/token or a personal access token.
// Requests never rely on cookies, so a cross-origin page cannot use the user's credentials.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version" };

function unauthorized(error = "invalid_token") {
  const challenge = `Bearer resource_metadata="${mcpResourceMetadata()}", scope="${mcpScopes.join(" ")}"${error ? `, error="${error}"` : ""}`;
  return Response.json({ error }, { status: 401, headers: { ...cors, "WWW-Authenticate": challenge, "Cache-Control": "no-store" } });
}

async function authenticate(request: Request) {
  const header = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!bearer) return null;
  try {
    const pat = bearer.startsWith(PAT_PREFIX);
    const resolved = pat ? { connectorToken: bearer, write: true, grantId: createHash("sha256").update(bearer).digest("hex").slice(0, 24) } : resolveMcpToken(bearer);
    const access = await getConvexClient().query(api.connectors.verify, { token: resolved.connectorToken });
    return { token: resolved.connectorToken, write: resolved.write && access.write, key: resolved.grantId };
  } catch { return undefined; }
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return unauthorized(auth === null ? "" : "invalid_token");
  try { limitLocalAction(`mcp:${auth.key}`, 240, 60000); }
  catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests" } }, { status: 429, headers: { ...cors, "Retry-After": "60" } }); }
  let parsedBody: unknown;
  try { parsedBody = await readBoundedJson(request, 200000); }
  catch (error) { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error instanceof BodyTooLarge ? "Request too large" : "Parse error" } }, { status: error instanceof BodyTooLarge ? 413 : 400, headers: cors }); }
  const server = originMcpServer(auth.token, auth.write);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body ? await response.text() : null, { status: response.status, headers });
  } finally { await server.close(); }
}

// No server-initiated stream: GET and DELETE are not offered (Streamable HTTP allows 405).
export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return unauthorized(auth === null ? "" : "invalid_token");
  return new Response(null, { status: 405, headers: { ...cors, Allow: "POST" } });
}
export async function DELETE() { return new Response(null, { status: 405, headers: { ...cors, Allow: "POST" } }); }
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID", "Access-Control-Max-Age": "86400" } });
}
