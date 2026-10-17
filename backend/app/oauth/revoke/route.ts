import { revokeMcpToken, oauthHeaders } from "@/lib/mcp-oauth";
import { limitLocalAction } from "@/lib/localRealtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    limitLocalAction(`mcp-revoke:${request.headers.get("x-real-ip") || "unknown"}`, 60, 60000);
    const text = await request.text(); if (text.length > 20000) return new Response(null, { status: 400 });
    const params = new URLSearchParams(text); revokeMcpToken(params.get("token") || "", params.get("client_id") || "");
    return new Response(null, { status: 200, headers: oauthHeaders });
  } catch { return new Response(null, { status: 400, headers: oauthHeaders }); }
}
export { OPTIONS } from "../register/route";
