/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession, hashPassword } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const user = await t.run(async ctx => {
    const salt = "1234567890abcdef";
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.test", name: "Owner", role: "user", status: "active",
      passwordHash: await hashPassword("current-password", salt, 1), salt, iterations: 1,
      createdAt: now, updatedAt: now,
    });
    const tokens = [];
    for (let index = 0; index < 502; index += 1) tokens.push(await createSession(ctx, userId));
    return { userId, current: tokens[0]!, other: tokens[1]!, newest: tokens[501]! };
  });
  return { t, ...user };
}

describe("account session revocation", () => {
  test.each(["revokeOtherSessions", "changePassword"] as const)("%s revokes sessions beyond the first bounded page", async operation => {
    const f = await fixture();
    expect(await f.t.query(api.auth.me, { sessionToken: f.newest })).not.toBeNull();
    if (operation === "changePassword") {
      await f.t.mutation(api.auth.changePassword, { sessionToken: f.current, currentPassword: "current-password", newPassword: "updated-password" });
    } else await f.t.mutation(api.auth.revokeOtherSessions, { sessionToken: f.current });
    expect(await f.t.query(api.auth.me, { sessionToken: f.current })).toMatchObject({ _id: f.userId });
    expect(await f.t.query(api.auth.me, { sessionToken: f.other })).toBeNull();
    expect(await f.t.query(api.auth.me, { sessionToken: f.newest })).toBeNull();
    const next = await f.t.run(ctx => createSession(ctx, f.userId));
    expect(await f.t.query(api.auth.me, { sessionToken: next })).toMatchObject({ _id: f.userId });
    await f.t.mutation(api.auth.revokeOtherSessions, { sessionToken: next });
    expect(await f.t.query(api.auth.me, { sessionToken: f.current })).toBeNull();
    expect(await f.t.query(api.auth.me, { sessionToken: next })).not.toBeNull();
  });
});
