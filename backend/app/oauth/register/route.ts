import { registerMcpClient, oauthHeaders } from "@/lib/mcp-oauth";
import { limitLocalAction } from "@/lib/localRealtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    limitLocalAction(`mcp-register:${request.headers.get("x-real-ip") || "unknown"}`, 15, 60000);
    const text = await request.text(); if (text.length > 20000) throw new Error("Request too large");
    return Response.json(registerMcpClient(JSON.parse(text)), { status: 201, headers: oauthHeaders });
  } catch { return Response.json({ error: "invalid_client_metadata", error_description: "Use exact HTTPS or loopback IP redirect URIs and public-client authentication (none). Registration is rate limited." }, { status: 400, headers: oauthHeaders }); }
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: { ...oauthHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } }); }
