import { mcpResource, mcpScopes, oauthHeaders } from "@/lib/mcp-oauth";
import { originUrl } from "@/lib/integration-bridge";
export const runtime = "nodejs";
export async function GET() { return Response.json({ resource: mcpResource(), authorization_servers: [originUrl()], scopes_supported: mcpScopes, bearer_methods_supported: ["header"], resource_name: "Origin" }, { headers: oauthHeaders }); }
