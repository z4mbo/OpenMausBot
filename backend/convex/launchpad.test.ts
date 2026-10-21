/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0]!, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return { userId, token: await createSession(ctx, userId) };
  });
  const owner = await user("ada@test.dev");
  const sessionToken = owner.token;
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken, name: "Launchpad" });
  const projectId = await t.mutation(api.projects.create, { sessionToken, teamId, name: "Idea" });
  const viewer = await user("vic@test.dev");
  await t.run(async (ctx) => {
    await ctx.db.insert("teamMembers", { teamId, userId: viewer.userId, email: "vic@test.dev", name: "vic", role: "viewer", status: "active", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("members", { projectId, userId: viewer.userId, email: "vic@test.dev", name: "vic", role: "viewer", status: "active", createdAt: 1, updatedAt: 1 });
  });
  const issue = (title: string) => t.mutation(api.tasks.createTask, { sessionToken, projectId, title, priority: "medium", assignedToEmail: "ada@test.dev", dueDate: "2030-01-01" });
  return { t, sessionToken, teamId, projectId, viewerToken: viewer.token, issue };
}

describe("project docs", () => {
  test("the Brief lists first, records who saved it and refuses a stale save", async () => {
    const f = await fixture();
    const base = { sessionToken: f.sessionToken, projectId: f.projectId };
    const spec = await f.t.mutation(api.projectDocs.save, { ...base, title: "API spec", content: "# API" });
    const brief = await f.t.mutation(api.projectDocs.save, { ...base, title: "Brief", content: "## Problem\n- [ ] Landing page", tags: ["Brief"], agentName: "Atlas" });
    const { docs, canEdit } = await f.t.query(api.projectDocs.list, base);
    expect(canEdit).toBe(true);
    expect(docs.map((doc) => doc.title)).toEqual(["Brief", "API spec"]);
    expect(docs[0]).toMatchObject({ tags: ["brief"], editedBy: { name: "Atlas", agent: true } });

    await expect(f.t.mutation(api.projectDocs.save, { ...base, title: "Second brief", tags: ["brief"] })).rejects.toThrow(/already has a Brief/);
    const edited = await f.t.mutation(api.projectDocs.save, { ...base, docId: spec.docId, content: "# API v2", baseUpdatedAt: spec.updatedAt });
    await expect(f.t.mutation(api.projectDocs.save, { ...base, docId: spec.docId, content: "# mine", baseUpdatedAt: spec.updatedAt })).rejects.toThrow(/changed since you opened it/);
    const read = await f.t.query(api.projectDocs.get, { ...base, docId: spec.docId });
    expect(read).toMatchObject({ content: "# API v2", updatedAt: edited.updatedAt, editedBy: { name: "ada", agent: false } });
    expect(brief.docId).toBeTruthy();
  });

  test("viewers read but do not edit, and credential notes stay out of Docs", async () => {
    const f = await fixture();
    const { docId } = await f.t.mutation(api.projectDocs.save, { sessionToken: f.sessionToken, projectId: f.projectId, title: "Notes", content: "x" });
    const secret = await f.t.mutation(api.wiki.create, { sessionToken: f.sessionToken, projectId: f.projectId, title: "Stripe login", content: "pw", type: "credential_note", tags: [] });
    const asViewer = { sessionToken: f.viewerToken, projectId: f.projectId };
    const list = await f.t.query(api.projectDocs.list, asViewer);
    expect(list).toMatchObject({ canEdit: false });
    expect(list.docs.map((doc) => doc.title)).toEqual(["Notes"]);
    expect(await f.t.query(api.projectDocs.get, { ...asViewer, docId: secret })).toBeNull();
    await expect(f.t.mutation(api.projectDocs.save, { ...asViewer, docId, content: "y" })).rejects.toThrow(/Edit role required/);
    await expect(f.t.mutation(api.projectDocs.remove, { sessionToken: f.sessionToken, projectId: f.projectId, docId: secret })).rejects.toThrow(/not found/);
  });
});

describe("project milestones", () => {
  test("orders by target day, counts done issues and unlinks on removal", async () => {
    const f = await fixture();
    const base = { sessionToken: f.sessionToken, projectId: f.projectId };
    const launch = await f.t.mutation(api.projectMilestones.save, { ...base, title: "Launch", targetDate: "2026-12-01" });
    const mvp = await f.t.mutation(api.projectMilestones.save, { ...base, title: "MVP", targetDate: "2026-11-10" });
    await f.t.mutation(api.projectMilestones.save, { ...base, title: "Later" });
    await expect(f.t.mutation(api.projectMilestones.save, { ...base, title: "Bad", targetDate: "11/10" })).rejects.toThrow(/valid date/);
    const [one, two, three] = await Promise.all([f.issue("Sign-up"), f.issue("Billing"), f.issue("Launch post")]);
    await f.t.mutation(api.projectMilestones.assign, { ...base, milestoneId: mvp, taskIds: [one, two] });
    await f.t.mutation(api.projectMilestones.assign, { ...base, milestoneId: launch, taskIds: [three] });
    await f.t.mutation(api.tasks.updateTask, { ...base, taskId: one, done: true });

    const { milestones } = await f.t.query(api.projectMilestones.list, base);
    expect(milestones.map((row) => [row.title, row.done, row.total])).toEqual([["MVP", 1, 2], ["Launch", 0, 1], ["Later", 0, 0]]);
    const board = await f.t.query(api.tasks.board, base);
    expect(board.tasks.find((task) => task._id === two)?.milestoneId).toBe(mvp);

    await f.t.mutation(api.projectMilestones.assign, { ...base, milestoneId: null, taskIds: [two] });
    await f.t.mutation(api.projectMilestones.remove, { ...base, milestoneId: launch });
    const after = await f.t.query(api.tasks.board, base);
    expect(after.tasks.every((task) => task.milestoneId === undefined || task.milestoneId === mvp)).toBe(true);
    expect((await f.t.query(api.projectMilestones.list, base)).milestones.map((row) => row.title)).toEqual(["MVP", "Later"]);
  });

  test("refuses issues and milestones of another project, and viewers", async () => {
    const f = await fixture();
    const base = { sessionToken: f.sessionToken, projectId: f.projectId };
    const other = await f.t.mutation(api.projects.create, { sessionToken: f.sessionToken, teamId: f.teamId, name: "Other" });
    const foreignTask = await f.t.mutation(api.tasks.createTask, { sessionToken: f.sessionToken, projectId: other, title: "Elsewhere", priority: "low", assignedToEmail: "ada@test.dev", dueDate: "2030-01-01" });
    const foreignMilestone = await f.t.mutation(api.projectMilestones.save, { sessionToken: f.sessionToken, projectId: other, title: "Theirs" });
    const mvp = await f.t.mutation(api.projectMilestones.save, { ...base, title: "MVP" });
    await expect(f.t.mutation(api.projectMilestones.assign, { ...base, milestoneId: mvp, taskIds: [foreignTask] })).rejects.toThrow(/belong to this project/);
    await expect(f.t.mutation(api.projectMilestones.assign, { ...base, milestoneId: foreignMilestone, taskIds: [] })).rejects.toThrow(/Milestone not found/);
    await expect(f.t.mutation(api.projectMilestones.save, { sessionToken: f.viewerToken, projectId: f.projectId, title: "Nope" })).rejects.toThrow(/Edit role required/);
  });
});
