import { registerMcpClient, oauthHeaders } from "@/lib/mcp-oauth";
import { limitLocalAction } from "@/lib/localRealtime";
import { readBoundedJson } from "@/lib/http-body";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    limitLocalAction(`mcp-register:${request.headers.get("x-real-ip") || "unknown"}`, 15, 60000);
    return Response.json(registerMcpClient(await readBoundedJson(request, 20000)), { status: 201, headers: oauthHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("redirect") ? "invalid_redirect_uri" : "invalid_client_metadata", error_description: "Use HTTPS or loopback redirect URIs and token_endpoint_auth_method none." }, { status: 400, headers: oauthHeaders });
  }
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: { ...oauthHeaders, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version" } }); }
