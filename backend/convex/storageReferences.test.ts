/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

test("replacing an agent avatar preserves files referenced by a project and another agent", async () => {
  const t = convexTest(schema, modules);
  const sessionToken = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Owner", email: "owner@example.test", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Assets" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Assets" });
  await t.mutation(api.agents.setSharedAgents, { sessionToken, teamId, enabled: true });
  const agents = await t.mutation(api.agents.publishProjectTeam, { sessionToken, teamId, projectId, agents: [{ kind: "chief", roleKey: "chief", name: "Chief" }, { kind: "agent", roleKey: "designer", name: "Designer" }] });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["image bytes"], { type: "image/png" })));
  await t.mutation(api.projects.update, { sessionToken, projectId, iconType: "image", iconStorageId: storageId });
  await t.run(async ctx => { for (const agent of agents) await ctx.db.patch(agent.agentId, { avatarStorageId: storageId }); });
  await t.mutation(api.agents.setAvatar, { sessionToken, agentId: agents[0]!.agentId, storageId: null });
  expect((await t.query(api.projects.get, { sessionToken, projectId })).iconUrl).not.toBeNull();
  expect((await t.query(api.agents.get, { sessionToken, agentId: agents[1]!.agentId })).avatarUrl).not.toBeNull();
});
