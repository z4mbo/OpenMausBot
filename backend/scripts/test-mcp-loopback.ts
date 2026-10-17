import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerMcpClient, validateMcpAuthorization, mcpResource } from "../lib/mcp-oauth";

const directory = mkdtempSync(path.join(tmpdir(), "origin-mcp-redirect-"));
Object.assign(process.env, { NODE_ENV: "production", ORIGIN_LOCAL_DATA_DIR: directory, ORIGIN_PUBLIC_URL: "https://origin.example.test" });
try {
  for (const uri of ["http://127.0.0.1:56789/callback", "http://[::1]:56789/callback", "https://claude.ai/api/mcp/auth_callback"]) {
    const client = registerMcpClient({ client_name: "Redirect QA", redirect_uris: [uri], token_endpoint_auth_method: "none" });
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: uri, response_type: "code", code_challenge_method: "S256", code_challenge: "x".repeat(43), resource: mcpResource() });
    assert.equal(validateMcpAuthorization(params).redirect, uri);
    params.set("redirect_uri", uri.replace("callback", "other"));
    assert.throws(() => validateMcpAuthorization(params), /redirect URI/);
  }
  for (const uri of ["http://example.test/callback", "http://127.0.0.1.evil.test/callback", "http://192.168.1.1/callback", "http://localhost:56789/callback", "http://127.0.0.1:56789/callback#fragment", "https://user:password@example.test/callback"]) {
    assert.throws(() => registerMcpClient({ redirect_uris: [uri], token_endpoint_auth_method: "none" }), /redirect URI/);
  }
  console.log("PASS native loopback redirects in production, exact callback binding, HTTPS clients and unsafe redirect rejection");
} finally { rmSync(directory, { recursive: true, force: true }); }
