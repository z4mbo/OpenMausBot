/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const people = await t.run(async (ctx) => {
    const out = [];
    for (const name of ["Owner", "Member"]) {
      const now = Date.now();
      const email = `${name.toLowerCase()}@example.test`;
      const id = await ctx.db.insert("users", { name, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: now, updatedAt: now });
      out.push({ id, email, token: await createSession(ctx, id) });
    }
    return { owner: out[0], member: out[1] };
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: people.owner.token, name: "Team" });
  await t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: people.member.id, email: people.member.email, name: "Member", role: "member", status: "active", createdAt: Date.now(), updatedAt: Date.now() }));
  const projectId = await t.mutation(api.projects.create, { sessionToken: people.owner.token, teamId, name: "App" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: people.owner.token, projectId, email: people.member.email, role: "member" });
  await t.mutation(api.agents.setSharedAgents, { sessionToken: people.owner.token, teamId, enabled: true });
  const [{ agentId }] = await t.mutation(api.agents.publishProjectTeam, { sessionToken: people.owner.token, teamId, projectId, agents: [{ roleKey: "chief", kind: "chief", name: "App" }] });
  const threadId = await t.mutation(api.agentThreads.create, { sessionToken: people.owner.token, agentId, title: "Plan" });
  const active = await t.mutation(api.agentRuns.begin, { sessionToken: people.owner.token, threadId, clientId: "active", text: "First" });
  const member = await t.run(ctx => ctx.db.query("members").withIndex("by_project_email", q => q.eq("projectId", projectId).eq("email", people.member.email)).unique());
  return { t, ...people, teamId, projectId, threadId, agentId, active, memberId: member!._id };
}

describe("shared thread queue handoff", () => {
  test.each(["removed", "viewer", "suspended", "deleted"] as const)("skips a queued requester whose access becomes %s", async (change) => {
    const f = await fixture();
    const denied = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: f.threadId, clientId: "denied", text: "Second" });
    const next = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId: f.threadId, clientId: "next", text: "Third" });
    if (change === "removed") await f.t.mutation(api.members.remove, { sessionToken: f.owner.token, projectId: f.projectId, memberId: f.memberId });
    else if (change === "viewer") await f.t.mutation(api.members.updateRole, { sessionToken: f.owner.token, projectId: f.projectId, memberId: f.memberId, role: "viewer" });
    else if (change === "suspended") await f.t.run(ctx => ctx.db.patch(f.member.id, { status: "disabled" }));
    else await f.t.run(ctx => ctx.db.delete(f.member.id));

    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.owner.token, runId: f.active.runId, status: "succeeded" });
    const [thread, rejected, promoted] = await f.t.run(async ctx => Promise.all([ctx.db.get(f.threadId), ctx.db.get(denied.runId), ctx.db.get(next.runId)]));
    expect({ active: thread?.activeRunId, rejected: rejected?.status, promoted: promoted?.status }).toEqual({ active: next.runId, rejected: "interrupted", promoted: "running" });
  });

  test.each(["archived", "disabled", "unshared"] as const)("clears every queued run when the thread becomes %s", async (change) => {
    const f = await fixture();
    const queued = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: f.threadId, clientId: "queued", text: "Second" });
    if (change === "archived") await f.t.mutation(api.agentThreads.archive, { sessionToken: f.owner.token, threadId: f.threadId });
    else if (change === "disabled") await f.t.run(ctx => ctx.db.patch(f.agentId, { disabled: true }));
    else await f.t.mutation(api.agents.setSharedAgents, { sessionToken: f.owner.token, teamId: f.teamId, enabled: false });
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.owner.token, runId: f.active.runId, status: "succeeded" });
    const [thread, rejected] = await f.t.run(async ctx => Promise.all([ctx.db.get(f.threadId), ctx.db.get(queued.runId)]));
    expect({ active: thread?.activeRunId, lease: thread?.leaseUntil, queued: rejected?.status }).toEqual({ active: undefined, lease: undefined, queued: "interrupted" });
  });

  test("drains a long revoked queue in bounded batches before advancing to the next sender", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      for (let index = 0; index < 55; index += 1) await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: f.threadId, clientId: `denied:${index}`, text: "Queued" });
      const next = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId: f.threadId, clientId: "next", text: "Continue" });
      await f.t.mutation(api.members.remove, { sessionToken: f.owner.token, projectId: f.projectId, memberId: f.memberId });
      await f.t.mutation(api.agentRuns.finish, { sessionToken: f.owner.token, runId: f.active.runId, status: "succeeded" });
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await f.t.run(ctx => ctx.db.get(f.threadId)))?.activeRunId).toBe(next.runId);
      expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.owner.token, teamId: f.teamId })).toMatchObject([{ runId: next.runId, status: "running" }]);
      expect(await f.t.run(ctx => ctx.db.query("workspaceAgentRuns").withIndex("by_threadId_and_status", q => q.eq("threadId", f.threadId).eq("status", "queued")).take(100))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
