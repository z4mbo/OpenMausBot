/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { createSession } from "./lib/auth";
import { nextJourneyStep } from "../../shared/origin-journey";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const DAY = 86_400_000;

async function fixture() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("owner@test.dev");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner.token, name: "Pulse" });
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner.token, teamId, name: "Rocket" });
  const columns = await t.run((ctx) => ctx.db.query("columns").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect());
  const todo = columns.find((column) => !column.isDraft && !column.isDone)!._id;
  return { t, owner, teamId, projectId, todo, user };
}

describe("pulse", () => {
  test("an empty project sits at Idea with zeroed series of the range's length", async () => {
    const f = await fixture();
    const pulse = await f.t.query(api.pulse.project, { sessionToken: f.owner.token, projectId: f.projectId, range: 7 });
    expect(pulse.stage).toBe("idea");
    expect(pulse.reached).toMatchObject({ idea: true, build: false });
    expect(pulse.days).toHaveLength(7);
    expect(pulse.build.doneSeries).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(pulse.attention).toEqual([]);
  });

  test("counts issues, completions, cycle time and PRs waiting, and keeps Draft ideas apart", async () => {
    const f = await fixture();
    const base = { sessionToken: f.owner.token, projectId: f.projectId, priority: "medium" as const, assignedToEmail: "owner@test.dev", dueDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10) };
    await f.t.mutation(api.tasks.createTask, { ...base, title: "An idea" });
    const shipped = await f.t.mutation(api.tasks.createTask, { ...base, title: "Ship it", columnId: f.todo });
    await f.t.mutation(api.tasks.createTask, { ...base, title: "Still open", columnId: f.todo });
    await f.t.run((ctx) => ctx.db.patch(shipped, { createdAt: Date.now() - 2 * DAY }));
    await f.t.mutation(api.tasks.updateTask, { sessionToken: f.owner.token, projectId: f.projectId, taskId: shipped, done: true });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("taskPullRequests", { projectId: f.projectId, taskId: shipped, requesterUserId: f.owner.userId, number: 7, url: "https://github.com/o/r/pull/7", branch: "b", state: "open", checks: "success", review: "approved", updatedAt: Date.now() });
      await ctx.db.insert("taskPullRequests", { projectId: f.projectId, taskId: shipped, requesterUserId: f.owner.userId, number: 6, url: "https://github.com/o/r/pull/6", branch: "a", state: "merged", checks: "success", review: "approved", updatedAt: Date.now() });
    });

    const pulse = await f.t.query(api.pulse.project, { sessionToken: f.owner.token, projectId: f.projectId, range: 7 });
    expect(pulse.idea.ideas).toBe(1);
    expect(pulse.build.open).toBe(1);
    expect(pulse.build.done).toEqual({ value: 1, previous: 0 });
    expect(pulse.build.doneSeries[pulse.build.doneSeries.length - 1]).toBe(1);
    expect(pulse.build.opened.value).toBe(2);
    expect(pulse.build.cycleHours).toBeGreaterThanOrEqual(47);
    expect(pulse.build).toMatchObject({ prsWaiting: 1, prsApproved: 1 });
    expect(pulse.stage).toBe("build");
    expect(pulse.attention).toEqual([{ kind: "prs", count: 1, tone: "warn" }]);
  });

  test("agent runs, spend against the project budget and failures need attention", async () => {
    const f = await fixture();
    const now = Date.now();
    await f.t.run(async (ctx) => {
      const membership = (await ctx.db.query("teamMembers").withIndex("by_team", (q) => q.eq("teamId", f.teamId)).first())!;
      const agentId = await ctx.db.insert("workspaceAgents", { teamId: f.teamId, createdBy: f.owner.userId, name: "Atlas", avatarSeed: "a", avatarColor: "green", instructions: "", engine: "claude", model: "m", effort: "low", skills: [], approvalMode: "ask", destructiveMode: "ask", disabled: false, projectId: f.projectId, createdAt: now, updatedAt: now });
      const run = (status: "succeeded" | "failed" | "running", costUsd: number) => ctx.db.insert("workspaceAgentRuns", {
        teamId: f.teamId, projectId: f.projectId, requesterUserId: f.owner.userId, requesterMembershipId: membership._id, actorAgentId: agentId as Id<"workspaceAgents">,
        status, task: "Work", engine: "claude", model: "m", effort: "low", depth: 0, eventSequence: 0, lastEventAt: now, usage: { input: 1, output: 1, costUsd }, endedAt: now, createdAt: now, updatedAt: now,
      });
      await run("succeeded", 4);
      await run("failed", 1);
      await run("running", 0);
      await ctx.db.insert("agentBudgets", { teamId: f.teamId, projectId: f.projectId, monthlyUsd: 5, updatedBy: f.owner.userId, updatedAt: now });
      await ctx.db.insert("budgetSpend", { teamId: f.teamId, projectId: f.projectId, month: new Date(now).toISOString().slice(0, 7), costUsd: 4.5, runs: 2, updatedAt: now });
    });
    const pulse = await f.t.query(api.pulse.project, { sessionToken: f.owner.token, projectId: f.projectId, range: 7 });
    expect(pulse.team).toMatchObject({ runs: { value: 3, previous: 0 }, succeeded: 1, failed: 1, live: 1, agents: 1, spendRangeUsd: 5, spendMonthUsd: 4.5, budgetUsd: 5, budgetLevel: "warn" });
    expect(pulse.stage).toBe("build");
    expect(pulse.attention.map((item) => item.kind)).toEqual(["failed", "budget"]);
  });

  test("only members read a project's pulse, and the workspace list holds the projects each person can open", async () => {
    const f = await fixture();
    const other = await f.t.mutation(api.projects.create, { sessionToken: f.owner.token, teamId: f.teamId, name: "Apollo" });
    const outsider = await f.user("outsider@test.dev");
    await expect(f.t.query(api.pulse.project, { sessionToken: outsider.token, projectId: f.projectId, range: 7 })).rejects.toThrow(/access/);
    await expect(f.t.query(api.pulse.projects, { sessionToken: outsider.token, teamId: f.teamId })).rejects.toThrow(/access/);
    const listed = await f.t.query(api.pulse.projects, { sessionToken: f.owner.token, teamId: f.teamId });
    expect(listed.projects.map((row) => row._id)).toEqual([other, f.projectId]);

    const member = await f.user("member@test.dev");
    await f.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("teamMembers", { teamId: f.teamId, userId: member.userId, email: "member@test.dev", name: "m", role: "member", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("members", { projectId: other, userId: member.userId, email: "member@test.dev", name: "m", role: "member", status: "active", createdAt: now, updatedAt: now });
    });
    expect((await f.t.query(api.pulse.projects, { sessionToken: member.token, teamId: f.teamId })).projects.map((row) => row.name)).toEqual(["Apollo"]);
  });

  test("journey facts walk a project from Brief to a published release, and its next step follows the furthest thing made", async () => {
    const f = await fixture();
    const facts = () => f.t.query(api.pulse.journey, { sessionToken: f.owner.token, projectId: f.projectId });
    const step = async () => nextJourneyStep(await facts()).id;
    expect(await facts()).toMatchObject({ name: "Rocket", brief: false, issuesOpen: 0, issuesDone: 0, shipped: false });
    expect(await step()).toBe("brief");

    await f.t.mutation(api.projectDocs.save, { sessionToken: f.owner.token, projectId: f.projectId, title: "Brief", content: "## Problem", tags: ["brief"] });
    const base = { sessionToken: f.owner.token, projectId: f.projectId, priority: "medium" as const, assignedToEmail: "owner@test.dev", dueDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10) };
    await f.t.mutation(api.tasks.createTask, { ...base, title: "An idea" });
    expect(await facts()).toMatchObject({ drafts: 1, issuesOpen: 0 });
    expect(await step()).toBe("issues");
    const issue = await f.t.mutation(api.tasks.createTask, { ...base, title: "Sign-up", columnId: f.todo });
    expect(await step()).toBe("build");
    await f.t.mutation(api.tasks.updateTask, { sessionToken: f.owner.token, projectId: f.projectId, taskId: issue, done: true });
    expect(await facts()).toMatchObject({ issuesOpen: 0, issuesDone: 1 });
    expect(await step()).toBe("ship");

    await f.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("shipReleases", { projectId: f.projectId, tag: "v1.0.0", title: "v1", notes: "", status: "published", pulls: [], announce: false, createdBy: f.owner.userId, createdAt: now, updatedAt: now, publishedAt: now });
    });
    expect(await facts()).toMatchObject({ shipped: true });
    expect(await step()).toBe("feedback");

    const stranger = await f.user("stranger@test.dev");
    await expect(f.t.query(api.pulse.journey, { sessionToken: stranger.token, projectId: f.projectId })).rejects.toThrow();
  });
});
