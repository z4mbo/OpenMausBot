import { clientAddress } from "./client-address";
import { limitLocalAction, localLimitReached } from "./localRealtime";
import { mcpClientExists } from "./mcp-oauth";

/** OAuth endpoints: per client address behind a trusted proxy; otherwise per registered client, plus one bucket for unknown ids. */
export function limitOAuthEndpoint(request: Request, endpoint: string, clientId: string, maximum: number) {
  const address = clientAddress(request);
  if (address) return limitLocalAction(`${endpoint}:ip:${address}`, maximum, 60000);
  if (mcpClientExists(clientId)) return limitLocalAction(`${endpoint}:client:${clientId}`, maximum, 60000);
  limitLocalAction(`${endpoint}:unknown-client`, maximum * 3, 60000);
}

// Failed MCP authentication: per client address behind a trusted proxy, otherwise one bucket for the endpoint.
const FAILURES_PER_ADDRESS = 20, FAILURES_TOTAL = 120;
const failureKey = (request: Request) => {
  const address = clientAddress(request);
  return address ? { key: `mcp-auth-fail:ip:${address}`, maximum: FAILURES_PER_ADDRESS } : { key: "mcp-auth-fail", maximum: FAILURES_TOTAL };
};
export function mcpAuthBlocked(request: Request) {
  const { key, maximum } = failureKey(request);
  return localLimitReached(key, maximum);
}
export function recordMcpAuthFailure(request: Request) {
  const { key, maximum } = failureKey(request);
  try { limitLocalAction(key, maximum, 60000); } catch { /* already over the limit */ }
}
