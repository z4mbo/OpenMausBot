import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { studioGraph, studioKind, studioRunStatus } from "./studioTables";
import { WORKFLOW_EDGES_MAX, WORKFLOW_NODES_MAX } from "../../shared/studio-workflow";

type Ctx = QueryCtx | MutationCtx;
type Graph = Doc<"studioWorkflows">["graph"];

const WORKFLOWS_SHOWN = 60;
const RUNS_SHOWN = 30;
const NAME_MAX = 120;
const CAPTION_MAX = 2_000;

async function editorOf(ctx: Ctx, projectId: Id<"projects">, sessionToken: string) {
  const access = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  return access;
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function checkGraph(graph: Graph): Graph {
  if (graph.nodes.length > WORKFLOW_NODES_MAX || graph.edges.length > WORKFLOW_EDGES_MAX) throw new Error(`A workflow holds at most ${WORKFLOW_NODES_MAX} nodes`);
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length || graph.nodes.some((node) => !node.id || node.id.length > 40)) throw new Error("Node ids must be unique");
  if (graph.edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))) throw new Error("A link points at a missing node");
  const text = JSON.stringify(graph);
  if (text.length > 120_000) throw new Error("The workflow is too large");
  return graph;
}

async function runOf(ctx: Ctx, projectId: Id<"projects">, runId: Id<"studioWorkflowRuns">) {
  const run = await ctx.db.get(runId);
  if (!run || run.projectId !== projectId) throw new Error("Run not found");
  return run;
}

export const list = query({
  args: { projectId: v.id("projects"), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return await ctx.db.query("studioWorkflows").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(WORKFLOWS_SHOWN);
  },
});

export const get = query({
  args: { projectId: v.id("projects"), sessionToken: v.string(), workflowId: v.id("studioWorkflows") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow || workflow.projectId !== args.projectId) throw new Error("Workflow not found");
    return workflow;
  },
});

/** Creates a workflow, or replaces one's name and graph with workflowId. */
export const save = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), workflowId: v.optional(v.id("studioWorkflows")), name: v.string(), description: v.optional(v.string()), graph: studioGraph },
  returns: v.id("studioWorkflows"),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    const name = clip(args.name.trim() || "Untitled workflow", NAME_MAX);
    const graph = checkGraph(args.graph);
    const now = Date.now();
    const fields = { name, description: args.description?.trim() ? clip(args.description.trim(), 400) : undefined, graph, updatedByName: user.name || user.email, updatedAt: now };
    let id = args.workflowId;
    if (id) {
      const existing = await ctx.db.get(id);
      if (!existing || existing.projectId !== args.projectId) throw new Error("Workflow not found");
      await ctx.db.patch(id, fields);
    } else {
      id = await ctx.db.insert("studioWorkflows", { projectId: args.projectId, createdBy: user._id, createdAt: now, ...fields });
    }
    await touchProject(ctx, args.projectId);
    return id;
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), workflowId: v.id("studioWorkflows") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    const workflow = await ctx.db.get(args.workflowId);
    if (!workflow || workflow.projectId !== args.projectId) throw new Error("Workflow not found");
    await ctx.db.delete(args.workflowId);
    return null;
  },
});

/** The project's newest runs, or one workflow's. */
export const runs = query({
  args: { projectId: v.id("projects"), sessionToken: v.string(), workflowId: v.optional(v.id("studioWorkflows")) },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const newest = ctx.db.query("studioWorkflowRuns").withIndex("by_projectId_and_createdAt", (q) => q.eq("projectId", args.projectId)).order("desc");
    return await (args.workflowId ? newest.filter((q) => q.eq(q.field("workflowId"), args.workflowId)) : newest).take(RUNS_SHOWN);
  },
});

export const getRun = query({
  args: { projectId: v.id("projects"), sessionToken: v.string(), runId: v.id("studioWorkflowRuns") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return await runOf(ctx, args.projectId, args.runId);
  },
});

export const startRun = mutation({
  args: {
    projectId: v.id("projects"), sessionToken: v.string(), workflowId: v.optional(v.id("studioWorkflows")), name: v.string(), graph: studioGraph,
    agentName: v.optional(v.string()), caption: v.optional(v.string()),
  },
  returns: v.id("studioWorkflowRuns"),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    if (args.workflowId) {
      const workflow = await ctx.db.get(args.workflowId);
      if (!workflow || workflow.projectId !== args.projectId) throw new Error("Workflow not found");
    }
    const graph = checkGraph(args.graph);
    const now = Date.now();
    const id = await ctx.db.insert("studioWorkflowRuns", {
      projectId: args.projectId, workflowId: args.workflowId, name: clip(args.name.trim() || "Workflow", NAME_MAX), graph, status: "running",
      nodes: graph.nodes.map((node) => ({ nodeId: node.id, status: "waiting" as const })), createdBy: user._id, createdByName: user.name || user.email,
      agentName: args.agentName ? clip(args.agentName.trim(), 120) : undefined, caption: args.caption?.trim() ? clip(args.caption.trim(), CAPTION_MAX) : undefined,
      createdAt: now, updatedAt: now,
    });
    await touchProject(ctx, args.projectId);
    return id;
  },
});

/** Records one node's progress, or the run's end; only the member whose app executes the run may. */
export const updateRun = mutation({
  args: {
    projectId: v.id("projects"),
    sessionToken: v.string(),
    runId: v.id("studioWorkflowRuns"),
    status: v.optional(studioRunStatus),
    node: v.optional(v.object({
      nodeId: v.string(),
      status: v.union(v.literal("waiting"), v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("skipped"), v.literal("cancelled")),
      generationId: v.optional(v.id("studioGenerations")),
      assetId: v.optional(v.id("designAssets")),
      output: v.optional(v.object({ url: v.string(), kind: studioKind })),
      error: v.optional(v.string()),
    })),
    posts: v.optional(v.array(v.object({ group: v.string(), postId: v.id("broadcastPosts") }))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    const run = await runOf(ctx, args.projectId, args.runId);
    if (run.createdBy !== user._id) throw new Error("Only the member who started this run can update it");
    if (run.status !== "running") return null;
    const now = Date.now();
    const patch: Partial<Doc<"studioWorkflowRuns">> = { updatedAt: now };
    if (args.node) {
      const node = { ...args.node, ...(args.node.error ? { error: clip(args.node.error, 600) } : {}) };
      if (node.output && !/^https:\/\/\S+$/i.test(node.output.url)) throw new Error("Outputs must be https links");
      patch.nodes = run.nodes.map((entry) => (entry.nodeId === node.nodeId ? node : entry));
    }
    if (args.posts) {
      for (const entry of args.posts) {
        const post = await ctx.db.get(entry.postId);
        if (!post || post.projectId !== args.projectId) throw new Error("Post not found");
      }
      patch.posts = args.posts.slice(0, 8).map((entry) => ({ group: entry.group.slice(0, 20), postId: entry.postId }));
    }
    if (args.status && args.status !== "running") {
      patch.status = args.status;
      patch.finishedAt = now;
      patch.nodes = (patch.nodes ?? run.nodes).map((entry) => (entry.status === "waiting" || entry.status === "running" ? { ...entry, status: args.status === "cancelled" ? "cancelled" as const : "skipped" as const } : entry));
    }
    await ctx.db.patch(args.runId, patch);
    return null;
  },
});

/** Any editor may stop a run; the app executing it sees the status and cancels its generations. */
export const cancelRun = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), runId: v.id("studioWorkflowRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    const run = await runOf(ctx, args.projectId, args.runId);
    if (run.status !== "running") return null;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "cancelled", finishedAt: now, updatedAt: now,
      nodes: run.nodes.map((entry) => (entry.status === "waiting" || entry.status === "running" ? { ...entry, status: "cancelled" as const } : entry)),
    });
    return null;
  },
});

export const removeRun = mutation({
  args: { projectId: v.id("projects"), sessionToken: v.string(), runId: v.id("studioWorkflowRuns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, member } = await editorOf(ctx, args.projectId, args.sessionToken);
    const run = await runOf(ctx, args.projectId, args.runId);
    if (run.status === "running") throw new Error("Stop the run first");
    if (run.createdBy !== user._id && member.role !== "owner" && member.role !== "admin") throw new Error("Only its starter or a project admin can delete this run");
    await ctx.db.delete(args.runId);
    return null;
  },
});
