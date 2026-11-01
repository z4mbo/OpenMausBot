import { expect, test } from "vitest";
import { originCsp } from "./origin-csp";

test("CSP permits only the app, Convex and its HTTP-action origin, plus necessary blob/data capabilities", () => {
  const policy = originCsp({ ORIGIN_PUBLIC_URL: "https://origin.example", NEXT_PUBLIC_CONVEX_URL: "https://deployment.convex.cloud", NEXT_PUBLIC_CONVEX_SITE_URL: "https://deployment.convex.site" });
  expect(policy).toContain("wss://deployment.convex.cloud");
  expect(policy).toContain("connect-src 'self' https://origin.example https://deployment.convex.cloud https://deployment.convex.site");
  expect(policy).toContain("worker-src 'self' blob:");
  expect(policy).toContain("object-src 'none'");
  expect(policy).not.toContain("localhost");
  const scripts = policy.split(";").find(value => value.trim().startsWith("script-src "))!;
  expect(scripts).not.toContain("'unsafe-eval'"); expect(scripts).not.toContain("'unsafe-inline'");
  expect(scripts).not.toContain("https:"); expect(scripts).not.toContain("data:");
  expect(() => originCsp({ ORIGIN_CSP_CONNECT_ORIGINS: "https://ok.test; script-src *" })).toThrow();
  expect(() => originCsp({ ORIGIN_PUBLIC_URL: "https://user:secret@example.test" })).toThrow();
});

test("the upload origin is derived from a Convex cloud URL and ORIGIN_URL is a fallback", () => {
  const policy = originCsp({ ORIGIN_URL: "https://legacy.example", NEXT_PUBLIC_CONVEX_URL: "https://wry-fly.eu-west-1.convex.cloud" });
  expect(policy).toContain("connect-src 'self' https://legacy.example https://wry-fly.eu-west-1.convex.cloud https://wry-fly.eu-west-1.convex.site");
  expect(originCsp({ ORIGIN_PUBLIC_URL: "https://new.example", ORIGIN_URL: "https://legacy.example" })).not.toContain("legacy.example");
});

test("only the development server may evaluate scripts", () => {
  for (const NODE_ENV of ["development", "production", "test"]) {
    const scripts = originCsp({ NODE_ENV }, "fixture-nonce").split(";").find(value => value.trim().startsWith("script-src "))!;
    expect(scripts.includes("'unsafe-eval'")).toBe(NODE_ENV === "development");
    expect(scripts).toContain("'nonce-fixture-nonce'");
  }
});
