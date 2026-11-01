import { exchangeMcpToken, flushMcpRevocations, oauthHeaders, OAuthError } from "@/lib/mcp-oauth";
import { TooManyRequests } from "@/lib/localRealtime";
import { limitOAuthEndpoint } from "@/lib/mcp-rate-limit";
import { readBoundedText } from "@/lib/http-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const params = new URLSearchParams(await readBoundedText(request, 20000));
    limitOAuthEndpoint(request, "mcp-token", params.get("client_id") || "", 60);
    return Response.json(exchangeMcpToken(params), { headers: oauthHeaders });
  } catch (error) {
    if (error instanceof TooManyRequests) return Response.json({ error: "temporarily_unavailable", error_description: "Too many requests. Try again shortly." }, { status: 429, headers: { ...oauthHeaders, "Retry-After": "60" } });
    const code = error instanceof OAuthError ? error.code : "invalid_request";
    return Response.json({ error: code, ...(error instanceof OAuthError && error.message !== code ? { error_description: error.message } : {}) }, { status: code === "invalid_client" ? 401 : 400, headers: oauthHeaders });
  } finally { await flushMcpRevocations().catch(() => {}); }
}
export { OPTIONS } from "../register/route";
