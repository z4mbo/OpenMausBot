import { expect, test } from "vitest";
import { siteCsp } from "./csp";

const scriptSources = (policy: string) => policy.split(";").find(value => value.trim().startsWith("script-src "))!;

test("the policy permits only configured connections", () => {
  const policy = siteCsp({ ORIGIN_URL: "https://origin.example", NEXT_PUBLIC_CONVEX_URL: "https://deployment.convex.cloud" }, "fixture-nonce");
  expect(policy).toContain("wss://deployment.convex.cloud");
  expect(policy).toContain("connect-src 'self' https://origin.example https://deployment.convex.cloud");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-ancestors 'none'");
  const scripts = scriptSources(policy);
  expect(scripts).toContain("'nonce-fixture-nonce'");
  expect(scripts).not.toContain("'unsafe-inline'");
  expect(scripts).not.toContain("https:");
  expect(scripts).not.toContain("data:");
});

test("malformed destinations and nonces are refused", () => {
  expect(() => siteCsp({ ORIGIN_CSP_CONNECT_ORIGINS: "https://ok.test; script-src *" }, "nonce")).toThrow();
  expect(() => siteCsp({ ORIGIN_URL: "https://user:secret@example.test" }, "nonce")).toThrow();
  expect(() => siteCsp({ ORIGIN_URL: "http://example.test" }, "nonce")).toThrow();
  expect(() => siteCsp({}, "bad nonce'")).toThrow();
});

test("only the development server may evaluate scripts", () => {
  for (const NODE_ENV of ["development", "production", "test"]) {
    expect(scriptSources(siteCsp({ NODE_ENV }, "nonce")).includes("'unsafe-eval'")).toBe(NODE_ENV === "development");
  }
});
