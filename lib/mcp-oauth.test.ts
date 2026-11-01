// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, exchangeMcpToken, flushMcpRevocations, issueMcpCode, OAuthError, parseScope, redirectMatches, registerMcpClient, resolveMcpToken, revokeMcpToken, UNUSED_CLIENT_TTL, validateMcpAuthorization, validRedirect } from "./mcp-oauth";
import { integrationDb } from "./githubConnection";
import { clientAddress } from "./client-address";

test("redirect URIs: HTTPS or loopback only", () => {
  for (const uri of ["https://chatgpt.com/connector_platform_oauth_redirect", "https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:33418/callback", "http://localhost:3000/callback", "http://[::1]:9/cb"]) expect(validRedirect(uri)).toBe(true);
  for (const uri of ["http://example.com/cb", "https://example.com/cb#x", "https://user:pw@example.com/cb", "cursor://callback", "not a url"]) expect(validRedirect(uri)).toBe(false);
});

test("loopback redirects match on any port, everything else exactly", () => {
  expect(redirectMatches("http://127.0.0.1/callback", "http://127.0.0.1:51234/callback")).toBe(true);
  expect(redirectMatches("http://localhost:3000/callback", "http://localhost:4111/callback")).toBe(true);
  expect(redirectMatches("http://localhost:3000/callback", "http://127.0.0.1:3000/callback")).toBe(false);
  expect(redirectMatches("http://127.0.0.1/callback", "http://127.0.0.1:5/other")).toBe(false);
  expect(redirectMatches("https://app.example/cb", "https://app.example:8443/cb")).toBe(false);
  expect(redirectMatches("https://app.example/cb", "https://app.example/cb")).toBe(true);
});

test("scopes default to read and write and always include read", () => {
  expect(parseScope(null)).toBe("origin:read origin:write");
  expect(parseScope("origin:write")).toBe("origin:read origin:write");
  expect(parseScope("origin:read")).toBe("origin:read");
  expect(() => parseScope("admin")).toThrow();
});

// Stateful flows against a temporary SQLite store.

const directory = mkdtempSync(path.join(tmpdir(), "origin-mcp-oauth-"));
process.env.ORIGIN_LOCAL_DATA_DIR = directory;
process.env.ORIGIN_PUBLIC_URL = "http://origin.test";
afterAll(() => { integrationDb().close(); rmSync(directory, { recursive: true, force: true }); });

describe("OAuth flows", () => {
  const redirect = "http://127.0.0.1:9/callback";
  const revoked: string[] = [];
  const flush = () => flushMcpRevocations(async token => { revoked.push(token); });
  beforeEach(async () => {
    vi.useRealTimers();
    await flush(); revoked.length = 0;
    integrationDb().exec("DELETE FROM mcp_clients; DELETE FROM mcp_grants; DELETE FROM mcp_codes; DELETE FROM mcp_tokens; DELETE FROM mcp_revocations");
  });
  const register = (name = "Agent", limit?: () => void) => registerMcpClient({ client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: "none" }, limit);
  function authorize(clientId: string, connectorToken: string, write = true, scope = "origin:read origin:write") {
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", scope });
    const url = new URL(issueMcpCode(validateMcpAuthorization(params), connectorToken, Date.now() + 86400000, write));
    return { verifier, code: url.searchParams.get("code")! };
  }
  const exchange = (clientId: string, code: string, verifier: string) => exchangeMcpToken(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect }));
  const refresh = (clientId: string, token: string, scope?: string) => exchangeMcpToken(new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token, ...(scope ? { scope } : {}) }));
  const oauthError = (run: () => unknown) => { try { run(); } catch (error) { return error instanceof OAuthError ? error.code : String(error); } return "no error"; };

  test("identical registrations reuse the client; only new clients hit the limit", () => {
    let limited = 0;
    const first = register("Agent", () => { limited++; });
    const again = register("Agent", () => { throw new Error("limited"); });
    expect(again.client_id).toBe(first.client_id);
    expect(limited).toBe(1);
    expect(() => register("Other", () => { throw new Error("limited"); })).toThrow("limited");
  });

  test("clients without a grant are deleted after a day", () => {
    const unused = register("Unused").client_id;
    const used = register("Used").client_id;
    authorize(used, "origin_oauth_used");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + UNUSED_CLIENT_TTL + 60000);
    cleanup();
    const ids = (integrationDb().prepare("SELECT id FROM mcp_clients").all() as { id: string }[]).map(row => row.id);
    expect(ids).not.toContain(unused);
  });

  test("code exchange, then a replayed code revokes the tokens issued from it (mirrored to Convex)", async () => {
    const client = register().client_id;
    const { code, verifier } = authorize(client, "origin_oauth_replayed");
    const tokens = exchange(client, code, verifier);
    expect(resolveMcpToken(tokens.access_token).connectorToken).toBe("origin_oauth_replayed");
    expect(oauthError(() => exchange(client, code, verifier))).toBe("invalid_grant");
    expect(() => resolveMcpToken(tokens.access_token)).toThrow();
    await flush();
    expect(revoked).toEqual(["origin_oauth_replayed"]);
  });

  test("a failed PKCE check, an expired code and a reused refresh token all revoke in Convex", async () => {
    const client = register().client_id;
    const pkce = authorize(client, "origin_oauth_pkce");
    expect(oauthError(() => exchange(client, pkce.code, randomBytes(32).toString("base64url")))).toBe("invalid_grant");

    authorize(client, "origin_oauth_expired");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60000);
    cleanup();
    vi.useRealTimers();

    const fresh = authorize(client, "origin_oauth_reused");
    const tokens = exchange(client, fresh.code, fresh.verifier);
    refresh(client, tokens.refresh_token);
    expect(oauthError(() => refresh(client, tokens.refresh_token))).toBe("invalid_grant");
    await flush();
    expect(revoked.sort()).toEqual(["origin_oauth_expired", "origin_oauth_pkce", "origin_oauth_reused"]);
  });

  test("refresh with a narrower scope issues and enforces it", () => {
    const client = register().client_id;
    const { code, verifier } = authorize(client, "origin_oauth_scoped");
    const tokens = exchange(client, code, verifier);
    expect(resolveMcpToken(tokens.access_token).write).toBe(true);
    const narrow = refresh(client, tokens.refresh_token, "origin:read");
    expect(narrow.scope).toBe("origin:read");
    expect(resolveMcpToken(narrow.access_token).write).toBe(false);
    // Narrowed tokens cannot widen again.
    expect(oauthError(() => refresh(client, narrow.refresh_token, "origin:read origin:write"))).toBe("invalid_scope");
    expect(refresh(client, narrow.refresh_token).scope).toBe("origin:read");
  });

  test("revoking a token queues its grant for Convex", async () => {
    const client = register().client_id;
    const { code, verifier } = authorize(client, "origin_oauth_revoked");
    const tokens = exchange(client, code, verifier);
    expect(revokeMcpToken(tokens.refresh_token, "someone-else")).toBe(false);
    expect(revokeMcpToken(tokens.refresh_token, client)).toBe(true);
    expect(() => resolveMcpToken(tokens.access_token)).toThrow();
    await flushMcpRevocations(async () => { throw new Error("Convex down"); });
    await flush();
    expect(revoked).toEqual(["origin_oauth_revoked"]);
  });
});

test("forwarded addresses are trusted only with ORIGIN_TRUSTED_PROXY", () => {
  const request = new Request("http://origin.test", { headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 203.0.113.9" } });
  const forwarded = new Request("http://origin.test", { headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9" } });
  vi.stubEnv("ORIGIN_TRUSTED_PROXY", "");
  expect(clientAddress(request)).toBeNull();
  vi.stubEnv("ORIGIN_TRUSTED_PROXY", "1");
  expect(clientAddress(request)).toBe("203.0.113.7");
  expect(clientAddress(forwarded)).toBe("203.0.113.9");
  vi.unstubAllEnvs();
});
