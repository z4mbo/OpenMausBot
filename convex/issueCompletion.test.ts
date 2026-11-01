/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture(withRepository = true) {
  const t = convexTest(schema, modules);
  const email = "owner@completion.test";
  const sessionToken = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Owner", email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Completion" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Completion", ...(withRepository ? { repoUrl: "https://github.com/fixture/completion" } : { githubRepo: "later" }) });
  const scope = { sessionToken, projectId };
  const columns = (await t.query(api.tasks.board, scope)).columns;
  const create = (columnId = columns[1]!._id) => t.mutation(api.tasks.createTask, { ...scope, columnId, title: "Unmirrored issue", priority: "medium", assignedToEmail: email, dueDate: "2026-12-31" });
  const taskId = await create();
  const doneColumnId = await t.run(ctx => ctx.db.insert("columns", { projectId, title: "Done", isDone: true, order: 5, createdAt: 1, updatedAt: 1 }));
  const grant = await t.mutation(api.connectors.createGrant, { sessionToken, teamId, name: "Completion connector", write: true });
  return { t, scope, teamId, taskId, columns, doneColumnId, create, grant };
}

describe("repository issue completion", () => {
  const completions = (f: Awaited<ReturnType<typeof fixture>>) => f.t.run(ctx => ctx.db.query("taskCompletions").collect());
  const openCount = async (f: Awaited<ReturnType<typeof fixture>>) => (await f.t.query(api.projects.get, f.scope)).openIssueCount ?? 0;

  test.each(["Todo", "Draft"] as const)("an unmirrored %s issue completes without a pull request, by hand or through a connector", async column => {
    const f = await fixture();
    const taskId = column === "Draft" ? await f.create(f.columns[0]!._id) : f.taskId;
    const before = await openCount(f);
    await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId, done: true });
    expect((await f.t.query(api.tasks.details, { ...f.scope, taskId })).task).toMatchObject({ done: true });
    expect(await openCount(f)).toBe(before - 1);
    expect(await completions(f)).toHaveLength(1);
    await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId, done: false });
    await f.t.mutation(api.connectors.write, { token: f.grant.token, requestId: "complete-without-pr", change: { kind: "update_issue", projectId: f.scope.projectId, taskId, done: true } });
    const task = (await f.t.query(api.tasks.details, { ...f.scope, taskId })).task;
    expect(task).toMatchObject({ done: true });
    expect(task.githubIssueNumber).toBeUndefined();
    expect(await completions(f)).toHaveLength(1);
  });

  test("completing a linked issue keeps its GitHub link and drops a pending reopen request", async () => {
    const f = await fixture();
    await f.t.run(ctx => ctx.db.patch(f.taskId, { githubIssueNumber: 7, githubIssueUrl: "https://github.com/fixture/completion/issues/7", githubIssueState: "closed", githubIssueReopenRequested: true }));
    await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId: f.taskId, done: true });
    const task = (await f.t.query(api.tasks.details, { ...f.scope, taskId: f.taskId })).task;
    expect(task).toMatchObject({ done: true, githubIssueNumber: 7, githubIssueState: "closed" });
    expect(task.githubIssueReopenRequested).toBeUndefined();
  });

  test("an issue created in an existing system Done column starts completed", async () => {
    const f = await fixture();
    const before = await openCount(f);
    const taskId = await f.create(f.doneColumnId);
    expect((await f.t.query(api.tasks.details, { ...f.scope, taskId })).task.done).toBe(true);
    expect(await openCount(f)).toBe(before);
  });

  test("move and column deletion cannot hide an open issue in a system Done column", async () => {
    const f = await fixture();
    await expect(f.t.mutation(api.tasks.moveTask, { ...f.scope, taskId: f.taskId, columnId: f.doneColumnId })).rejects.toThrow("Complete");
    await expect(f.t.mutation(api.tasks.deleteColumn, { ...f.scope, columnId: f.columns[1]!._id, moveToColumnId: f.doneColumnId })).rejects.toThrow("Complete");
    const task = (await f.t.query(api.tasks.details, { ...f.scope, taskId: f.taskId })).task;
    expect(task).toMatchObject({ columnId: f.columns[1]!._id, done: false });
  });

  test("moving a completed issue to Draft reopens it as a draft", async () => {
    const f = await fixture();
    await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId: f.taskId, done: true });
    const before = await openCount(f);
    await f.t.mutation(api.tasks.moveTask, { ...f.scope, taskId: f.taskId, columnId: f.columns[0]!._id });
    expect((await f.t.query(api.tasks.details, { ...f.scope, taskId: f.taskId })).task).toMatchObject({ columnId: f.columns[0]!._id, done: false });
    expect(await openCount(f)).toBe(before + 1);
    await f.t.mutation(api.tasks.moveTask, { ...f.scope, taskId: f.taskId, columnId: f.columns[0]!._id });
    expect(await openCount(f)).toBe(before + 1);
  });

  test("local-only projects can still complete and reopen issues", async () => {
    const f = await fixture(false);
    await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId: f.taskId, done: true });
    expect((await f.t.query(api.tasks.details, { ...f.scope, taskId: f.taskId })).task.done).toBe(true);
    await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId: f.taskId, done: false });
    expect((await f.t.query(api.tasks.details, { ...f.scope, taskId: f.taskId })).task.done).toBe(false);
    expect((await f.t.query(api.tasks.details, { ...f.scope, taskId: await f.create(f.doneColumnId) })).task.done).toBe(true);
  });
});
