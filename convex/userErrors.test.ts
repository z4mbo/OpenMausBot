/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// Production deployments redact plain Error messages; user-facing errors are ConvexErrors so their text survives.
test("user-facing errors carry their message as ConvexError data", async () => {
  const t = convexTest(schema, modules);
  const session = await t.run(async ctx => {
    const id = await ctx.db.insert("users", { name: "Owner", username: "owner", email: "owner@errors.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, id);
  });
  const caught = async (run: () => Promise<unknown>) => { try { await run(); } catch (error) { return error; } throw new Error("expected a failure"); };
  const workspace = await caught(() => t.mutation(api.workspaces.create, { sessionToken: session, name: " " }));
  expect(workspace).toBeInstanceOf(ConvexError);
  expect((workspace as ConvexError<string>).data).toBe("Workspace name must be between 1 and 60 characters");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: session, name: "Errors" });
  const denied = await caught(() => t.query(api.connectors.listGrants, { sessionToken: "not-a-session", teamId }));
  expect(denied).toBeInstanceOf(ConvexError);
  expect(typeof (denied as ConvexError<string>).data).toBe("string");
});
