import { exchangeMcpToken, oauthHeaders } from "@/lib/mcp-oauth";
import { limitLocalAction } from "@/lib/localRealtime";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    limitLocalAction(`mcp-token:${request.headers.get("x-real-ip") || "unknown"}`, 100, 60000);
    const text = await request.text(); if (text.length > 20000) throw new Error("invalid_request");
    return Response.json(exchangeMcpToken(new URLSearchParams(text)), { headers: oauthHeaders });
  } catch (error) { return Response.json({ error: error instanceof Error && ["invalid_target", "invalid_scope", "unsupported_grant_type"].includes(error.message) ? error.message : "invalid_grant" }, { status: 400, headers: oauthHeaders }); }
}
export { OPTIONS } from "../register/route";
