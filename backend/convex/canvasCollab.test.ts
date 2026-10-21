/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";
import { applyCanvasOps } from "../../shared/canvas-ops";
import { encodeNode } from "../../shared/canvas-scene";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
afterEach(() => { vi.unstubAllEnvs(); });

async function fixture() {
  vi.stubEnv("CONVEX_SITE_URL", "https://fixture.convex.site");
  const t = convexTest(schema, modules);
  const [owner, viewer] = await t.run(async ctx => Promise.all(["owner", "viewer"].map(async name => {
    const id = await ctx.db.insert("users", { name, email: `${name}@canvas.test`, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { id, email: `${name}@canvas.test`, token: await createSession(ctx, id) };
  })));
  const sessionToken = owner!.token;
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Acme" });
  await t.run(ctx => ctx.db.insert("teamMembers", { teamId, userId: viewer!.id, email: viewer!.email, name: "viewer", role: "viewer", status: "active", createdAt: 1, updatedAt: 1 }));
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Launch" });
  const canvasId = await t.mutation(api.draw.createCanvas, { sessionToken, projectId, name: "Site" });
  const { changed, created } = applyCanvasOps(new Map(), [{ op: "create", node: { type: "frame", key: "home", name: "Home", w: 400, h: 300 } }]);
  await t.mutation(api.draw.updateElements, { sessionToken, teamId, canvasId, elements: changed.map(encodeNode) });
  return { t, owner: owner!, viewer: viewer!, scope: { sessionToken, teamId, canvasId }, projectId, frameId: created[0]!.id };
}

test("pages default to one page, save with guides and refuse viewers", async () => {
  const { t, scope, viewer } = await fixture();
  expect(await t.query(api.canvasCollab.meta, scope)).toEqual({ pages: [{ id: "page-1", name: "Page 1" }] });
  await t.mutation(api.canvasCollab.setPages, { ...scope, pages: [{ id: "page-1", name: "Home", guides: [{ axis: "x", at: 120 }] }, { id: "page-2", name: "Flows" }] });
  expect((await t.query(api.canvasCollab.meta, scope)).pages.map(page => page.name)).toEqual(["Home", "Flows"]);
  await expect(t.mutation(api.canvasCollab.setPages, { ...scope, sessionToken: viewer.token, pages: [{ id: "page-1", name: "Mine" }] })).rejects.toThrow();
  await expect(t.mutation(api.canvasCollab.setPages, { ...scope, pages: [{ id: "Bad id", name: "x" }] })).rejects.toThrow("Invalid page id");
});

test("comments thread, resolve, notify mentioned members and stay on their canvas", async () => {
  const { t, scope, frameId, viewer, projectId } = await fixture();
  await t.run(ctx => ctx.db.insert("members", { projectId, userId: viewer.id, email: viewer.email, name: "viewer", role: "viewer", status: "active", createdAt: 1, updatedAt: 1 }));
  const root = await t.mutation(api.canvasCollab.addComment, { ...scope, nodeId: frameId, x: 10, y: 20, body: "Tighten the hero", mentions: [{ kind: "member", id: viewer.email, name: "viewer" }, { kind: "agent", id: "bot-1", name: "Atlas" }] });
  await t.mutation(api.canvasCollab.addComment, { ...scope, parentId: root, x: 0, y: 0, body: "On it", mentions: [] });
  const list = await t.query(api.canvasCollab.comments, scope);
  expect(list.map(item => item.body)).toEqual(["Tighten the hero", "On it"]);
  expect(list[1]!.parentId).toBe(root);
  await t.mutation(api.canvasCollab.resolveComment, { ...scope, commentId: root, resolved: true });
  expect((await t.query(api.canvasCollab.comments, scope))[0]!.resolved).toBe(true);
  const mentions = await t.run(ctx => ctx.db.query("notifications").collect());
  expect(mentions.map(row => row.kind)).toEqual(["mention"]);
  await expect(t.mutation(api.canvasCollab.deleteComment, { ...scope, sessionToken: viewer.token, commentId: root })).rejects.toThrow();
  await t.mutation(api.canvasCollab.deleteComment, { ...scope, commentId: root });
  expect(await t.query(api.canvasCollab.comments, scope)).toEqual([]);
});

test("named versions snapshot every live row and read back for restore", async () => {
  const { t, scope } = await fixture();
  const versionId = await t.mutation(api.canvasCollab.saveVersion, { ...scope, name: "Before review" });
  const [listed] = await t.query(api.canvasCollab.versions, scope);
  expect(listed).toMatchObject({ name: "Before review", nodeCount: 1, authorName: "owner" });
  const rows = await t.query(api.canvasCollab.versionRows, { ...scope, versionId });
  expect(JSON.parse(rows[0]!)).toMatchObject({ name: "Home", type: "frame" });
  await t.mutation(api.canvasCollab.deleteVersion, { ...scope, versionId });
  expect(await t.query(api.canvasCollab.versions, scope)).toEqual([]);
});

test("a frame designs an issue of the same project, listed from both sides", async () => {
  const { t, scope, projectId, frameId, owner } = await fixture();
  const taskId = await t.mutation(api.tasks.createTask, { sessionToken: scope.sessionToken, projectId, title: "Design the pricing page", priority: "medium", assignedToEmail: owner.email, dueDate: "2026-12-01" });
  await t.mutation(api.canvasCollab.linkDesign, { ...scope, taskId, frameId, frameName: "Home", agentName: "Atlas", status: "review" });
  const forIssue = await t.query(api.canvasCollab.designsForIssue, { sessionToken: scope.sessionToken, taskId });
  expect(forIssue).toEqual([expect.objectContaining({ frameId, frameName: "Home", canvasName: "Site", status: "review", title: "Design the pricing page" })]);
  expect(await t.query(api.canvasCollab.designsForCanvas, scope)).toHaveLength(1);
  await t.mutation(api.canvasCollab.linkDesign, { ...scope, taskId, frameId, frameName: "Home v2", status: "approved" });
  expect((await t.query(api.canvasCollab.designsForCanvas, scope))[0]).toMatchObject({ frameName: "Home v2", status: "approved" });
});

test("agent presence rows sit beside the person's own cursor", async () => {
  const { t, scope } = await fixture();
  await t.mutation(api.draw.setPresence, { ...scope, x: 1, y: 2, button: "up", selection: ["a"] });
  await t.mutation(api.canvasCollab.agentPresence, { ...scope, agentId: "bot-1", name: "Atlas", x: 50, y: 60 });
  await t.mutation(api.draw.setPresence, { ...scope, x: 3, y: 4, button: "down" });
  const rows = await t.query(api.draw.presence, scope) as { name: string; agentId?: string; x: number; selection?: string[] }[];
  expect(rows.map(row => [row.agentId ?? "person", row.x])).toEqual(expect.arrayContaining([["person", 3], ["bot-1", 50]]));
  await t.mutation(api.canvasCollab.agentPresence, { ...scope, agentId: "bot-1", name: "Atlas", x: 0, y: 0, leave: true });
  expect(await t.query(api.draw.presence, scope)).toHaveLength(1);
});
