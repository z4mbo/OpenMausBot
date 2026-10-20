/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createSession } from "./lib/auth";
import { makeFunctionReference } from "convex/server";
import { budgetLevel } from "./budgets";
import { runChiefHeartbeats } from "../../server/origin-chief-heartbeat.ts";
import { standupTools } from "../../server/origin-standup-tool.ts";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const DAY = 86_400_000;

async function fixture() {
  const t = convexTest(schema, modules);
  const people = await t.run(async (ctx) => {
    const now = Date.now();
    const out = [];
    for (const name of ["Owner", "Member"]) {
      const email = `${name.toLowerCase()}@ops.test`;
      const id = await ctx.db.insert("users", { name, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: now, updatedAt: now });
      out.push({ id, email, token: await createSession(ctx, id) });
    }
    return { owner: out[0]!, member: out[1]! };
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: people.owner.token, name: "Ops" });
  await t.run(async (ctx) => {
    await ctx.db.insert("teamMembers", { teamId, userId: people.member.id, email: people.member.email, name: "Member", role: "member", status: "active", createdAt: Date.now(), updatedAt: Date.now() });
  });
  const projectId = await t.mutation(api.projects.create, { sessionToken: people.owner.token, teamId, name: "Rocket" });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: people.owner.token, projectId, email: people.member.email, role: "member" });
  await t.mutation(api.agents.setSharedAgents, { sessionToken: people.owner.token, teamId, enabled: true });
  const published = await t.mutation(api.agents.publishProjectTeam, {
    sessionToken: people.owner.token, teamId, projectId,
    agents: [{ roleKey: "chief", kind: "chief", name: "Ada", title: "Lead", soul: "Lead." }, { roleKey: "dev", kind: "agent", name: "Kai", soul: "Build." }],
  });
  const chiefId = published.find((row) => row.roleKey === "chief")!.agentId;
  const devId = published.find((row) => row.roleKey === "dev")!.agentId;
  const { columns } = await t.query(api.tasks.board, { sessionToken: people.owner.token, projectId });
  return { t, ...people, teamId, projectId, chiefId, devId, columns };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function turn(f: Fixture, agentId: Id<"workspaceAgents">, clientId: string, costUsd: number) {
  const threadId = await f.t.mutation(api.agentThreads.create, { sessionToken: f.member.token, agentId, title: "Work", clientId: `thread:${clientId}` });
  const { runId } = await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId, clientId, text: "Do it" });
  await f.t.mutation(api.agentRuns.finish, { sessionToken: f.member.token, runId, status: "succeeded", usage: { input: 100, output: 50, costUsd } });
  return threadId;
}

describe("agent and project budgets", () => {
  test("levels warn at 80% and stop at 100%", () => {
    expect(budgetLevel(7.99, 10)).toBe("ok");
    expect(budgetLevel(8, 10)).toBe("warn");
    expect(budgetLevel(10, 10)).toBe("over");
    expect(budgetLevel(1_000, undefined)).toBe("ok");
  });

  test("only workspace admins set budgets, and a run past one is refused", async () => {
    const f = await fixture();
    await expect(f.t.mutation(api.budgets.set, { sessionToken: f.member.token, teamId: f.teamId, agentId: f.devId, monthlyUsd: 5 })).rejects.toThrow(/Admin role required/);
    await expect(f.t.mutation(api.budgets.set, { sessionToken: f.owner.token, teamId: f.teamId, agentId: f.devId, monthlyUsd: 0 })).rejects.toThrow(/between \$1/);
    await f.t.mutation(api.budgets.set, { sessionToken: f.owner.token, teamId: f.teamId, agentId: f.devId, monthlyUsd: 5 });

    const threadId = await turn(f, f.devId, "first", 4.2);
    expect(await f.t.query(api.budgets.forAgent, { sessionToken: f.member.token, agentId: f.devId }))
      .toMatchObject({ scope: "agent", name: "Kai", level: "warn", monthlyUsd: 5, canRaise: false });
    await f.t.mutation(api.agentRuns.finish, { sessionToken: f.member.token, runId: (await f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId, clientId: "second", text: "More" })).runId, status: "succeeded", usage: { input: 1, output: 1, costUsd: 1 } });
    await expect(f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId, clientId: "third", text: "Again" }))
      .rejects.toThrow(/Budget reached: Kai spent \$5\.20 of its \$5\.00 monthly budget/);
    expect(await f.t.query(api.budgets.forAgent, { sessionToken: f.owner.token, agentId: f.devId })).toMatchObject({ level: "over", canRaise: true });

    await f.t.mutation(api.budgets.set, { sessionToken: f.owner.token, teamId: f.teamId, agentId: f.devId, monthlyUsd: 20 });
    await expect(f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId, clientId: "third", text: "Again" })).resolves.toMatchObject({ status: "running" });
  });

  test("a project budget counts every agent in the project and shows in the overview", async () => {
    const f = await fixture();
    await f.t.mutation(api.budgets.set, { sessionToken: f.owner.token, teamId: f.teamId, projectId: f.projectId, monthlyUsd: 3 });
    await turn(f, f.devId, "dev", 2);
    await turn(f, f.chiefId, "chief", 1.5);
    const chiefThread = await f.t.mutation(api.agentThreads.create, { sessionToken: f.member.token, agentId: f.chiefId, title: "Next" });
    await expect(f.t.mutation(api.agentRuns.begin, { sessionToken: f.member.token, threadId: chiefThread, clientId: "late", text: "One more" }))
      .rejects.toThrow(/Budget reached: Rocket spent \$3\.50 of its \$3\.00/);
    const overview = await f.t.query(api.budgets.overview, { sessionToken: f.member.token, teamId: f.teamId });
    expect(overview.canEdit).toBe(false);
    expect(overview.projects).toEqual([{ projectId: f.projectId, spentUsd: 3.5, runs: 2, monthlyUsd: 3 }]);
    expect(overview.agents.find((row) => row.agentId === f.devId)).toMatchObject({ spentUsd: 2, runs: 1 });
    await f.t.mutation(api.budgets.set, { sessionToken: f.owner.token, teamId: f.teamId, projectId: f.projectId, monthlyUsd: null });
    expect((await f.t.query(api.budgets.overview, { sessionToken: f.owner.token, teamId: f.teamId })).projects[0]).not.toHaveProperty("monthlyUsd");
  });
});

describe("Chief heartbeat", () => {
  test("is off until an admin turns it on, then posts once per change in what needs action", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture();
      const NOW = Date.parse("2026-10-20T10:00:00Z");
      vi.setSystemTime(NOW);
      expect(await f.t.query(api.chiefHeartbeat.settings, { sessionToken: f.member.token, projectId: f.projectId }))
        .toMatchObject({ enabled: false, intervalHours: 4, staleDays: 3, canEdit: false, chiefName: "Ada" });
      expect(await f.t.mutation(api.chiefHeartbeat.claim, { sessionToken: f.member.token, teamId: f.teamId, agentIds: [f.chiefId] })).toEqual([]);
      await expect(f.t.mutation(api.chiefHeartbeat.configure, { sessionToken: f.member.token, projectId: f.projectId, enabled: true, intervalHours: 2, staleDays: 2 })).rejects.toThrow();
      await f.t.mutation(api.chiefHeartbeat.configure, { sessionToken: f.owner.token, projectId: f.projectId, enabled: true, intervalHours: 99, staleDays: 2 });

      const todo = f.columns.find((column) => column.title === "Todo")!;
      const taskId = await f.t.mutation(api.tasks.createTask, { sessionToken: f.owner.token, projectId: f.projectId, columnId: todo._id, title: "Untouched login bug", priority: "high", assignedToEmail: f.owner.email, dueDate: "2026-12-31" });
      await f.t.run(async (ctx) => { await ctx.db.patch(taskId, { updatedAt: NOW - 5 * DAY }); });

      expect(await f.t.mutation(api.chiefHeartbeat.claim, { sessionToken: f.member.token, teamId: f.teamId, agentIds: [f.devId] })).toEqual([]);
      const [claimed, ...rest] = await f.t.mutation(api.chiefHeartbeat.claim, { sessionToken: f.member.token, teamId: f.teamId, agentIds: [f.chiefId] });
      expect(rest).toEqual([]);
      expect(claimed).toMatchObject({ projectName: "Rocket", chiefName: "Ada", findings: { stale: [{ title: "Untouched login bug", days: 5 }], blocked: [], waiting: [] } });
      expect(await f.t.mutation(api.chiefHeartbeat.claim, { sessionToken: f.member.token, teamId: f.teamId, agentIds: [f.chiefId] })).toEqual([]);

      expect(await f.t.mutation(api.chiefHeartbeat.post, { sessionToken: f.owner.token, projectId: f.projectId, claimId: claimed!.claimId, text: "Not mine" })).toBeNull();
      const threadId = await f.t.mutation(api.chiefHeartbeat.post, { sessionToken: f.member.token, projectId: f.projectId, claimId: claimed!.claimId, text: "1 issue has not moved in 5 days: Untouched login bug." });
      expect(threadId).not.toBeNull();
      const threads = await f.t.query(api.agentThreads.list, { sessionToken: f.owner.token, agentId: f.chiefId });
      expect(threads.find((thread) => thread._id === threadId)?.title).toBe("Heartbeat");
      const messages = await f.t.run(async (ctx) => ctx.db.query("agentThreadMessages").withIndex("by_threadId_and_seq", (q) => q.eq("threadId", threadId!)).collect());
      expect(messages.map((row) => [row.role, row.text])).toEqual([["bot", "1 issue has not moved in 5 days: Untouched login bug."]]);

      vi.setSystemTime(NOW + 25 * 3_600_000);
      expect(await f.t.mutation(api.chiefHeartbeat.claim, { sessionToken: f.member.token, teamId: f.teamId, agentIds: [f.chiefId] })).toEqual([]);
      await f.t.mutation(api.tasks.createTask, { sessionToken: f.owner.token, projectId: f.projectId, columnId: todo._id, title: "Second stale", priority: "low", assignedToEmail: f.owner.email, dueDate: "2026-12-31" })
        .then((id) => f.t.run(async (ctx) => { await ctx.db.patch(id, { updatedAt: NOW - 3 * DAY }); }));
      vi.setSystemTime(NOW + 50 * 3_600_000);
      const [again] = await f.t.mutation(api.chiefHeartbeat.claim, { sessionToken: f.member.token, teamId: f.teamId, agentIds: [f.chiefId] });
      expect(again?.findings.stale.map((item) => item.title)).toEqual(["Untouched login bug", "Second stale"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("an over-budget Chief skips its heartbeat", async () => {
    const f = await fixture();
    await f.t.mutation(api.chiefHeartbeat.configure, { sessionToken: f.owner.token, projectId: f.projectId, enabled: true, intervalHours: 1, staleDays: 1 });
    const todo = f.columns.find((column) => column.title === "Todo")!;
    const taskId = await f.t.mutation(api.tasks.createTask, { sessionToken: f.owner.token, projectId: f.projectId, columnId: todo._id, title: "Old", priority: "low", assignedToEmail: f.owner.email, dueDate: "2026-12-31" });
    await f.t.run(async (ctx) => { await ctx.db.patch(taskId, { updatedAt: Date.now() - 4 * DAY }); });
    await f.t.mutation(api.budgets.set, { sessionToken: f.owner.token, teamId: f.teamId, agentId: f.chiefId, monthlyUsd: 1 });
    await turn(f, f.chiefId, "spend", 1);
    expect(await f.t.mutation(api.chiefHeartbeat.claim, { sessionToken: f.member.token, teamId: f.teamId, agentIds: [f.chiefId] })).toEqual([]);
  });
});

describe("call notes", () => {
  test("keep the summary and action items, and turn picked items into Draft issues for the Chief once", async () => {
    const f = await fixture();
    const noteId = await f.t.mutation(api.callNotes.record, {
      sessionToken: f.member.token, projectId: f.projectId, callName: "Weekly", startedAt: Date.parse("2026-10-19T09:00:00Z"), minutes: 22,
      keyPoints: ["Launch slips a week"], decisions: ["Ship web first"], actionItems: [{ title: "Fix the signup email", owner: "Sam" }, { title: "Draft the launch post" }, { title: "  " }],
    });
    const latest = await f.t.query(api.callNotes.latest, { sessionToken: f.owner.token, projectId: f.projectId });
    expect(latest).toMatchObject({ _id: noteId, callName: "Weekly", chiefName: "Ada", canCreate: true, actionItems: [{ title: "Fix the signup email", owner: "Sam" }, { title: "Draft the launch post" }] });
    expect(await f.t.run(async (ctx) => (await ctx.db.get(noteId))?.transcript ?? null)).toBeNull();

    const created = await f.t.mutation(api.callNotes.createIssues, { sessionToken: f.member.token, noteId, indexes: [0, 5] });
    expect(created).toHaveLength(1);
    const again = await f.t.mutation(api.callNotes.createIssues, { sessionToken: f.member.token, noteId, indexes: [0, 1] });
    expect(again).toHaveLength(1);
    const tasks = await f.t.run(async (ctx) => Promise.all([...created, ...again].map((id) => ctx.db.get(id))));
    const draft = f.columns.find((column) => column.isDraft)!;
    expect(tasks.map((task) => [task?.title, task?.columnId, task?.labels])).toEqual([
      ["Fix the signup email", draft._id, ["agent:ada"]],
      ["Draft the launch post", draft._id, ["agent:ada"]],
    ]);
    expect(tasks[0]?.description).toContain("Owner named in the call: Sam.");
    expect(tasks[0]?.description).toContain("- Ship web first");

    await f.t.mutation(api.callNotes.dismiss, { sessionToken: f.member.token, noteId });
    expect(await f.t.query(api.callNotes.latest, { sessionToken: f.owner.token, projectId: f.projectId })).toBeNull();
  });
});

describe("desktop runners against the real functions", () => {
  const cloudFor = (f: Fixture, sessionToken: string) => ({
    query: (name: string, args: Record<string, unknown>) => f.t.query(makeFunctionReference<"query">(name), { sessionToken, ...args }),
    mutation: (name: string, args: Record<string, unknown>) => f.t.mutation(makeFunctionReference<"mutation">(name), { sessionToken, ...args }),
  });

  test("a member's desktop claims the Chief heartbeat, writes the note with the cheap model and posts it once", async () => {
    const f = await fixture();
    await f.t.mutation(api.chiefHeartbeat.configure, { sessionToken: f.owner.token, projectId: f.projectId, enabled: true, intervalHours: 4, staleDays: 3 });
    const todo = f.columns.find((column) => column.title === "Todo")!;
    const taskId = await f.t.mutation(api.tasks.createTask, { sessionToken: f.owner.token, projectId: f.projectId, columnId: todo._id, title: "Untouched login bug", priority: "high", assignedToEmail: f.owner.email, dueDate: "2026-12-31" });
    await f.t.run(async (ctx) => { await ctx.db.patch(taskId, { updatedAt: Date.now() - 6 * DAY }); });
    const prompts: string[] = [];
    const deps = {
      cloud: cloudFor(f, f.member.token),
      agents: () => [{ teamId: f.teamId, agentId: f.chiefId, botId: "local-chief" }],
      quickText: async (_botId: string, prompt: string) => { prompts.push(prompt); return "Untouched login bug has sat in Todo for 6 days: pick it up or close it."; },
    };
    expect(await runChiefHeartbeats(deps)).toBe(1);
    expect(prompts[0]).toContain("- Stale 6d in Todo: Untouched login bug");
    expect(await runChiefHeartbeats(deps)).toBe(0);
    const messages = await f.t.run(async (ctx) => ctx.db.query("agentThreadMessages").collect());
    expect(messages.map((row) => row.text)).toEqual(["Untouched login bug has sat in Todo for 6 days: pick it up or close it."]);
  });

  test("origin_standup publishes for an admin and only previews for a member", async () => {
    const f = await fixture();
    const todo = f.columns.find((column) => column.title === "Todo")!;
    await f.t.mutation(api.tasks.createTask, { sessionToken: f.owner.token, projectId: f.projectId, columnId: todo._id, title: "Wire the billing form", priority: "high", assignedToEmail: f.owner.email, dueDate: "2026-12-31" });
    const tool = (token: string) => standupTools(async () => [{ client: cloudFor(f, token), sessionToken: token, projectId: f.projectId, projectName: "Rocket", teamId: f.teamId }]).origin_standup!({}, null);
    const member = await tool(f.member.token);
    expect(member.text).toContain("Rocket, last 24 hours (Ada's standup):");
    expect(member.text).toContain("- Wire the billing form → Todo");
    expect(member.text).not.toContain("Inbox");
    expect(await f.t.run(async (ctx) => (await ctx.db.query("standupDigests").collect()).length)).toBe(0);
    const owner = await tool(f.owner.token);
    expect(owner.text).toContain("Also posted to the project members' Inbox.");
    expect(await f.t.run(async (ctx) => (await ctx.db.query("standupDigests").collect()).length)).toBe(1);
  });
});
