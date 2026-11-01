/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const email = "owner@optional.test";
  const sessionToken = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Owner", email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Optional" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Optional", githubRepo: "later" });
  const scope = { sessionToken, projectId };
  const columns = (await t.query(api.tasks.board, scope)).columns;
  return { t, email, scope, columnId: columns[1]!._id };
}

describe("optional assignee and due date", () => {
  test("an issue can be created without an assignee or due date", async () => {
    const f = await fixture();
    const taskId = await f.t.mutation(api.tasks.createTask, { ...f.scope, columnId: f.columnId, title: "Quick capture", priority: "medium" });
    const task = (await f.t.query(api.tasks.details, { ...f.scope, taskId })).task;
    expect(task.assignedToEmail).toBeUndefined();
    expect(task.dueDate).toBeUndefined();
    const empty = await f.t.mutation(api.tasks.createTask, { ...f.scope, columnId: f.columnId, title: "Empty strings", priority: "low", assignedToEmail: "", dueDate: "" });
    expect((await f.t.query(api.tasks.details, { ...f.scope, taskId: empty })).task).toMatchObject({ title: "Empty strings", priority: "low" });
    expect((await f.t.query(api.tasks.board, f.scope)).tasks.map(row => row.title)).toEqual(expect.arrayContaining(["Quick capture", "Empty strings"]));
  });

  test("values that are given are still validated", async () => {
    const f = await fixture();
    await expect(f.t.mutation(api.tasks.createTask, { ...f.scope, columnId: f.columnId, title: "Bad date", priority: "medium", dueDate: "2026-02-30" })).rejects.toThrow("Choose a valid due date");
    await expect(f.t.mutation(api.tasks.createTask, { ...f.scope, columnId: f.columnId, title: "Stranger", priority: "medium", assignedToEmail: "nobody@optional.test" })).rejects.toThrow("Choose an active workspace member as assignee");
  });

  test("an update sets and clears the assignee and due date", async () => {
    const f = await fixture();
    const taskId = await f.t.mutation(api.tasks.createTask, { ...f.scope, columnId: f.columnId, title: "Full issue", priority: "high", assignedToEmail: f.email, dueDate: "2026-12-31" });
    const read = async () => (await f.t.query(api.tasks.details, { ...f.scope, taskId })).task;
    expect(await read()).toMatchObject({ assignedToEmail: f.email, assignedToName: "Owner", dueDate: "2026-12-31" });
    await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId, assignedToEmail: "", dueDate: "" });
    const cleared = await read();
    expect(cleared.assignedToEmail).toBeUndefined();
    expect(cleared.assignedToName).toBeUndefined();
    expect(cleared.dueDate).toBeUndefined();
    await f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId, assignedToEmail: f.email, dueDate: "2027-01-04" });
    expect(await read()).toMatchObject({ assignedToEmail: f.email, dueDate: "2027-01-04" });
    await expect(f.t.mutation(api.tasks.updateTask, { ...f.scope, taskId, dueDate: "tomorrow" })).rejects.toThrow("Choose a valid due date");
  });
});
