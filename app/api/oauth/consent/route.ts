import { BodyTooLarge, readBoundedJson } from "@/lib/http-body";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexClient, requireLocalUser, sessionTokenFromRequest, limitLocalAction } from "@/lib/localRealtime";
import { authorizationError, issueMcpCode, OAuthError, validateMcpAuthorization, validateMcpClient } from "@/lib/mcp-oauth";
import { originUrl } from "@/lib/integration-bridge";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

function describe(redirect: string) {
  const url = new URL(redirect);
  return url.protocol === "http:" ? "This computer" : url.hostname;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const auth = validateMcpAuthorization(params);
    return Response.json({ name: auth.name, domain: describe(auth.redirect), write: auth.scope.split(" ").includes("origin:write") }, { headers: noStore });
  } catch (error) {
    // Once the client and redirect URI are verified, other errors go back to the client (RFC 6749 4.1.2.1).
    try {
      const client = validateMcpClient(params);
      if (error instanceof OAuthError) return Response.json({ redirect: authorizationError({ redirect: client.redirect, state: params.get("state") || "" }, error.code) }, { status: 400, headers: noStore });
    } catch { /* invalid client: show the error here */ }
    return Response.json({ error: "Invalid connection request. Start again from your app." }, { status: 400, headers: noStore });
  }
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
    if (body.allow === false) return Response.json({ url: authorizationError(auth, "access_denied") }, { headers: noStore });
    if (body.allow !== true || typeof body.teamId !== "string") throw new Error("Choose a workspace");
    const write = body.write === true && auth.scope.split(" ").includes("origin:write");
    const grant = await getConvexClient().mutation(api.connectors.createGrant, { sessionToken, teamId: body.teamId as Id<"teams">, name: `${auth.name} (${describe(auth.redirect)})`.slice(0, 120), write });
    return Response.json({ url: issueMcpCode(auth, grant.token, grant.expiresAt, write) }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: "Could not connect. Check your workspace access and try again." }, { status: error instanceof BodyTooLarge ? 413 : 400, headers: noStore });
  }
}
