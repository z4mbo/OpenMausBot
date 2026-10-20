/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { createSession } from "./lib/auth";
import { STUDIO_WORKFLOW_TEMPLATES } from "../../shared/studio-workflow";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

async function fixture() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: email.split("@")[0]!, email, role: "user", status: "active", passwordHash: "unused", salt: "unused", iterations: 1, createdAt: 1, updatedAt: 1 });
    return createSession(ctx, userId);
  });
  const owner = await user("owner@flows.test");
  const member = await user("member@flows.test");
  const outsider = await user("outsider@flows.test");
  const { teamId } = await t.mutation(api.workspaces.create, { sessionToken: owner, name: "Flows" });
  const projectId = await t.mutation(api.projects.create, { sessionToken: owner, teamId, name: "Launch" });
  const invite = await t.mutation(api.workspaces.createInvite, { sessionToken: owner, teamId, role: "member", email: "member@flows.test" });
  await t.mutation(api.workspaces.acceptInvite, { sessionToken: member, token: invite.token });
  await t.mutation(api.members.addWorkspaceMember, { sessionToken: owner, projectId, email: "member@flows.test", role: "member" });
  return { t, owner, member, outsider, projectId };
}

const graph = STUDIO_WORKFLOW_TEMPLATES[1]!.graph;

describe("Studio workflows", () => {
  test("the team saves, lists and replaces a workflow; outsiders cannot", async () => {
    const f = await fixture();
    const workflowId = await f.t.mutation(api.studioWorkflows.save, { sessionToken: f.member, projectId: f.projectId, name: "  Avatar  ", graph });
    await expect(f.t.mutation(api.studioWorkflows.save, { sessionToken: f.outsider, projectId: f.projectId, name: "x", graph })).rejects.toThrow();
    await f.t.mutation(api.studioWorkflows.save, { sessionToken: f.owner, projectId: f.projectId, workflowId, name: "Avatar v2", description: "for launch", graph });
    const rows = await f.t.query(api.studioWorkflows.list, { sessionToken: f.member, projectId: f.projectId });
    expect(rows).toEqual([expect.objectContaining({ _id: workflowId, name: "Avatar v2", description: "for launch", updatedByName: "owner" })]);
    await expect(f.t.mutation(api.studioWorkflows.save, { sessionToken: f.owner, projectId: f.projectId, name: "Broken", graph: { nodes: graph.nodes, edges: [{ id: "e", from: "gone", fromPort: "text", to: "m1", toPort: "prompt" }] } })).rejects.toThrow(/missing node/);
    await f.t.mutation(api.studioWorkflows.remove, { sessionToken: f.member, projectId: f.projectId, workflowId });
    expect(await f.t.query(api.studioWorkflows.list, { sessionToken: f.member, projectId: f.projectId })).toEqual([]);
  });

  test("only the starter records progress; any editor can stop a run", async () => {
    const f = await fixture();
    const runId = await f.t.mutation(api.studioWorkflows.startRun, { sessionToken: f.member, projectId: f.projectId, name: "Avatar", graph, agentName: "Designer" });
    const started = await f.t.query(api.studioWorkflows.getRun, { sessionToken: f.owner, projectId: f.projectId, runId });
    expect(started).toMatchObject({ status: "running", agentName: "Designer", createdByName: "member" });
    expect(started.nodes.every((node: { status: string }) => node.status === "waiting")).toBe(true);
    await expect(f.t.mutation(api.studioWorkflows.updateRun, { sessionToken: f.owner, projectId: f.projectId, runId, node: { nodeId: "p1", status: "done" } })).rejects.toThrow(/Only the member/);
    await f.t.mutation(api.studioWorkflows.updateRun, { sessionToken: f.member, projectId: f.projectId, runId, node: { nodeId: "m1", status: "done", output: { url: "https://v3.fal.media/a.png", kind: "image" } } });
    await expect(f.t.mutation(api.studioWorkflows.removeRun, { sessionToken: f.owner, projectId: f.projectId, runId })).rejects.toThrow(/Stop the run/);
    await f.t.mutation(api.studioWorkflows.cancelRun, { sessionToken: f.owner, projectId: f.projectId, runId });
    await f.t.mutation(api.studioWorkflows.updateRun, { sessionToken: f.member, projectId: f.projectId, runId, status: "done" });
    const run = await f.t.query(api.studioWorkflows.getRun, { sessionToken: f.owner, projectId: f.projectId, runId });
    expect(run.status).toBe("cancelled");
    expect(run.nodes.find((node: { nodeId: string }) => node.nodeId === "m1")).toMatchObject({ status: "done" });
    expect(run.nodes.find((node: { nodeId: string }) => node.nodeId === "o1")).toMatchObject({ status: "cancelled" });
    expect(await f.t.query(api.studioWorkflows.runs, { sessionToken: f.owner, projectId: f.projectId })).toHaveLength(1);
    await f.t.mutation(api.studioWorkflows.removeRun, { sessionToken: f.owner, projectId: f.projectId, runId });
    expect(await f.t.query(api.studioWorkflows.runs, { sessionToken: f.owner, projectId: f.projectId })).toEqual([]);
  });
});
