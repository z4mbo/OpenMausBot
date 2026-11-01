import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { integrationDb, openIntegration, sealIntegration } from "./githubConnection";
import { originUrl } from "./integration-bridge";

// OAuth 2.1 authorization server for the MCP endpoint: dynamic client registration (public clients only),
// authorization code + PKCE S256, rotating refresh tokens with reuse detection, RFC 7009 revocation.
// Codes and tokens are stored as SHA-256 hashes; each grant seals the Convex connector token it maps to.

const token = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const mcpResource = () => `${originUrl()}/api/mcp`;
export const mcpResourceMetadata = () => `${originUrl()}/.well-known/oauth-protected-resource/api/mcp`;
export const mcpScopes = ["origin:read", "origin:write"];
export const oauthHeaders = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
const ACCESS_TTL = 3600000;
type Client = { id: string; name: string; redirects: string };
type Grant = { id: string; client: string; encrypted: string; scope: string; resource: string; expires: number; revoked: number };
export type OAuthRequest = { clientId: string; name: string; redirect: string; challenge: string; state: string; resource: string; scope: string };
type StoredToken = { hash: string; grant_id: string; kind: string; expires: number; used: number };

export class OAuthError extends Error {
  constructor(readonly code: string, description?: string) { super(description || code); }
}

let ready = false;
function db() {
  const database = integrationDb();
  if (!ready) {
    database.exec(`CREATE TABLE IF NOT EXISTS mcp_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_grants (id TEXT PRIMARY KEY, client TEXT NOT NULL, encrypted TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS mcp_codes (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_tokens (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS mcp_tokens_grant ON mcp_tokens(grant_id);`);
    ready = true;
  }
  return database;
}
function cleanup() {
  const database = db(), now = Date.now();
  database.prepare("DELETE FROM mcp_codes WHERE expires<?").run(now);
  database.prepare("DELETE FROM mcp_tokens WHERE expires<?").run(now);
  database.prepare("DELETE FROM mcp_tokens WHERE grant_id IN (SELECT id FROM mcp_grants WHERE expires<? OR revoked=1)").run(now);
  database.prepare("DELETE FROM mcp_grants WHERE expires<? OR revoked=1").run(now);
  database.prepare("DELETE FROM mcp_clients WHERE created<? AND id NOT IN (SELECT client FROM mcp_grants)").run(now - 30 * 86400000);
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
function isLoopback(url: URL) { return url.protocol === "http:" && LOOPBACK.has(url.hostname); }
export function validRedirect(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  // HTTPS, or an http loopback callback for CLI and desktop clients (RFC 8252 section 7.3).
  return !url.hash && !url.username && !url.password && (url.protocol === "https:" || isLoopback(url));
}
/** Exact match, except that loopback callbacks may use any port (RFC 8252 section 7.3). */
export function redirectMatches(registered: string, requested: string) {
  if (registered === requested) return true;
  let a: URL, b: URL;
  try { a = new URL(registered); b = new URL(requested); } catch { return false; }
  if (!isLoopback(a) || !isLoopback(b) || b.hash || b.username || b.password) return false;
  return a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}
function resourceMatches(value: string | null) {
  // RFC 8707: clients should send the resource; accept its absence and a trailing slash.
  return !value || value.replace(/\/$/, "") === mcpResource();
}
export function parseScope(value: string | null) {
  const scopes = [...new Set((value || mcpScopes.join(" ")).split(" ").filter(Boolean))];
  if (scopes.some(s => !mcpScopes.includes(s))) throw new OAuthError("invalid_scope", "Unsupported scope");
  return [...new Set(["origin:read", ...scopes])].join(" ");
}

export function registerMcpClient(input: unknown) {
  cleanup();
  const data = OAuthClientMetadataSchema.parse(input);
  if (data.token_endpoint_auth_method && data.token_endpoint_auth_method !== "none") throw new Error("Only public clients are supported (token_endpoint_auth_method: none)");
  if (!data.redirect_uris.length || data.redirect_uris.length > 10 || data.redirect_uris.some(uri => uri.length > 2000 || !validRedirect(uri))) throw new Error("Invalid redirect URI");
  if (data.grant_types?.some(value => !["authorization_code", "refresh_token"].includes(value)) || data.response_types?.some(value => value !== "code")) throw new Error("Unsupported grant");
  const count = db().prepare("SELECT count(*) AS n FROM mcp_clients").get() as { n: number };
  if (count.n >= 10000) throw new Error("Client registration temporarily unavailable");
  const id = token(); const name = (data.client_name || new URL(data.redirect_uris[0]).hostname).slice(0, 100);
  db().prepare("INSERT INTO mcp_clients VALUES(?,?,?,?)").run(id, name, JSON.stringify(data.redirect_uris), Date.now());
  return { client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: name, redirect_uris: data.redirect_uris,
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: mcpScopes.join(" ") };
}

/** Client and redirect URI checks. Errors here must not redirect (the redirect URI is not trusted yet). */
export function validateMcpClient(params: URLSearchParams) {
  const clientId = params.get("client_id") || "";
  const client = db().prepare("SELECT id,name,redirects FROM mcp_clients WHERE id=?").get(clientId) as Client | undefined;
  const redirect = params.get("redirect_uri") || "";
  if (!client || !(JSON.parse(client.redirects) as string[]).some(uri => redirectMatches(uri, redirect))) throw new OAuthError("invalid_client", "Unknown client or redirect URI");
  return { clientId, name: client.name, redirect };
}
export function validateMcpAuthorization(params: URLSearchParams): OAuthRequest {
  const { clientId, name, redirect } = validateMcpClient(params);
  const state = params.get("state") || "";
  if (state.length > 2000) throw new OAuthError("invalid_request", "State too long");
  if (params.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "Use response_type=code");
  const challenge = params.get("code_challenge") || "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new OAuthError("invalid_request", "PKCE with S256 is required");
  if (!resourceMatches(params.get("resource"))) throw new OAuthError("invalid_target", "Unknown resource");
  return { clientId, name, redirect, challenge, state, scope: parseScope(params.get("scope")), resource: mcpResource() };
}
export function authorizationError(request: Pick<OAuthRequest, "redirect" | "state">, error: string) {
  const target = new URL(request.redirect); target.searchParams.set("error", error); target.searchParams.set("iss", originUrl());
  if (request.state) target.searchParams.set("state", request.state);
  return target.toString();
}
export function issueMcpCode(request: OAuthRequest, connectorToken: string, expires: number, write: boolean) {
  const grantId = token(), code = token();
  const scope = write ? "origin:read origin:write" : "origin:read";
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO mcp_grants VALUES(?,?,?,?,?,?,0)").run(grantId, request.clientId, sealIntegration(connectorToken, `mcp:${grantId}`), scope, request.resource, expires);
    database.prepare("INSERT INTO mcp_codes VALUES(?,?,?,?,?)").run(hash(code), grantId, request.redirect, request.challenge, Date.now() + 5 * 60000);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  const url = new URL(request.redirect); url.searchParams.set("code", code); url.searchParams.set("iss", originUrl());
  if (request.state) url.searchParams.set("state", request.state);
  return url.toString();
}
function activeGrant(id: string, client?: string) {
  const grant = db().prepare("SELECT * FROM mcp_grants WHERE id=?").get(id) as Grant | undefined;
  if (!grant || grant.revoked || grant.expires <= Date.now() || (client !== undefined && grant.client !== client)) throw new OAuthError("invalid_grant");
  return grant;
}
function mintTokens(grant: Grant) {
  const access = token(), refresh = token();
  const expires = Math.min(Date.now() + ACCESS_TTL, grant.expires);
  const insert = db().prepare("INSERT INTO mcp_tokens VALUES(?,?,?,?,0)");
  insert.run(hash(access), grant.id, "access", expires); insert.run(hash(refresh), grant.id, "refresh", grant.expires);
  return { access_token: access, token_type: "Bearer", expires_in: Math.max(1, Math.floor((expires - Date.now()) / 1000)), refresh_token: refresh, scope: grant.scope };
}
function revokeGrant(id: string) {
  db().prepare("UPDATE mcp_grants SET revoked=1 WHERE id=?").run(id);
  db().prepare("DELETE FROM mcp_tokens WHERE grant_id=?").run(id);
}
export function exchangeMcpToken(params: URLSearchParams) {
  cleanup();
  const client = params.get("client_id") || "";
  if (!client || !db().prepare("SELECT id FROM mcp_clients WHERE id=?").get(client)) throw new OAuthError("invalid_client");
  if (!resourceMatches(params.get("resource"))) throw new OAuthError("invalid_target");
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    if (params.get("grant_type") === "authorization_code") {
      const codeHash = hash(params.get("code") || "");
      const row = database.prepare("SELECT * FROM mcp_codes WHERE hash=?").get(codeHash) as { grant_id: string; redirect: string; challenge: string; expires: number } | undefined;
      if (!row) throw new OAuthError("invalid_grant");
      // A code is single use: consume it before any other check.
      database.prepare("DELETE FROM mcp_codes WHERE hash=?").run(codeHash);
      database.exec("COMMIT"); database.exec("BEGIN IMMEDIATE");
      if (row.expires <= Date.now() || row.redirect !== params.get("redirect_uri")) throw new OAuthError("invalid_grant");
      const grant = activeGrant(row.grant_id, client);
      const verifier = params.get("code_verifier") || "";
      const actual = /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ? createHash("sha256").update(verifier).digest("base64url") : "";
      if (actual.length !== row.challenge.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(row.challenge))) { revokeGrant(grant.id); database.exec("COMMIT"); throw new OAuthError("invalid_grant", "PKCE verification failed"); }
      const tokens = mintTokens(grant); database.exec("COMMIT"); return tokens;
    }
    if (params.get("grant_type") !== "refresh_token") throw new OAuthError("unsupported_grant_type");
    const refreshHash = hash(params.get("refresh_token") || "");
    const row = database.prepare("SELECT * FROM mcp_tokens WHERE hash=? AND kind='refresh'").get(refreshHash) as StoredToken | undefined;
    if (!row || row.expires <= Date.now()) throw new OAuthError("invalid_grant");
    const grant = activeGrant(row.grant_id, client);
    if (row.used) { revokeGrant(grant.id); database.exec("COMMIT"); throw new OAuthError("invalid_grant", "Refresh token reused"); }
    if (params.has("scope") && parseScope(params.get("scope")).split(" ").some(s => !grant.scope.split(" ").includes(s))) throw new OAuthError("invalid_scope");
    database.prepare("UPDATE mcp_tokens SET used=1 WHERE hash=?").run(refreshHash);
    const tokens = mintTokens(grant); database.exec("COMMIT"); return tokens;
  } catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
}
export function resolveMcpToken(access: string) {
  const row = db().prepare("SELECT * FROM mcp_tokens WHERE hash=? AND kind='access'").get(hash(access)) as StoredToken | undefined;
  if (!row || row.expires <= Date.now()) throw new OAuthError("invalid_token");
  const grant = activeGrant(row.grant_id);
  if (grant.resource !== mcpResource()) throw new OAuthError("invalid_token");
  return { connectorToken: openIntegration(grant.encrypted, `mcp:${grant.id}`), write: grant.scope.split(" ").includes("origin:write"), grantId: grant.id };
}
/** Revokes the whole grant behind an access or refresh token and returns its connector token, if any. */
export function revokeMcpToken(value: string, clientId: string) {
  const row = db().prepare("SELECT grant_id FROM mcp_tokens WHERE hash=?").get(hash(value)) as { grant_id: string } | undefined;
  const grant = row ? db().prepare("SELECT * FROM mcp_grants WHERE id=?").get(row.grant_id) as Grant | undefined : undefined;
  if (!grant || (clientId && grant.client !== clientId)) return null;
  revokeGrant(grant.id);
  try { return openIntegration(grant.encrypted, `mcp:${grant.id}`); } catch { return null; }
}
