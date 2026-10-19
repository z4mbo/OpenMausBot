/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const owner = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Owner", email: "org@test.dev", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, sessionToken: await createSession(ctx, userId) };
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner.sessionToken, name: "Org" });
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner.sessionToken, teamId, name: "Rocket" });
  return { t, teamId, projectId, ...owner };
}

describe("org tree", () => {
  test("shows each agent's live phase and only its last week of usage", async () => {
    const f = await fixture();
    const now = Date.now();
    const ids = await f.t.run(async ctx => {
      const membership = (await ctx.db.query("teamMembers").first())!;
      const base = { teamId: f.teamId, createdBy: f.userId, avatarSeed: "a", avatarColor: "#888888", instructions: "", engine: "claude", model: "opus", effort: "high", skills: [], approvalMode: "ask" as const, destructiveMode: "ask" as const, disabled: false, createdAt: 1, updatedAt: 1 };
      const head = await ctx.db.insert("workspaceAgents", { ...base, name: "Boss", kind: "head" });
      const chief = await ctx.db.insert("workspaceAgents", { ...base, name: "Ada", kind: "chief", projectId: f.projectId, title: "Chief" });
      const agent = await ctx.db.insert("workspaceAgents", { ...base, name: "Linus", kind: "agent", projectId: f.projectId });
      await ctx.db.insert("workspaceAgents", { ...base, name: "Gone", kind: "agent", projectId: f.projectId, archivedAt: 5 });
      const run = { teamId: f.teamId, projectId: f.projectId, requesterUserId: f.userId, requesterMembershipId: membership._id, engine: "claude", model: "opus", effort: "high", depth: 0, eventSequence: 0, lastEventAt: now };
      await ctx.db.insert("workspaceAgentRuns", { ...run, actorAgentId: chief, status: "waiting_approval", task: "Merge #7", createdAt: now - 1000, updatedAt: now });
      await ctx.db.insert("workspaceAgentRuns", { ...run, actorAgentId: agent, status: "running", task: "Build the login page", createdAt: now - 1000, updatedAt: now });
      await ctx.db.insert("workspaceAgentRuns", { ...run, actorAgentId: agent, status: "succeeded", task: "Earlier", usage: { input: 1000, output: 500, costUsd: 0.25 }, createdAt: now - 86_400_000, updatedAt: now - 86_400_000 });
      await ctx.db.insert("workspaceAgentRuns", { ...run, actorAgentId: agent, status: "succeeded", task: "Last month", usage: { input: 9000, output: 9000 }, createdAt: now - 30 * 86_400_000, updatedAt: now - 30 * 86_400_000 });
      return { head, chief, agent };
    });
    const tree = await f.t.query(api.org.tree, { sessionToken: f.sessionToken, teamId: f.teamId });
    const byName = new Map(tree.agents.map(node => [node.name, node]));
    expect([...byName.keys()].sort()).toEqual(["Ada", "Boss", "Linus"]);
    expect(byName.get("Boss")).toMatchObject({ _id: ids.head, kind: "head", phase: "idle", runs: 0 });
    expect(byName.get("Ada")).toMatchObject({ kind: "chief", phase: "waiting_approval", task: "Merge #7", liveRuns: 1 });
    expect(byName.get("Linus")).toMatchObject({ kind: "agent", phase: "working", task: "Build the login page", runs: 2, tokens: 1500, costUsd: 0.25 });
    expect(tree.projects).toEqual([expect.objectContaining({ _id: f.projectId, name: "Rocket" })]);
  });

  test("a workspace member without the project sees only workspace-level agents", async () => {
    const f = await fixture();
    const other = await f.t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Guest", email: "guest@test.dev", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("teamMembers", { teamId: f.teamId, userId, email: "guest@test.dev", name: "Guest", role: "member", status: "active", createdAt: 1, updatedAt: 1 });
      const base = { teamId: f.teamId, createdBy: f.userId, avatarSeed: "a", avatarColor: "#888888", instructions: "", engine: "claude", model: "opus", effort: "high", skills: [], approvalMode: "ask" as const, destructiveMode: "ask" as const, disabled: false, createdAt: 1, updatedAt: 1 };
      await ctx.db.insert("workspaceAgents", { ...base, name: "Boss", kind: "head" });
      await ctx.db.insert("workspaceAgents", { ...base, name: "Ada", kind: "chief", projectId: f.projectId });
      return createSession(ctx, userId);
    });
    const tree = await f.t.query(api.org.tree, { sessionToken: other, teamId: f.teamId });
    expect(tree.agents.map(node => node.name)).toEqual(["Boss"]);
    expect(tree.projects).toEqual([]);
  });
});
