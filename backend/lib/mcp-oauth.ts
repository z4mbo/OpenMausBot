import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { integrationDb, openIntegration, sealIntegration } from "./githubConnection";
import { originUrl } from "./integration-bridge";

const token = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const mcpResource = () => `${originUrl()}/api/mcp`;
export const mcpScopes = ["origin:read", "origin:write"];
export const oauthHeaders = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
type Client = { id: string; name: string; redirects: string };
type Grant = { id: string; client: string; encrypted: string; scope: string; resource: string; expires: number; revoked: number };
type OAuthRequest = { clientId: string; name: string; redirect: string; challenge: string; state: string; resource: string; scope: string };
type StoredToken = { hash: string; grant_id: string; kind: string; expires: number; used: number };

function db() {
  const database = integrationDb();
  database.exec(`CREATE TABLE IF NOT EXISTS mcp_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mcp_grants (id TEXT PRIMARY KEY, client TEXT NOT NULL, encrypted TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS mcp_codes (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mcp_tokens (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS mcp_tokens_grant ON mcp_tokens(grant_id);`);
  return database;
}
function cleanup() {
  const database = db();
  database.prepare("DELETE FROM mcp_codes WHERE expires<?").run(Date.now());
  database.prepare("DELETE FROM mcp_tokens WHERE expires<?").run(Date.now());
  database.prepare("DELETE FROM mcp_grants WHERE expires<?").run(Date.now());
  database.prepare("DELETE FROM mcp_clients WHERE created<? AND id NOT IN (SELECT client FROM mcp_grants)").run(Date.now() - 7 * 86400000);
}
function validRedirect(value: string) {
  const url = new URL(value);
  // Native MCP clients use loopback callbacks (RFC 8252); PKCE and exact URI matching still apply.
  const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname) || (process.env.NODE_ENV !== "production" && url.hostname === "localhost");
  return !url.hash && !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && loopback));
}
export function registerMcpClient(input: unknown) {
  cleanup();
  const data = OAuthClientMetadataSchema.parse(input);
  if (data.token_endpoint_auth_method && data.token_endpoint_auth_method !== "none") throw new Error("Only public clients with PKCE are supported (token_endpoint_auth_method: none)");
  if (data.redirect_uris.length > 10 || data.redirect_uris.some(uri => uri.length > 2000 || !validRedirect(uri))) throw new Error("Invalid redirect URI");
  if (data.grant_types?.some(value => !["authorization_code", "refresh_token"].includes(value)) || data.response_types?.some(value => value !== "code")) throw new Error("Unsupported grant");
  const count = db().prepare("SELECT count(*) AS n FROM mcp_clients").get() as { n: number };
  if (count.n >= 10000) throw new Error("Client registration temporarily unavailable");
  const id = token(); const name = (data.client_name || new URL(data.redirect_uris[0]).hostname).slice(0, 100);
  db().prepare("INSERT INTO mcp_clients VALUES(?,?,?,?)").run(id, name, JSON.stringify(data.redirect_uris), Date.now());
  return { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: data.redirect_uris,
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: mcpScopes.join(" ") };
}
export function validateMcpAuthorization(params: URLSearchParams): OAuthRequest {
  const clientId = params.get("client_id") || "";
  const client = db().prepare("SELECT id,name,redirects FROM mcp_clients WHERE id=?").get(clientId) as Client | undefined;
  const redirect = params.get("redirect_uri") || "";
  if (!client || !(JSON.parse(client.redirects) as string[]).includes(redirect)) throw new Error("Unregistered client or redirect URI");
  if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256") throw new Error("Authorization code with S256 PKCE required");
  const challenge = params.get("code_challenge") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error("Invalid PKCE challenge");
  if (params.get("resource") !== mcpResource()) throw new Error("Invalid resource");
  const scopes = [...new Set((params.get("scope") || "origin:read").split(" ").filter(Boolean))];
  if (!scopes.includes("origin:read") || scopes.some(s => !mcpScopes.includes(s))) throw new Error("Unsupported scope");
  const state = params.get("state") || "";
  if (state.length > 2000) throw new Error("State too long");
  return { clientId, name: client.name, redirect, challenge, state, scope: scopes.join(" "), resource: mcpResource() };
}
export function issueMcpCode(request: OAuthRequest, connectorToken: string, expires: number) {
  const grantId = token(), code = token();
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO mcp_grants VALUES(?,?,?,?,?,?,0)").run(grantId, request.clientId, sealIntegration(connectorToken, `mcp:${grantId}`), request.scope, request.resource, expires);
    database.prepare("INSERT INTO mcp_codes VALUES(?,?,?,?,?)").run(hash(code), grantId, request.redirect, request.challenge, Date.now() + 5 * 60000);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  const url = new URL(request.redirect); url.searchParams.set("code", code); url.searchParams.set("iss", originUrl());
  if (request.state) url.searchParams.set("state", request.state);
  return url.toString();
}
function activeGrant(id: string, client?: string, resource?: string) {
  const grant = db().prepare("SELECT * FROM mcp_grants WHERE id=?").get(id) as Grant | undefined;
  if (!grant || grant.revoked || grant.expires <= Date.now() || (client !== undefined && grant.client !== client) || (resource !== undefined && grant.resource !== resource)) throw new Error("invalid_grant");
  return grant;
}
function mintTokens(grant: Grant) {
  const access = token(), refresh = token();
  const expires = Math.min(Date.now() + 3600000, grant.expires);
  const insert = db().prepare("INSERT INTO mcp_tokens VALUES(?,?,?,?,0)");
  insert.run(hash(access), grant.id, "access", expires); insert.run(hash(refresh), grant.id, "refresh", grant.expires);
  return { access_token: access, token_type: "Bearer", expires_in: Math.max(1, Math.floor((expires - Date.now()) / 1000)), refresh_token: refresh, scope: grant.scope, resource: grant.resource };
}
export function exchangeMcpToken(params: URLSearchParams) {
  cleanup();
  const client = params.get("client_id") || "", resource = params.get("resource") || "";
  if (!client || resource !== mcpResource()) throw new Error("invalid_target");
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    if (params.get("grant_type") === "authorization_code") {
      const codeHash = hash(params.get("code") || "");
      const row = database.prepare("SELECT * FROM mcp_codes WHERE hash=?").get(codeHash) as { grant_id: string; redirect: string; challenge: string; expires: number } | undefined;
      if (!row || row.expires <= Date.now() || row.redirect !== params.get("redirect_uri")) throw new Error("invalid_grant");
      const grant = activeGrant(row.grant_id, client, resource);
      const verifier = params.get("code_verifier") || "";
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error("invalid_grant");
      const actual = createHash("sha256").update(verifier).digest("base64url");
      if (!timingSafeEqual(Buffer.from(actual), Buffer.from(row.challenge))) throw new Error("invalid_grant");
      database.prepare("DELETE FROM mcp_codes WHERE hash=?").run(codeHash);
      const tokens = mintTokens(grant); database.exec("COMMIT"); return tokens;
    }
    if (params.get("grant_type") !== "refresh_token") throw new Error("unsupported_grant_type");
    const refreshHash = hash(params.get("refresh_token") || "");
    const row = database.prepare("SELECT * FROM mcp_tokens WHERE hash=? AND kind='refresh'").get(refreshHash) as StoredToken | undefined;
    if (!row || row.expires <= Date.now()) throw new Error("invalid_grant");
    const grant = activeGrant(row.grant_id, client, resource);
    if (row.used) {
      database.prepare("UPDATE mcp_grants SET revoked=1 WHERE id=?").run(grant.id);
      database.exec("COMMIT"); throw new Error("refresh_token_reused");
    }
    if (params.has("scope") && params.get("scope") !== grant.scope) throw new Error("invalid_scope");
    database.prepare("UPDATE mcp_tokens SET used=1 WHERE hash=?").run(refreshHash);
    const tokens = mintTokens(grant); database.exec("COMMIT"); return tokens;
  } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
}
export function resolveMcpToken(access: string) {
  const row = db().prepare("SELECT * FROM mcp_tokens WHERE hash=? AND kind='access'").get(hash(access)) as StoredToken | undefined;
  if (!row || row.expires <= Date.now()) throw new Error("invalid_token");
  const grant = activeGrant(row.grant_id, undefined, mcpResource());
  return { connectorToken: openIntegration(grant.encrypted, `mcp:${grant.id}`), write: grant.scope.split(" ").includes("origin:write"), grantId: grant.id };
}
export function revokeMcpToken(value: string, clientId: string) {
  const row = db().prepare("SELECT grant_id FROM mcp_tokens WHERE hash=?").get(hash(value)) as { grant_id: string } | undefined;
  if (row) db().prepare("UPDATE mcp_grants SET revoked=1 WHERE id=? AND client=?").run(row.grant_id, clientId);
}
