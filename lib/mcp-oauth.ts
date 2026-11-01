import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuthClientMetadataSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { api } from "@/convex/_generated/api";
import { integrationDb, openIntegration, sealIntegration } from "./githubConnection";
import { originUrl } from "./integration-bridge";
import { getConvexClient } from "./localRealtime";

// OAuth 2.1 authorization server for the MCP endpoint: dynamic client registration (public clients only),
// authorization code + PKCE S256, rotating refresh tokens with reuse detection, RFC 7009 revocation.
// Codes and tokens are stored as SHA-256 hashes; each grant seals the Convex connector token it maps to.
// Every grant revoked here is queued in mcp_revocations and revoked in Convex by flushMcpRevocations(), so
// Settings > Agents and the Convex grant limit never count a grant that SQLite no longer honours.

const token = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const mcpResource = () => `${originUrl()}/api/mcp`;
export const mcpResourceMetadata = () => `${originUrl()}/.well-known/oauth-protected-resource/api/mcp`;
export const mcpScopes = ["origin:read", "origin:write"];
export const oauthHeaders = { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" };
const ACCESS_TTL = 3600000;
const CODE_TTL = 5 * 60000;
/** Registered clients that never obtained a grant are deleted after this long. */
export const UNUSED_CLIENT_TTL = 86400000;
type Client = { id: string; name: string; redirects: string; created: number };
type Grant = { id: string; client: string; encrypted: string; scope: string; resource: string; expires: number; revoked: number };
export type OAuthRequest = { clientId: string; name: string; redirect: string; challenge: string; state: string; resource: string; scope: string };
type StoredToken = { hash: string; grant_id: string; kind: string; expires: number; used: number; scope: string | null };
type StoredCode = { hash: string; grant_id: string; redirect: string; challenge: string; expires: number; used: number };

export class OAuthError extends Error {
  constructor(readonly code: string, description?: string) { super(description || code); }
}

let ready = false;
function db() {
  const database = integrationDb();
  if (!ready) {
    database.exec(`CREATE TABLE IF NOT EXISTS mcp_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS mcp_clients_metadata ON mcp_clients(name, redirects);
      CREATE TABLE IF NOT EXISTS mcp_grants (id TEXT PRIMARY KEY, client TEXT NOT NULL, encrypted TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS mcp_codes (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_tokens (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS mcp_tokens_grant ON mcp_tokens(grant_id);
      CREATE TABLE IF NOT EXISTS mcp_revocations (grant_id TEXT PRIMARY KEY, encrypted TEXT NOT NULL, created INTEGER NOT NULL);`);
    // Columns added after the first release: used-code tombstones and per-token (narrowed) scope.
    const columns = (table: string) => (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name);
    if (!columns("mcp_codes").includes("used")) database.exec("ALTER TABLE mcp_codes ADD COLUMN used INTEGER NOT NULL DEFAULT 0");
    if (!columns("mcp_tokens").includes("scope")) database.exec("ALTER TABLE mcp_tokens ADD COLUMN scope TEXT");
    ready = true;
  }
  return database;
}

/** Marks a grant revoked, drops its tokens and queues the Convex grant for revocation. Call inside a transaction. */
function revokeGrant(id: string) {
  const database = db();
  const grant = database.prepare("SELECT id,encrypted,revoked FROM mcp_grants WHERE id=?").get(id) as Pick<Grant, "id" | "encrypted" | "revoked"> | undefined;
  if (grant && !grant.revoked) database.prepare("INSERT INTO mcp_revocations VALUES(?,?,?) ON CONFLICT(grant_id) DO NOTHING").run(grant.id, grant.encrypted, Date.now());
  database.prepare("UPDATE mcp_grants SET revoked=1 WHERE id=?").run(id);
  database.prepare("DELETE FROM mcp_tokens WHERE grant_id=?").run(id);
}

function transaction<T>(run: () => T): T {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try { const result = run(); database.exec("COMMIT"); return result; }
  catch (error) { if (database.isTransaction) database.exec("ROLLBACK"); throw error; }
}

export function cleanup(now = Date.now()) {
  transaction(() => {
    const database = db();
    // A code that expired without being exchanged leaves a grant nobody can use.
    for (const row of database.prepare("SELECT grant_id FROM mcp_codes WHERE expires<? AND used=0").all(now) as { grant_id: string }[]) revokeGrant(row.grant_id);
    database.prepare("DELETE FROM mcp_codes WHERE expires<?").run(now);
    database.prepare("DELETE FROM mcp_tokens WHERE expires<?").run(now);
    database.prepare("DELETE FROM mcp_tokens WHERE grant_id IN (SELECT id FROM mcp_grants WHERE expires<? OR revoked=1)").run(now);
    database.prepare("DELETE FROM mcp_grants WHERE (expires<? OR revoked=1) AND id NOT IN (SELECT grant_id FROM mcp_codes)").run(now);
    database.prepare("DELETE FROM mcp_clients WHERE created<? AND id NOT IN (SELECT client FROM mcp_grants)").run(now - UNUSED_CLIENT_TTL);
  });
}

/** Revokes queued grants in Convex; failures stay queued for the next call. */
export async function flushMcpRevocations(revoke: (connectorToken: string) => Promise<unknown> = connectorToken => getConvexClient().mutation(api.mcp.revokeOwnToken, { token: connectorToken })) {
  const rows = db().prepare("SELECT grant_id,encrypted FROM mcp_revocations ORDER BY created LIMIT 50").all() as { grant_id: string; encrypted: string }[];
  for (const row of rows) {
    let connectorToken: string | null = null;
    try { connectorToken = openIntegration(row.encrypted, `mcp:${row.grant_id}`); } catch { /* key material lost: nothing left to revoke */ }
    try {
      if (connectorToken) await revoke(connectorToken);
      db().prepare("DELETE FROM mcp_revocations WHERE grant_id=?").run(row.grant_id);
    } catch { /* Convex unavailable: retry later */ }
  }
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

export class InvalidClientMetadata extends Error {
  constructor(readonly code: "invalid_redirect_uri" | "invalid_client_metadata", description: string) { super(description); }
}

/**
 * RFC 7591 registration. An identical registration (same name and redirect URIs) returns the existing client and
 * keeps it alive; `limit` runs only before a new client is stored and throws to refuse it.
 */
export function registerMcpClient(input: unknown, limit: () => void = () => {}) {
  cleanup();
  const parsed = OAuthClientMetadataSchema.safeParse(input);
  if (!parsed.success) throw new InvalidClientMetadata("invalid_client_metadata", "Invalid client metadata");
  const data = parsed.data;
  if (data.token_endpoint_auth_method && data.token_endpoint_auth_method !== "none") throw new InvalidClientMetadata("invalid_client_metadata", "Only public clients are supported (token_endpoint_auth_method: none)");
  if (!data.redirect_uris.length || data.redirect_uris.length > 10 || data.redirect_uris.some(uri => uri.length > 2000 || !validRedirect(uri))) throw new InvalidClientMetadata("invalid_redirect_uri", "Use HTTPS or loopback redirect URIs");
  if (data.grant_types?.some(value => !["authorization_code", "refresh_token"].includes(value)) || data.response_types?.some(value => value !== "code")) throw new InvalidClientMetadata("invalid_client_metadata", "Only authorization_code and refresh_token are supported");
  const name = (data.client_name || new URL(data.redirect_uris[0]).hostname).slice(0, 100);
  const redirects = JSON.stringify(data.redirect_uris);
  const now = Date.now();
  const existing = db().prepare("SELECT id,created FROM mcp_clients WHERE name=? AND redirects=? ORDER BY created DESC LIMIT 1").get(name, redirects) as Pick<Client, "id" | "created"> | undefined;
  let id: string;
  if (existing) {
    id = existing.id;
    db().prepare("UPDATE mcp_clients SET created=? WHERE id=?").run(now, id);
  } else {
    limit();
    id = token();
    db().prepare("INSERT INTO mcp_clients VALUES(?,?,?,?)").run(id, name, redirects, now);
  }
  return { client_id: id, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: data.redirect_uris,
    token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: mcpScopes.join(" ") };
}
export function mcpClientExists(id: string) {
  return Boolean(id) && Boolean(db().prepare("SELECT id FROM mcp_clients WHERE id=?").get(id));
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
  transaction(() => {
    db().prepare("INSERT INTO mcp_grants VALUES(?,?,?,?,?,?,0)").run(grantId, request.clientId, sealIntegration(connectorToken, `mcp:${grantId}`), scope, request.resource, expires);
    db().prepare("INSERT INTO mcp_codes(hash,grant_id,redirect,challenge,expires) VALUES(?,?,?,?,?)").run(hash(code), grantId, request.redirect, request.challenge, Date.now() + CODE_TTL);
  });
  const url = new URL(request.redirect); url.searchParams.set("code", code); url.searchParams.set("iss", originUrl());
  if (request.state) url.searchParams.set("state", request.state);
  return url.toString();
}
function activeGrant(id: string, client?: string) {
  const grant = db().prepare("SELECT * FROM mcp_grants WHERE id=?").get(id) as Grant | undefined;
  if (!grant || grant.revoked || grant.expires <= Date.now() || (client !== undefined && grant.client !== client)) return null;
  return grant;
}
const scopeList = (scope: string) => scope.split(" ").filter(Boolean);
function mintTokens(grant: Grant, scope: string) {
  const access = token(), refresh = token();
  const expires = Math.min(Date.now() + ACCESS_TTL, grant.expires);
  const insert = db().prepare("INSERT INTO mcp_tokens(hash,grant_id,kind,expires,used,scope) VALUES(?,?,?,?,0,?)");
  insert.run(hash(access), grant.id, "access", expires, scope); insert.run(hash(refresh), grant.id, "refresh", grant.expires, scope);
  return { access_token: access, token_type: "Bearer", expires_in: Math.max(1, Math.floor((expires - Date.now()) / 1000)), refresh_token: refresh, scope };
}

type Outcome = { tokens: ReturnType<typeof mintTokens> } | { error: OAuthError };
function exchangeCode(params: URLSearchParams, client: string): Outcome {
  const codeHash = hash(params.get("code") || "");
  const row = db().prepare("SELECT * FROM mcp_codes WHERE hash=?").get(codeHash) as StoredCode | undefined;
  if (!row) return { error: new OAuthError("invalid_grant") };
  // A code is single use. A second use revokes everything issued from it (OAuth 2.1 section 4.1.3); the used row
  // stays as a tombstone until it expires.
  if (row.used) { revokeGrant(row.grant_id); return { error: new OAuthError("invalid_grant", "Authorization code already used") }; }
  db().prepare("UPDATE mcp_codes SET used=1 WHERE hash=?").run(codeHash);
  const grant = activeGrant(row.grant_id, client);
  // Any failure from here on leaves a grant that can never be used: revoke it.
  const fail = (description?: string) => { revokeGrant(row.grant_id); return { error: new OAuthError("invalid_grant", description) }; };
  if (!grant || row.expires <= Date.now() || row.redirect !== params.get("redirect_uri")) return fail();
  const verifier = params.get("code_verifier") || "";
  const actual = /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ? createHash("sha256").update(verifier).digest("base64url") : "";
  if (actual.length !== row.challenge.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(row.challenge))) return fail("PKCE verification failed");
  return { tokens: mintTokens(grant, grant.scope) };
}
function exchangeRefresh(params: URLSearchParams, client: string): Outcome {
  const refreshHash = hash(params.get("refresh_token") || "");
  const row = db().prepare("SELECT * FROM mcp_tokens WHERE hash=? AND kind='refresh'").get(refreshHash) as StoredToken | undefined;
  if (!row || row.expires <= Date.now()) return { error: new OAuthError("invalid_grant") };
  const grant = activeGrant(row.grant_id, client);
  if (!grant) return { error: new OAuthError("invalid_grant") };
  if (row.used) { revokeGrant(grant.id); return { error: new OAuthError("invalid_grant", "Refresh token reused") }; }
  const current = scopeList(row.scope ?? grant.scope);
  let scope = current.join(" ");
  if (params.has("scope")) {
    let requested: string;
    try { requested = parseScope(params.get("scope")); } catch (error) { return { error: error as OAuthError }; }
    if (scopeList(requested).some(s => !current.includes(s))) return { error: new OAuthError("invalid_scope") };
    scope = requested;
  }
  db().prepare("UPDATE mcp_tokens SET used=1 WHERE hash=?").run(refreshHash);
  return { tokens: mintTokens(grant, scope) };
}
/** Token endpoint. Throws OAuthError; call flushMcpRevocations() afterwards either way. */
export function exchangeMcpToken(params: URLSearchParams) {
  cleanup();
  const client = params.get("client_id") || "";
  if (!mcpClientExists(client)) throw new OAuthError("invalid_client");
  if (!resourceMatches(params.get("resource"))) throw new OAuthError("invalid_target");
  const grantType = params.get("grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") throw new OAuthError("unsupported_grant_type");
  // Revocations commit even when the request fails.
  const outcome = transaction(() => grantType === "authorization_code" ? exchangeCode(params, client) : exchangeRefresh(params, client));
  if ("error" in outcome) throw outcome.error;
  return outcome.tokens;
}
export function resolveMcpToken(access: string) {
  const row = db().prepare("SELECT * FROM mcp_tokens WHERE hash=? AND kind='access'").get(hash(access)) as StoredToken | undefined;
  if (!row || row.expires <= Date.now()) throw new OAuthError("invalid_token");
  const grant = activeGrant(row.grant_id);
  if (!grant || grant.resource !== mcpResource()) throw new OAuthError("invalid_token");
  return { connectorToken: openIntegration(grant.encrypted, `mcp:${grant.id}`), write: scopeList(row.scope ?? grant.scope).includes("origin:write"), grantId: grant.id };
}
/** Revokes the whole grant behind an access or refresh token (queued for Convex). Unknown tokens are ignored. */
export function revokeMcpToken(value: string, clientId: string) {
  const row = db().prepare("SELECT grant_id FROM mcp_tokens WHERE hash=?").get(hash(value)) as { grant_id: string } | undefined;
  const grant = row ? db().prepare("SELECT * FROM mcp_grants WHERE id=?").get(row.grant_id) as Grant | undefined : undefined;
  if (!grant || (clientId && grant.client !== clientId)) return false;
  transaction(() => revokeGrant(grant.id));
  return true;
}
