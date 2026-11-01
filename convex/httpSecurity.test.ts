/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => vi.unstubAllEnvs());

test("the signed integration endpoint cancels oversized bodies before HMAC/dispatch", async () => {
  vi.stubEnv("ORIGIN_INTEGRATION_SECRET", "fixture-only-".repeat(4));
  let cancelled = false, reads = 0;
  const body = new ReadableStream({
    pull(controller) { if (++reads <= 8) controller.enqueue(new Uint8Array(60000)); else controller.close(); },
    cancel() { cancelled = true; },
  });
  const response = await convexTest(schema, modules).fetch("/integrations", { method: "POST", body, duplex: "half" } as RequestInit);
  expect(response.status).toBe(413); expect(cancelled).toBe(true); expect(reads).toBeLessThan(8);
});

test("the signed instanceOperator operation names the owner of the first workspace created", async () => {
  const secret = "fixture-only-".repeat(4);
  vi.stubEnv("ORIGIN_INTEGRATION_SECRET", secret);
  const backend = convexTest(schema, modules);
  const call = async () => {
    const body = JSON.stringify({ at: Date.now(), operation: "instanceOperator", args: {} });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), b => b.toString(16).padStart(2, "0")).join("");
    const response = await backend.fetch("/integrations", { method: "POST", body, headers: { "x-origin-signature": signature } });
    expect(response.status).toBe(200);
    return response.json();
  };
  expect(await call()).toBeNull();
  const [first, second] = await backend.run(async ctx => {
    const now = Date.now();
    const users = await Promise.all(["first@operator.test", "second@stranger.test"].map(email => ctx.db.insert("users", { email, name: email, passwordHash: "x", salt: "x", iterations: 1, role: "user", status: "active", createdAt: now, updatedAt: now })));
    await ctx.db.insert("teams", { name: "First", ownerUserId: users[0], createdAt: now, updatedAt: now });
    await ctx.db.insert("teams", { name: "Second", ownerUserId: users[1], createdAt: now, updatedAt: now });
    return users;
  });
  expect(await call()).toEqual({ userId: first });
  expect(second).not.toBe(first);
  const unsigned = await backend.fetch("/integrations", { method: "POST", body: JSON.stringify({ at: Date.now(), operation: "instanceOperator", args: {} }) });
  expect(unsigned.status).toBe(401);
});
