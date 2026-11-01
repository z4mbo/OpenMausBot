/** Personal access tokens are Convex connector tokens with this prefix (see convex/mcp.ts createToken). */
export const PAT_PREFIX = "origin_pat_";
/** Connector tokens behind OAuth grants (convex/mcp.ts createOAuthGrant); only the Next server ever holds them. */
export const OAUTH_GRANT_PREFIX = "origin_oauth_";
export const isPatFormat = (value: string) => /^origin_pat_[0-9a-f]{64}$/.test(value);
/** MCP tokens may only use the MCP tools, never the legacy connectors.read/write surface. */
export const isMcpConnectorToken = (value: string) => value.startsWith(PAT_PREFIX) || value.startsWith(OAUTH_GRANT_PREFIX);
