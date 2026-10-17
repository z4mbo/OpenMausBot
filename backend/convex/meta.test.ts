/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
test("advertises the desktop protocol and supported feature groups without exposing workspace data", async () => {
  const backend = convexTest(schema, modules);
  expect(await backend.query(makeFunctionReference<"query">("meta:capabilities"), {})).toEqual({ protocolVersion: 1, features: ["workspace", "teammates", "presence", "approvals", "voice"] });
});
