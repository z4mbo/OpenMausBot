/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture(sharedAgents = true) {
  const t = convexTest(schema, modules);
  const people = await t.run(async (ctx) => {
    const now = Date.now();
    const out = [];
    for (const name of ["Owner", "Member", "Viewer", "Outsider"]) {
      const email = `${name.toLowerCase()}@example.test`;
      const id = await ctx.db.insert("users", { name, username: name.toLowerCase(), email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: now, updatedAt: now });
      out.push({ id, email, token: await createSession(ctx, id) });
    }
    return { owner: out[0], member: out[1], viewer: out[2], outsider: out[3] };
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: people.owner.token, name: "Team" });
  await t.run(async (ctx) => {
    for (const [person, role] of [[people.member, "member"], [people.viewer, "viewer"]] as const) {
      await ctx.db.insert("teamMembers", { teamId, userId: person.id, email: person.email, name: role, role, status: "active", createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
  const projectId = await t.mutation(api.projects.create, { sessionToken: people.owner.token, teamId, name: "App", repoUrl: "https://github.com/example/app" });
  for (const person of [people.member, people.viewer]) {
    await t.mutation(api.members.addWorkspaceMember, { sessionToken: people.owner.token, projectId, email: person.email, role: "member" });
  }
  if (sharedAgents) await t.mutation(api.agents.setSharedAgents, { sessionToken: people.owner.token, teamId, enabled: true });
  const team = [
    { roleKey: "chief", kind: "chief" as const, name: "App", title: "Project lead", soul: "Lead the project.", color: "blue", modelIntent: { provider: "claudeAgent", model: "claude-haiku-5-5" } },
    { roleKey: "designer", kind: "agent" as const, name: "Dana", title: "Designer", soul: "Design things." },
  ];
  return { t, ...people, teamId, projectId, team };
}

describe("shared agent definitions", () => {
  test("publishing is gated by the workspace flag and idempotent per role", async () => {
    const off = await fixture(false);
    await expect(off.t.mutation(api.agents.publishProjectTeam, { sessionToken: off.owner.token, teamId: off.teamId, projectId: off.projectId, agents: off.team }))
      .rejects.toThrow(/Shared agents are off/);

    const f = await fixture();
    const first = await f.t.mutation(api.agents.publishProjectTeam, { sessionToken: f.owner.token, teamId: f.teamId, projectId: f.projectId, agents: f.team });
    expect(first.every((row) => row.created)).toBe(true);
    const again = await f.t.mutation(api.agents.publishProjectTeam, {
      sessionToken: f.member.token, teamId: f.teamId, projectId: f.projectId,
      agents: [{ ...f.team[0], soul: "A member's different soul" }, { roleKey: "writer", kind: "agent", name: "Wren" }],
    });
    expect(again.find((row) => row.roleKey === "chief")).toMatchObject({ agentId: first[0].agentId, created: false });
    expect(again.find((row) => row.roleKey === "writer")?.created).toBe(true);
    const listed = await f.t.query(api.agents.listForTeam, { sessionToken: f.member.token, teamId: f.teamId });
    expect(listed.map((agent) => agent.roleKey).sort()).toEqual(["chief", "designer", "writer"]);
    expect(listed.find((agent) => agent.roleKey === "chief")?.soul).toBe("Lead the project.");
    await expect(f.t.mutation(api.agents.publishProjectTeam, { sessionToken: f.viewer.token, teamId: f.teamId, projectId: f.projectId, agents: f.team })).rejects.toThrow();
    await expect(f.t.query(api.agents.listForTeam, { sessionToken: f.outsider.token, teamId: f.teamId })).rejects.toThrow();
  });

  test("edits need the creator or an admin and refuse a stale base version", async () => {
    const f = await fixture();
    const [chief] = await f.t.mutation(api.agents.publishProjectTeam, { sessionToken: f.owner.token, teamId: f.teamId, projectId: f.projectId, agents: f.team });
    await expect(f.t.mutation(api.agents.update, { sessionToken: f.member.token, agentId: chief.agentId, patch: { soul: "hijack" } })).rejects.toThrow(/creator or an admin/);
    const { soulVersion } = await f.t.mutation(api.agents.update, { sessionToken: f.owner.token, agentId: chief.agentId, baseVersion: 1, patch: { soul: "New soul" } });
    expect(soulVersion).toBe(2);
    await expect(f.t.mutation(api.agents.update, { sessionToken: f.owner.token, agentId: chief.agentId, baseVersion: 1, patch: { soul: "Stale" } })).rejects.toThrow(/changed/);
    const agent = await f.t.query(api.agents.get, { sessionToken: f.member.token, agentId: chief.agentId });
    expect(agent).toMatchObject({ soul: "New soul", soulVersion: 2, canEdit: false, canSend: true });
    await f.t.mutation(api.agents.archive, { sessionToken: f.owner.token, agentId: chief.agentId });
    expect((await f.t.query(api.agents.listForTeam, { sessionToken: f.owner.token, teamId: f.teamId })).map((row) => row.roleKey)).toEqual(["designer"]);
  });
});

describe("shared threads and sender runs", () => {
  async function thread(f: Awaited<ReturnType<typeof fixture>>, priv = false) {
    const [chief] = await f.t.mutation(api.agents.publishProjectTeam, { sessionToken: f.owner.token, teamId: f.teamId, projectId: f.projectId, agents: f.team });
    const threadId = await f.t.mutation(api.agentThreads.create, { sessionToken: f.owner.token, agentId: chief.agentId, title: "Plan", clientId: "local-1", private: priv });
    return { agentId: chief.agentId, threadId };
  }

  test("a second sender queues behind the lease and is promoted when the first run finishes", async () => {
    const f = await fixture();
    const { threadId, agentId } = await thread(f);
    expect(await f.t.mutation(api.agentThreads.create, { sessionToken: f.owner.token, agentId, title: "Plan", clientId: "local-1" })).toBe(threadId);
    const a = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "send:a", text: "Hello", engineLabel: "Claude Haiku 5.5" });
    expect(a.status).toBe("running");
    expect(await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "send:a", text: "Hello" })).toMatchObject({ runId: a.runId });
    const b = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId, clientId: "send:b", text: "Me too" });
    expect(b.status).toBe("queued");
    await expect(f.t.mutation(api.agentRuns.begin, { sessionToken: f.viewer.token, threadId, clientId: "send:c", text: "no" })).rejects.toThrow(/View-only/);

    await expect(f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.member.token, threadId, runId: a.runId, clientId: "m:x", role: "bot", kind: "text", text: "forged" }))
      .rejects.toThrow(/app running this reply/);
    await f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.owner.token, threadId, runId: a.runId, clientId: "m:reply", role: "bot", kind: "text", text: "Hi", status: "streaming" });
    await f.t.mutation(api.agentRuns.patchMessage, { sessionToken: f.owner.token, threadId, clientId: "m:reply", text: "Hi there", status: "final" });

    const before = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.member.token, threadId, afterSeq: 0 });
    expect(before.activeRun).toMatchObject({ runId: a.runId, requesterName: "Owner", engineLabel: "Claude Haiku 5.5" });
    expect(before.queued.map((run) => run.runId)).toEqual([b.runId]);
    expect(before.messages.map((row) => [row.role, row.text, row.authorName ?? row.runBy])).toEqual([
      ["user", "Hello", "Owner"], ["user", "Me too", "Member"], ["bot", "Hi there", "Owner"],
    ]);

    expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.member.token, teamId: f.teamId })).toMatchObject([{ runId: b.runId, status: "queued", text: "Me too" }]);
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.owner.token, runId: a.runId, status: "succeeded" });
    expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.member.token, teamId: f.teamId })).toMatchObject([{ runId: b.runId, status: "running" }]);
    const after = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.owner.token, threadId, afterSeq: before.seq });
    expect(after.activeRun?.runId).toBe(b.runId);
    await expect(f.t.mutation(api.agentRuns.patchMessage, { sessionToken: f.owner.token, threadId, clientId: "m:reply", text: "late but in grace" })).resolves.toBeTruthy();
  });

  test("imports history idempotently without executing it and pages every change for an offline member", async () => {
    const f = await fixture();
    const { threadId } = await thread(f);
    const rows = Array.from({ length: 45 }, (_, i) => ({ clientId: `history:${i}`, role: i % 2 ? "bot" as const : "user" as const, kind: "text" as const, text: `Row ${i}` }));
    for (let i = 0; i < rows.length; i += 10) {
      const args = { sessionToken: f.owner.token, threadId, messages: rows.slice(i, i + 10) };
      await f.t.mutation(api.agentRuns.importMessages, args);
      await f.t.mutation(api.agentRuns.importMessages, args);
    }
    expect(await f.t.run(ctx => ctx.db.query("workspaceAgentRuns").take(1))).toEqual([]);
    const all = [];
    let afterSeq = 0;
    for (;;) {
      const page = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.member.token, threadId, afterSeq, limit: 200 });
      expect(page.messages.length).toBeLessThanOrEqual(20);
      all.push(...page.messages);
      afterSeq = page.messages[page.messages.length - 1]?.updSeq ?? afterSeq;
      if (!page.more) break;
    }
    expect(all.map(row => row.text)).toEqual(rows.map(row => row.text));
    await f.t.mutation(api.agentRuns.patchMessage, { sessionToken: f.owner.token, threadId, clientId: "history:0", text: "Updated later" });
    const delta = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.member.token, threadId, afterSeq });
    expect(delta.messages).toMatchObject([{ seq: 1, text: "Updated later", authorName: "Owner" }]);
    await expect(f.t.mutation(api.agentRuns.importMessages, { sessionToken: f.member.token, threadId, messages: rows.slice(0, 1) })).rejects.toThrow(/Only the creator/);
    await expect(f.t.query(api.agentThreads.messagesSince, { sessionToken: f.outsider.token, threadId, afterSeq: 0 })).rejects.toThrow(/Thread not found/);
  });

  test("discovers more than 200 threads with stable bounded pages and project authorization", async () => {
    const f = await fixture();
    const { agentId } = await thread(f);
    await f.t.run(async ctx => {
      for (let i = 0; i < 224; i += 1) await ctx.db.insert("agentThreads", { teamId: f.teamId, projectId: f.projectId, agentId,
        title: `Thread ${i}`, createdBy: f.owner.id, seq: 0, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const found = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const page: { page: { _id: string }[]; isDone: boolean; continueCursor: string } = await f.t.query(api.agentThreads.listPage, { sessionToken: f.member.token, agentId, paginationOpts: { cursor, numItems: 1000 } });
      expect(page.page.length).toBeLessThanOrEqual(50);
      for (const row of page.page) found.add(row._id);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(found.size).toBe(225);
    await expect(f.t.query(api.agentThreads.listPage, { sessionToken: f.outsider.token, agentId, paginationOpts: { cursor: null, numItems: 50 } })).rejects.toThrow(/Agent not found/);
  });

  test("fences two executors of the same member and refuses changed retry text", async () => {
    const f = await fixture();
    const { threadId } = await thread(f);
    const run = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "send:once", text: "One turn" });
    const claim = (executorId: string) => f.t.mutation(api.agentRuns.heartbeat, { sessionToken: f.owner.token, runId: run.runId, executorId });
    expect(await claim("machine-a")).toEqual({ status: "running" });
    expect(await claim("machine-b")).toEqual({ status: "claimed_elsewhere" });
    expect(await claim("machine-a")).toEqual({ status: "running" });
    await expect(f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "send:once", text: "Different" })).rejects.toThrow(/another message/);
  });

  test("an expired executor cannot resurrect a turn before the expiry job runs", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      const { threadId } = await thread(f);
      const run = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "send:expired", text: "Run" });
      vi.advanceTimersByTime(61_000);
      expect(await f.t.mutation(api.agentRuns.heartbeat, { sessionToken: f.owner.token, runId: run.runId, executorId: "late" })).toEqual({ status: "interrupted" });
    } finally { vi.useRealTimers(); }
  });

  test("a runner that stops heartbeating is interrupted and its streaming rows marked", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      const { threadId } = await thread(f);
      const a = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "send:a", text: "Hello" });
      await f.t.mutation(api.agentRuns.appendMessage, { sessionToken: f.owner.token, threadId, runId: a.runId, clientId: "m:r", role: "bot", kind: "text", text: "Half", status: "streaming" });
      const b = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId, clientId: "send:b", text: "Next" });
      vi.advanceTimersByTime(61_000);
      expect(await f.t.mutation(internal.agentRuns.expireStale, {})).toBe(1);
      const view = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.member.token, threadId, afterSeq: 0 });
      expect(view.messages.find((row) => row.clientId === "m:r")?.status).toBe("interrupted");
      expect(view.activeRun?.runId).toBe(b.runId);
    } finally {
      vi.useRealTimers();
    }
  });

  test("private threads stay with their creator", async () => {
    const f = await fixture();
    const { threadId, agentId } = await thread(f, true);
    await expect(f.t.query(api.agentThreads.messagesSince, { sessionToken: f.member.token, threadId, afterSeq: 0 })).rejects.toThrow(/Thread not found/);
    expect(await f.t.query(api.agentThreads.list, { sessionToken: f.member.token, agentId })).toEqual([]);
    expect((await f.t.query(api.agentThreads.list, { sessionToken: f.owner.token, agentId })).map((row) => row._id)).toEqual([threadId]);
  });

  test.each(["removed", "viewer"] as const)("a requester with %s project access cannot resume or retain a run", async (access) => {
    const f = await fixture();
    const { threadId } = await thread(f);
    const memberRun = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId, clientId: "member:run", text: "Private project request" });
    const ownerRun = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "owner:next", text: "Continue" });
    const membership = await f.t.run(ctx => ctx.db.query("members").withIndex("by_project_email", q => q.eq("projectId", f.projectId).eq("email", f.member.email)).unique());
    if (access === "removed") await f.t.mutation(api.members.remove, { sessionToken: f.owner.token, projectId: f.projectId, memberId: membership!._id });
    else await f.t.mutation(api.members.updateRole, { sessionToken: f.owner.token, projectId: f.projectId, memberId: membership!._id, role: "viewer" });

    expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.member.token, teamId: f.teamId })).toEqual([]);
    expect(await f.t.mutation(api.agentRuns.heartbeat, { sessionToken: f.member.token, runId: memberRun.runId })).toEqual({ status: "interrupted" });
    const after = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.owner.token, threadId, afterSeq: 0 });
    expect(after.activeRun?.runId).toBe(ownerRun.runId);
  });

  test.each(["archived thread", "archived agent", "disabled agent", "sharing disabled"] as const)("a run stops when its %s prevents new messages", async (change) => {
    const f = await fixture();
    const { threadId, agentId } = await thread(f);
    const run = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "owner:run", text: "Hello" });
    if (change === "archived thread") await f.t.mutation(api.agentThreads.archive, { sessionToken: f.owner.token, threadId });
    else if (change === "archived agent") await f.t.mutation(api.agents.archive, { sessionToken: f.owner.token, agentId });
    else if (change === "disabled agent") await f.t.run(ctx => ctx.db.patch(agentId, { disabled: true }));
    else await f.t.mutation(api.agents.setSharedAgents, { sessionToken: f.owner.token, teamId: f.teamId, enabled: false });

    expect(await f.t.query(api.agentRuns.pendingForMe, { sessionToken: f.owner.token, teamId: f.teamId })).toEqual([]);
    expect(await f.t.mutation(api.agentRuns.heartbeat, { sessionToken: f.owner.token, runId: run.runId })).toEqual({ status: "interrupted" });
    expect((await f.t.run(ctx => ctx.db.get(threadId)))?.activeRunId).toBeUndefined();
  });

  test.each(["viewer", "archived thread", "archived agent", "disabled agent", "sharing disabled"] as const)("%s access blocks transcript writes before the next heartbeat", async (change) => {
    const f = await fixture();
    const { threadId, agentId } = await thread(f);
    const sessionToken = change === "viewer" ? f.member.token : f.owner.token;
    const run = await f.t.mutation(api.agentRuns.begin, { sessionToken, threadId, clientId: "send:before", text: "Hello" });
    await f.t.mutation(api.agentRuns.appendMessage, { sessionToken, threadId, runId: run.runId, clientId: "m:before", role: "bot", kind: "text", text: "Started", status: "streaming" });
    if (change === "viewer") {
      const membership = await f.t.run(ctx => ctx.db.query("members").withIndex("by_project_email", q => q.eq("projectId", f.projectId).eq("email", f.member.email)).unique());
      await f.t.mutation(api.members.updateRole, { sessionToken: f.owner.token, projectId: f.projectId, memberId: membership!._id, role: "viewer" });
    } else if (change === "archived thread") await f.t.mutation(api.agentThreads.archive, { sessionToken: f.owner.token, threadId });
    else if (change === "archived agent") await f.t.mutation(api.agents.archive, { sessionToken: f.owner.token, agentId });
    else if (change === "disabled agent") await f.t.run(ctx => ctx.db.patch(agentId, { disabled: true }));
    else await f.t.mutation(api.agents.setSharedAgents, { sessionToken: f.owner.token, teamId: f.teamId, enabled: false });

    const writes = {
      begin: () => f.t.mutation(api.agentRuns.begin, { sessionToken, threadId, clientId: "send:after", text: "Another request" }),
      append: () => f.t.mutation(api.agentRuns.appendMessage, { sessionToken, threadId, runId: run.runId, clientId: "m:after", role: "bot", kind: "text", text: "Unauthorized reply" }),
      patch: () => f.t.mutation(api.agentRuns.patchMessage, { sessionToken, threadId, clientId: "m:before", text: "Unauthorized edit" }),
    };
    const outcomes: Record<string, string> = {};
    for (const [name, write] of Object.entries(writes)) outcomes[name] = await write().then(() => "accepted", () => "rejected");
    expect(outcomes).toEqual({ begin: "rejected", append: "rejected", patch: "rejected" });
    expect((await f.t.run(ctx => ctx.db.query("agentThreadMessages").withIndex("by_runId", q => q.eq("runId", run.runId)).collect()))
      .map(row => row.text)).toEqual(["Hello", "Started"]);
  });

  test("cancel lets a queued run never start and clears a live lease", async () => {
    const f = await fixture();
    const { threadId } = await thread(f);
    const a = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.owner.token, threadId, clientId: "send:a", text: "One" });
    const b = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId, clientId: "send:b", text: "Two" });
    await expect(f.t.mutation(api.agentRuns.cancel, { sessionToken: f.member.token, runId: a.runId })).rejects.toThrow(/requester/);
    await f.t.mutation(api.agentRuns.cancel, { sessionToken: f.member.token, runId: b.runId });
    await f.t.mutation(api.agentRuns.cancel, { sessionToken: f.owner.token, runId: a.runId });
    const view = await f.t.query(api.agentThreads.messagesSince, { sessionToken: f.owner.token, threadId, afterSeq: 0 });
    expect(view.activeRun).toBeNull();
    expect(view.queued).toEqual([]);
  });
});
