/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const sessionToken = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Owner", email: "order@test.dev", role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Order" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Order" });
  const { columns } = await t.query(api.tasks.board, { sessionToken, projectId });
  const todo = columns[1]!._id;
  const doing = columns[2]!._id;
  const create = (columnId: Id<"columns">, title: string) => t.mutation(api.tasks.createTask, { sessionToken, projectId, columnId, title, priority: "medium", assignedToEmail: "order@test.dev", dueDate: "2026-12-31" });
  const titles = async (columnId: Id<"columns">) => (await t.query(api.tasks.board, { sessionToken, projectId })).tasks.filter(task => task.columnId === columnId).map(task => task.title);
  const move = (taskId: Id<"tasks">, columnId: Id<"columns">, beforeTaskId?: Id<"tasks">) => t.mutation(api.tasks.moveTask, { sessionToken, projectId, taskId, columnId, beforeTaskId });
  return { t, todo, doing, create, titles, move };
}

describe("moveTask ordering", () => {
  test("reorders within a column and moves between columns", async () => {
    const f = await fixture();
    const a = await f.create(f.todo, "A");
    const b = await f.create(f.todo, "B");
    const c = await f.create(f.todo, "C");
    await f.move(c, f.todo, a);
    expect(await f.titles(f.todo)).toEqual(["C", "A", "B"]);
    await f.move(a, f.todo);
    expect(await f.titles(f.todo)).toEqual(["C", "B", "A"]);
    await f.move(b, f.doing);
    const d = await f.create(f.doing, "D");
    await f.move(c, f.doing, d);
    expect(await f.titles(f.doing)).toEqual(["B", "C", "D"]);
    expect(await f.titles(f.todo)).toEqual(["A"]);
  });

  test("a drop on the same position writes nothing", async () => {
    const f = await fixture();
    const a = await f.create(f.todo, "A");
    const b = await f.create(f.todo, "B");
    const before = await f.t.run(ctx => ctx.db.get(a));
    await f.move(a, f.todo, b);
    expect(await f.t.run(ctx => ctx.db.get(a))).toEqual(before);
  });

  test("renumbers the column when orders collide", async () => {
    const f = await fixture();
    const ids = [await f.create(f.todo, "A"), await f.create(f.todo, "B"), await f.create(f.todo, "C")];
    await f.t.run(async ctx => { for (const id of ids) await ctx.db.patch(id, { order: 5 }); });
    const x = await f.create(f.doing, "X");
    await f.move(x, f.todo, ids[1]);
    expect(await f.titles(f.todo)).toEqual(["A", "X", "B", "C"]);
    const orders = await f.t.run(async ctx => Promise.all([...ids, x].map(async id => (await ctx.db.get(id))!.order)));
    expect(new Set(orders).size).toBe(4);
  });
});
