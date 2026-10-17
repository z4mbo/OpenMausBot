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
