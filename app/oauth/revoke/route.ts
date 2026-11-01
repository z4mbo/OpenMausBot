import { api } from "@/convex/_generated/api";
import { flushMcpRevocations, revokeMcpToken, oauthHeaders } from "@/lib/mcp-oauth";
import { getConvexClient, TooManyRequests } from "@/lib/localRealtime";
import { readBoundedText } from "@/lib/http-body";
import { isPatFormat, PAT_PREFIX } from "@/lib/mcp-tokens";
import { limitOAuthEndpoint } from "@/lib/mcp-rate-limit";

export const runtime = "nodejs";
// RFC 7009: always answer 200 for unknown tokens.
export async function POST(request: Request) {
  try {
    const params = new URLSearchParams(await readBoundedText(request, 20000));
    limitOAuthEndpoint(request, "mcp-revoke", params.get("client_id") || "", 60);
    const value = params.get("token") || "";
    if (value.startsWith(PAT_PREFIX)) { if (isPatFormat(value)) await getConvexClient().mutation(api.mcp.revokeOwnToken, { token: value }); }
    else revokeMcpToken(value, params.get("client_id") || "");
    return new Response(null, { status: 200, headers: oauthHeaders });
  } catch (error) {
    if (error instanceof TooManyRequests) return Response.json({ error: "temporarily_unavailable" }, { status: 429, headers: { ...oauthHeaders, "Retry-After": "60" } });
    return new Response(null, { status: 400, headers: oauthHeaders });
  } finally { await flushMcpRevocations().catch(() => {}); }
}
export { OPTIONS } from "../register/route";
