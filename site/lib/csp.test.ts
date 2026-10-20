import assert from "node:assert/strict";
import { test } from "node:test";
import { siteCsp } from "./csp.ts";

const scriptSources = (policy: string) => policy.split(";").find(value => value.trim().startsWith("script-src "))!;

test("the policy permits only configured connections", () => {
  const policy = siteCsp({ ORIGIN_URL: "https://origin.example", NEXT_PUBLIC_CONVEX_URL: "https://deployment.convex.cloud" }, "fixture-nonce");
  assert.ok(policy.includes("wss://deployment.convex.cloud"));
  assert.ok(policy.includes("connect-src 'self' https://origin.example https://deployment.convex.cloud"));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
  const scripts = scriptSources(policy);
  assert.ok(scripts.includes("'nonce-fixture-nonce'"));
  assert.ok(!scripts.includes("'unsafe-inline'"));
  assert.ok(!scripts.includes("https:"));
  assert.ok(!scripts.includes("data:"));
});

test("malformed destinations and nonces are refused", () => {
  assert.throws(() => siteCsp({ ORIGIN_CSP_CONNECT_ORIGINS: "https://ok.test; script-src *" }, "nonce"));
  assert.throws(() => siteCsp({ ORIGIN_URL: "https://user:secret@example.test" }, "nonce"));
  assert.throws(() => siteCsp({ ORIGIN_URL: "http://example.test" }, "nonce"));
  assert.throws(() => siteCsp({}, "bad nonce'"));
});

test("only the development server may evaluate scripts", () => {
  for (const NODE_ENV of ["development", "production", "test"]) {
    assert.equal(scriptSources(siteCsp({ NODE_ENV }, "nonce")).includes("'unsafe-eval'"), NODE_ENV === "development");
  }
});
