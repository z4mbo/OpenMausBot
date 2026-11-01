import { exchangeMcpToken, oauthHeaders, OAuthError } from "@/lib/mcp-oauth";
import { limitLocalAction } from "@/lib/localRealtime";
import { readBoundedText } from "@/lib/http-body";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    limitLocalAction(`mcp-token:${request.headers.get("x-real-ip") || "unknown"}`, 100, 60000);
    return Response.json(exchangeMcpToken(new URLSearchParams(await readBoundedText(request, 20000))), { headers: oauthHeaders });
  } catch (error) {
    const code = error instanceof OAuthError ? error.code : "invalid_request";
    return Response.json({ error: code, ...(error instanceof OAuthError && error.message !== code ? { error_description: error.message } : {}) }, { status: code === "invalid_client" ? 401 : 400, headers: oauthHeaders });
  }
}
export { OPTIONS } from "../register/route";
