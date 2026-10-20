/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { createSession } from "./lib/auth";
import { standupPreview } from "./standup";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const NOW = Date.parse("2026-10-20T07:00:00Z");
const HOUR = 3_600_000;

async function fixture() {
  const t = convexTest(schema, modules);
  const sessionToken = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Owner", email: "standup@test.dev", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Standup" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Rocket" });
  const { columns } = await t.query(api.tasks.board, { sessionToken, projectId });
  const create = async (columnId: string, title: string) => t.mutation(api.tasks.createTask, { sessionToken, projectId, columnId: columnId as never, title, priority: "medium", assignedToEmail: "standup@test.dev", dueDate: "2026-12-31" }) as Promise<Id<"tasks">>;
  return { t, sessionToken, teamId, projectId, columns, create };
}

const inbox = async (f: Awaited<ReturnType<typeof fixture>>) =>
  (await f.t.query(api.notifications.list, { sessionToken: f.sessionToken, teamId: f.teamId, unreadOnly: false, paginationOpts: { numItems: 20, cursor: null } })).page;

describe("Chief standup digest", () => {
  test("a quiet project sends nothing", async () => {
    const f = await fixture();
    await f.t.run(async ctx => { for (const task of await ctx.db.query("tasks").collect()) await ctx.db.patch(task._id, { updatedAt: NOW - 48 * HOUR }); });
    await f.t.mutation(internal.standup.runProject, { projectId: f.projectId, now: NOW });
    expect(await inbox(f)).toEqual([]);
  });

  test("collects done and moved issues, PRs approved and waiting for a merge, and blockers, once per day", async () => {
    const f = await fixture();
    const todo = f.columns.find(column => column.title === "Todo")!;
    const draft = f.columns.find(column => column.isDraft)!;
    const shipped = await f.create(todo._id, "Ship the login page");
    const moved = await f.create(todo._id, "Wire the billing form");
    const idea = await f.create(draft._id, "Maybe a dark logo");
    const stale = await f.create(todo._id, "Untouched for days");
    const agentId = await f.t.run(async ctx => {
      const user = (await ctx.db.query("users").first())!;
      const membership = (await ctx.db.query("teamMembers").first())!;
      await ctx.db.patch(shipped, { done: true, updatedAt: NOW - HOUR });
      await ctx.db.insert("taskCompletions", { teamId: f.teamId, projectId: f.projectId, taskId: shipped, completedAt: NOW - HOUR });
      await ctx.db.patch(moved, { updatedAt: NOW - 2 * HOUR });
      await ctx.db.patch(idea, { updatedAt: NOW - 2 * HOUR });
      await ctx.db.patch(stale, { updatedAt: NOW - 72 * HOUR });
      const agent = await ctx.db.insert("workspaceAgents", { teamId: f.teamId, createdBy: user._id, name: "Ada", avatarSeed: "a", avatarColor: "#fff", instructions: "", engine: "claude", model: "m", effort: "e", skills: [], approvalMode: "ask", destructiveMode: "ask", kind: "chief", projectId: f.projectId, disabled: false, createdAt: 1, updatedAt: 1 });
      const run = { teamId: f.teamId, projectId: f.projectId, requesterUserId: user._id, requesterMembershipId: membership._id, actorAgentId: agent, engine: "claude", model: "m", effort: "e", depth: 0, eventSequence: 0, lastEventAt: NOW, createdAt: NOW - 3 * HOUR, updatedAt: NOW - HOUR };
      const waiting = await ctx.db.insert("workspaceAgentRuns", { ...run, status: "waiting_approval", task: "Push the migration" });
      await ctx.db.insert("agentApprovals", { projectId: f.projectId, runId: waiting, requestId: "r1", payload: "{}", outcome: "pending", createdAt: NOW - HOUR });
      await ctx.db.insert("workspaceAgentRuns", { ...run, status: "failed", task: "Run the e2e suite", summary: "Playwright could not start", endedAt: NOW - HOUR });
      await ctx.db.insert("workspaceAgentRuns", { ...run, status: "failed", task: "Old failure", endedAt: NOW - 30 * HOUR, updatedAt: NOW - 30 * HOUR });
      await ctx.db.insert("taskPullRequests", { projectId: f.projectId, taskId: moved, requesterUserId: user._id, number: 7, url: "https://github.com/t/r/pull/7", branch: "b", state: "open", checks: "success", review: "approved", updatedAt: NOW });
      await ctx.db.insert("taskPullRequests", { projectId: f.projectId, taskId: stale, requesterUserId: user._id, number: 8, url: "https://github.com/t/r/pull/8", branch: "c", state: "open", checks: "pending", review: "review_required", updatedAt: NOW });
      return agent;
    });

    await f.t.mutation(internal.standup.runProject, { projectId: f.projectId, now: NOW });
    await f.t.mutation(internal.standup.runProject, { projectId: f.projectId, now: NOW + HOUR });
    const rows = await inbox(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "digest", actorName: "Ada", projectName: "Rocket", available: true, preview: "1 issue done · 1 issue moved · 1 PR waiting for your merge · 2 blockers" });

    const digest = (await f.t.query(api.standup.get, { sessionToken: f.sessionToken, teamId: f.teamId, digestId: rows[0].digestId! }))!;
    expect(digest.chiefName).toBe("Ada");
    expect(digest.completed.map(issue => issue.title)).toEqual(["Ship the login page"]);
    expect(digest.moved.map(issue => [issue.title, issue.column])).toEqual([["Wire the billing form", "Todo"]]);
    expect(digest.waiting).toEqual([expect.objectContaining({ number: 7, checks: "success", title: "Wire the billing form" })]);
    expect(digest.blockers).toEqual([
      expect.objectContaining({ kind: "approval", text: "Push the migration", agentName: "Ada" }),
      expect.objectContaining({ kind: "failed_run", text: "Playwright could not start" }),
    ]);
    expect(agentId).toBeTruthy();
  });

  test("a muted project stays out of that member's Inbox", async () => {
    const f = await fixture();
    await f.t.run(async ctx => {
      const user = (await ctx.db.query("users").first())!;
      await ctx.db.insert("notificationPreferences", { teamId: f.teamId, userId: user._id, assignments: true, comments: true, mentions: true, mutedProjects: [f.projectId], quietStart: "", quietEnd: "", timeZone: "UTC" });
      for (const task of await ctx.db.query("tasks").collect()) await ctx.db.patch(task._id, { updatedAt: NOW - HOUR });
    });
    await f.t.mutation(internal.standup.runProject, { projectId: f.projectId, now: NOW });
    expect(await inbox(f)).toEqual([]);
  });

  test("a project admin can ask for today's standup now", async () => {
    const f = await fixture();
    const todo = f.columns.find(column => column.title === "Todo")!;
    await f.create(todo._id, "Fresh issue");
    expect(await f.t.mutation(api.standup.requestNow, { sessionToken: f.sessionToken, projectId: f.projectId })).not.toBeNull();
    expect((await inbox(f))[0]).toMatchObject({ kind: "digest", actorName: "Chief" });
  });

  test("the preview names only the sections that have something", () => {
    expect(standupPreview({ completed: [], moved: [], waiting: [], blockers: [{ kind: "approval", text: "x" }] })).toBe("1 blocker");
  });
});
