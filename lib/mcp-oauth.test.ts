import { expect, test } from "vitest";
import { parseScope, redirectMatches, validRedirect } from "./mcp-oauth";

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
