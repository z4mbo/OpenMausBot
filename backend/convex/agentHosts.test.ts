/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
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
    return { owner: out[0]!, member: out[1]! };
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: people.owner.token, name: "Team" });
  await t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: people.member.id, email: people.member.email, name: "Member", role: "member", status: "active", createdAt: Date.now(), updatedAt: Date.now() }));
  const projectId = await t.mutation(api.projects.create, { sessionToken: people.owner.token, teamId, name: "App" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: people.owner.token, projectId, email: people.member.email, role: "member" });
  await t.mutation(api.agents.setSharedAgents, { sessionToken: people.owner.token, teamId, enabled: true });
  const [{ agentId }] = await t.mutation(api.agents.publishProjectTeam, { sessionToken: people.owner.token, teamId, projectId, agents: [{ roleKey: "chief", kind: "chief", name: "App" }] });
  const threadId = await t.mutation(api.agentThreads.create, { sessionToken: people.owner.token, agentId, title: "Plan" });
  const host = (person: { token: string }, name: string, extra: { kind?: "local" | "server"; plans?: { agentId: typeof agentId; provider: "claude" | "chatgpt" | "grok" | "key"; plan?: string }[] } = {}) =>
    t.mutation(api.agents.publishHost, { sessionToken: person.token, teamId, name, engines: ["claude"], models: ["claude-sonnet-5"], computers: [], ...extra });
  return { t, ...people, teamId, agentId, threadId, projectId, host };
}

describe("where an agent runs", () => {
  test("a remote runner cannot start a queued request after its sender loses project access", async () => {
    const f = await fixture();
    const hostId = await f.host(f.owner, "Owner PC");
    await f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId });
    const active = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId: f.threadId, clientId: "active", text: "First" });
    const queued = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: f.threadId, clientId: "queued", text: "Second" });
    const membership = await f.t.run(ctx => ctx.db.query("members").withIndex("by_project_email", q => q.eq("projectId", f.projectId).eq("email", f.member.email)).unique());
    await f.t.mutation(api.members.remove, { sessionToken: f.owner.token, projectId: f.projectId, memberId: membership!._id });
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.owner.token, runId: active.runId, status: "succeeded" });
    expect((await f.t.run(ctx => ctx.db.get(queued.runId)))?.status).toBe("interrupted");
  });
  test("a teammate's message runs on the computer the agent is set to, and only that app may carry it", async () => {
    const f = await fixture();
    const ownerPc = await f.host(f.owner, "Owner PC");
    await f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId: ownerPc });
    const run = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: f.threadId, clientId: "send:1", text: "Plan the launch" });
    expect(run).toMatchObject({ status: "running", runner: { userId: f.owner.id, name: "Owner", host: "Owner PC" } });
    expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.member.token, teamId: f.teamId })).toEqual([]);
    expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.owner.token, teamId: f.teamId }))
      .toMatchObject([{ runId: run.runId, status: "running", text: "Plan the launch", hostedFor: { userId: f.member.id, name: "Member", messageId: run.messageId } }]);
    await expect(f.t.mutation(api.agentRuns.heartbeat, { sessionToken: f.member.token, runId: run.runId })).rejects.toThrow("Run not found");
    expect(await f.t.mutation(api.agentRuns.heartbeat, { sessionToken: f.owner.token, runId: run.runId })).toEqual({ status: "running" });
    await expect(f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.member.token, threadId: f.threadId, clientId: "m:x", runId: run.runId, role: "bot", kind: "text", text: "forged" }))
      .rejects.toThrow("Only the app running this reply");
    await f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.owner.token, threadId: f.threadId, clientId: "m:a", runId: run.runId, role: "bot", kind: "text", text: "Here is the plan" });
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.owner.token, runId: run.runId, status: "succeeded" });
    const rows = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.member.token, threadId: f.threadId, afterSeq: 0 });
    expect(rows.messages.find((row) => row.role === "bot")).toMatchObject({ text: "Here is the plan", runBy: "Owner" });
  });

  test("the owner's own messages, an offline computer and an unshared one run on the sender's app", async () => {
    const f = await fixture();
    const ownerPc = await f.host(f.owner, "Owner PC");
    await f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId: ownerPc });
    const own = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId: f.threadId, clientId: "send:own", text: "Mine" });
    expect(own.runner).toBeUndefined();
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.owner.token, runId: own.runId, status: "succeeded" });
    await f.t.run(ctx => ctx.db.patch(ownerPc, { heartbeatAt: Date.now() - 10 * 60_000 }));
    const offline = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: f.threadId, clientId: "send:offline", text: "Hi" });
    expect(offline.runner).toBeUndefined();
    expect(offline.fallback).toContain("offline");
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.member.token, runId: offline.runId, status: "succeeded" });
    await f.host(f.owner, "Owner PC");
    await f.t.mutation(api.agentHosts.share, { sessionToken: f.owner.token, hostId: ownerPc, shared: false });
    expect((await f.t.query(api.agentHosts.runsOn, { sessionToken: f.member.token, agentId: f.agentId })).host).toBeNull();
    const back = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: f.threadId, clientId: "send:back", text: "Again" });
    expect(back.runner).toBeUndefined();
  });

  test("only a shared computer can be chosen by someone else, and only its owner shares it", async () => {
    const f = await fixture();
    const memberPc = await f.host(f.member, "Member laptop");
    await expect(f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId: memberPc })).rejects.toThrow("not offered");
    expect((await f.t.query(api.agentHosts.list, { sessionToken: f.owner.token, teamId: f.teamId })).map((host) => host.name)).toEqual([]);
    await expect(f.t.mutation(api.agentHosts.share, { sessionToken: f.owner.token, hostId: memberPc, shared: true })).rejects.toThrow("Only its owner");
    await f.t.mutation(api.agentHosts.share, { sessionToken: f.member.token, hostId: memberPc, shared: true });
    expect(await f.t.query(api.agentHosts.list, { sessionToken: f.owner.token, teamId: f.teamId })).toMatchObject([{ name: "Member laptop", ownerName: "Member", mine: false, online: true }]);
    await f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId: memberPc });
    const run = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId: f.threadId, clientId: "send:2", text: "Go" });
    expect(run.runner).toMatchObject({ userId: f.member.id, host: "Member laptop" });
  });

  test("the runs-on badge learns the mode and whose plan pays, never a credential", async () => {
    const f = await fixture();
    expect(await f.t.query(api.agentHosts.runsOn, { sessionToken: f.member.token, agentId: f.agentId })).toMatchObject({ mode: "sender", host: null, canEdit: false });
    const ownerPc = await f.host(f.owner, "Owner PC", { plans: [{ agentId: f.agentId, provider: "claude", plan: "  max\n" }] });
    await f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId: ownerPc });
    expect(await f.t.query(api.agentHosts.runsOn, { sessionToken: f.member.token, agentId: f.agentId })).toMatchObject({
      mode: "member", host: { name: "Owner PC", ownerName: "Owner", ownerAvatarUrl: null, mine: false, online: true, plan: { provider: "claude", plan: "max" } },
    });
    expect((await f.t.query(api.agentHosts.list, { sessionToken: f.member.token, teamId: f.teamId })).map((host) => host.plan)).toEqual([null]);
    expect((await f.t.query(api.agentHosts.list, { sessionToken: f.member.token, teamId: f.teamId, agentId: f.agentId }))[0]!.plan).toEqual({ provider: "claude", plan: "max" });
    const server = await f.host(f.owner, "origin-vps", { kind: "server", plans: [{ agentId: f.agentId, provider: "key", plan: "Anthropic" }] });
    await f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId: server });
    expect(await f.t.query(api.agentHosts.runsOn, { sessionToken: f.member.token, agentId: f.agentId })).toMatchObject({ mode: "cloud", host: { kind: "server", plan: { provider: "key", plan: "Anthropic" } } });
  });

  test("a server runs even its owner's messages, and only the host a run went to picks it up", async () => {
    const f = await fixture();
    const laptop = await f.host(f.owner, "Owner laptop");
    const server = await f.host(f.owner, "origin-vps", { kind: "server" });
    await f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId: server });
    const own = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId: f.threadId, clientId: "send:own", text: "Nightly report" });
    expect(own.runner).toMatchObject({ userId: f.owner.id, host: "origin-vps" });
    const onServer = await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.owner.token, teamId: f.teamId, hostId: server });
    expect(onServer).toMatchObject([{ runId: own.runId, hostedFor: { userId: f.owner.id, messageId: own.messageId } }]);
    const onLaptop = await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.owner.token, teamId: f.teamId, hostId: laptop });
    expect(onLaptop).toHaveLength(1);
    expect(onLaptop[0]!.hostedFor).toBeUndefined();
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.owner.token, runId: own.runId, status: "succeeded" });

    await f.t.mutation(api.agentHosts.setRunsOn, { sessionToken: f.owner.token, agentId: f.agentId, hostId: laptop });
    const teammate = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: f.threadId, clientId: "send:t", text: "Hi" });
    expect(teammate.runner).toMatchObject({ host: "Owner laptop" });
    expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.owner.token, teamId: f.teamId, hostId: server })).toEqual([]);
    expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.owner.token, teamId: f.teamId, hostId: laptop }))
      .toMatchObject([{ runId: teammate.runId, hostedFor: { userId: f.member.id } }]);
  });
});
