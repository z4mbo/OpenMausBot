import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { api } from "@/convex/_generated/api";
import { getConvexClient, limitLocalAction } from "@/lib/localRealtime";
import { BodyTooLarge, readBoundedJson } from "@/lib/http-body";
import { mcpResourceMetadata, mcpScopes, resolveMcpToken } from "@/lib/mcp-oauth";
import { isPatFormat, PAT_PREFIX } from "@/lib/mcp-tokens";
import { mcpAuthBlocked, recordMcpAuthFailure } from "@/lib/mcp-rate-limit";
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

type Auth = { token: string; write: boolean; key: string };
const tooMany = () => Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests" } }, { status: 429, headers: { ...cors, "Retry-After": "60" } });
// PATs verified recently skip the failed-authentication gate, so a flood of bad tokens cannot lock them out.
const knownPats = new Map<string, number>();
const KNOWN_PAT_TTL = 10 * 60000;

/**
 * Resolves the bearer without calling Convex for anything that cannot be valid: malformed personal access tokens
 * and unknown OAuth tokens fail locally. Failures are rate limited before any Convex call.
 */
async function authenticate(request: Request): Promise<Auth | Response> {
  const header = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!bearer) return unauthorized("");
  const fail = () => { recordMcpAuthFailure(request); return unauthorized(); };
  let resolved: { connectorToken: string; write: boolean; key: string };
  if (bearer.startsWith(PAT_PREFIX)) {
    if (!isPatFormat(bearer)) return fail();
    const key = createHash("sha256").update(bearer).digest("hex").slice(0, 24);
    if ((knownPats.get(key) ?? 0) < Date.now() && mcpAuthBlocked(request)) return tooMany();
    resolved = { connectorToken: bearer, write: true, key };
  } else {
    // OAuth tokens resolve locally; only valid ones reach Convex.
    try { const grant = resolveMcpToken(bearer); resolved = { connectorToken: grant.connectorToken, write: grant.write, key: grant.grantId }; }
    catch { return mcpAuthBlocked(request) ? tooMany() : fail(); }
  }
  try { limitLocalAction(`mcp:${resolved.key}`, 240, 60000); } catch { return tooMany(); }
  try {
    const access = await getConvexClient().query(api.connectors.verify, { token: resolved.connectorToken });
    if (bearer.startsWith(PAT_PREFIX)) {
      knownPats.set(resolved.key, Date.now() + KNOWN_PAT_TTL);
      if (knownPats.size > 10000) for (const [key, expires] of knownPats) if (expires < Date.now()) knownPats.delete(key);
    }
    return { token: resolved.connectorToken, write: resolved.write && access.write, key: resolved.key };
  } catch {
    knownPats.delete(resolved.key);
    return fail();
  }
}

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
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
  if (auth instanceof Response) return auth;
  return new Response(null, { status: 405, headers: { ...cors, Allow: "POST" } });
}
export async function DELETE() { return new Response(null, { status: 405, headers: { ...cors, Allow: "POST" } }); }
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID", "Access-Control-Max-Age": "86400" } });
}
