import { api } from "@/convex/_generated/api";
import { revokeMcpToken, oauthHeaders } from "@/lib/mcp-oauth";
import { getConvexClient, limitLocalAction } from "@/lib/localRealtime";
import { readBoundedText } from "@/lib/http-body";
import { PAT_PREFIX } from "@/lib/mcp-tokens";

export const runtime = "nodejs";
// RFC 7009: always answer 200 for unknown tokens.
export async function POST(request: Request) {
  try {
    limitLocalAction(`mcp-revoke:${request.headers.get("x-real-ip") || "unknown"}`, 60, 60000);
    const params = new URLSearchParams(await readBoundedText(request, 20000));
    const value = params.get("token") || "";
    const connectorToken = value.startsWith(PAT_PREFIX) ? value : revokeMcpToken(value, params.get("client_id") || "");
    if (connectorToken) await getConvexClient().mutation(api.mcp.revokeOwnToken, { token: connectorToken });
    return new Response(null, { status: 200, headers: oauthHeaders });
  } catch { return new Response(null, { status: 400, headers: oauthHeaders }); }
}
export { OPTIONS } from "../register/route";
