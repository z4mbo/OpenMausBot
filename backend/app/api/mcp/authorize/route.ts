import { BodyTooLarge, readBoundedJson } from "@/lib/http-body";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient, requireLocalUser, sessionTokenFromRequest, limitLocalAction } from "@/lib/localRealtime";
import { issueMcpCode, validateMcpAuthorization } from "@/lib/mcp-oauth";
import { originUrl } from "@/lib/integration-bridge";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = validateMcpAuthorization(new URL(request.url).searchParams);
    return Response.json({ name: auth.name, domain: new URL(auth.redirect).hostname, write: auth.scope.split(" ").includes("origin:write") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: "Invalid authorization request. Reconnect from your AI app." }, { status: error instanceof BodyTooLarge ? 413 : 400 }); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") && request.headers.get("origin") !== originUrl()) throw new Error("Invalid origin");
    const body = await readBoundedJson(request);
    if (typeof body.query !== "string" || body.query.length > 12000) throw new Error("Invalid request");
    const auth = validateMcpAuthorization(new URLSearchParams(body.query));
    const sessionToken = sessionTokenFromRequest(request);
    const user = await requireLocalUser(sessionToken);
    limitLocalAction(`mcp-consent:${user._id}`, 10, 60000);
    if (body.allow === false) {
      const target = new URL(auth.redirect); target.searchParams.set("error", "access_denied"); target.searchParams.set("iss", originUrl()); if (auth.state) target.searchParams.set("state", auth.state);
      return Response.json({ url: target.toString() });
    }
    if (body.allow !== true || typeof body.teamId !== "string") throw new Error("Choose a workspace");
    const grant = await getConvexClient().mutation(api.connectors.createGrant, { sessionToken, teamId: body.teamId as Id<"teams">, name: `${auth.name} (${new URL(auth.redirect).hostname})`, write: auth.scope.split(" ").includes("origin:write") });
    return Response.json({ url: issueMcpCode(auth, grant.token, grant.expiresAt) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: "Could not authorize this connection. Check your workspace permissions and try again." }, { status: error instanceof BodyTooLarge ? 413 : 400 }); }
}
