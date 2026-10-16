import { expect, test } from "vitest";
import { originCsp } from "./origin-csp";

test("renderer CSP permits only configured connections and necessary blob/data capabilities", () => {
  const policy = originCsp({ ORIGIN_URL: "https://origin.example", NEXT_PUBLIC_CONVEX_URL: "https://deployment.convex.cloud" });
  expect(policy).toContain("wss://deployment.convex.cloud");
  expect(policy).toContain("connect-src 'self' https://origin.example https://deployment.convex.cloud");
  expect(policy).toContain("worker-src 'self' blob:");
  expect(policy).toContain("object-src 'none'");
  const scripts = policy.split(";").find(value => value.trim().startsWith("script-src "))!;
  expect(scripts).not.toContain("'unsafe-eval'"); expect(scripts).not.toContain("'unsafe-inline'");
  expect(scripts).not.toContain("https:"); expect(scripts).not.toContain("data:");
  expect(() => originCsp({ ORIGIN_CSP_CONNECT_ORIGINS: "https://ok.test; script-src *" })).toThrow();
  expect(() => originCsp({ ORIGIN_URL: "https://user:secret@example.test" })).toThrow();
});

test("only the Next.js development server may evaluate scripts", () => {
  for (const NODE_ENV of ["development", "production", "test"]) {
    const scripts = (runtime?: "renderer" | "next") => originCsp({ NODE_ENV }, "fixture-nonce", runtime).split(";").find(value => value.trim().startsWith("script-src "))!;
    expect(scripts()).not.toContain("'unsafe-eval'");
    expect(scripts("renderer")).not.toContain("'unsafe-eval'");
    expect(scripts("next").includes("'unsafe-eval'")).toBe(NODE_ENV === "development");
    expect(scripts()).toContain("'nonce-fixture-nonce'");
  }
});
