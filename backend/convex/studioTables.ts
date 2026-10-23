import { defineTable } from "convex/server";
import { v } from "convex/values";

export const studioMode = v.union(v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("edit"));
export const studioKind = v.union(v.literal("image"), v.literal("video"), v.literal("audio"));
export const studioStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("cancelled"));
export const studioOutput = v.object({ url: v.string(), kind: studioKind, contentType: v.optional(v.string()) });
export const studioCharacterKind = v.union(v.literal("character"), v.literal("product"), v.literal("style"));
export const studioParams = v.record(v.string(), v.union(v.string(), v.number(), v.boolean()));

export const studioGraph = v.object({
  nodes: v.array(v.object({
    id: v.string(),
    type: v.union(v.literal("prompt"), v.literal("asset"), v.literal("model"), v.literal("output")),
    x: v.number(),
    y: v.number(),
    params: studioParams,
  })),
  edges: v.array(v.object({ id: v.string(), from: v.string(), fromPort: v.string(), to: v.string(), toPort: v.string() })),
});

export const studioRunStatus = v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("cancelled"));
export const studioRunNode = v.object({
  nodeId: v.string(),
  status: v.union(v.literal("waiting"), v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("skipped"), v.literal("cancelled")),
  generationId: v.optional(v.id("studioGenerations")),
  assetId: v.optional(v.id("designAssets")),
  output: v.optional(v.object({ url: v.string(), kind: studioKind })),
  error: v.optional(v.string()),
});

export const studioTables = {
  studioGenerations: defineTable({
    projectId: v.id("projects"),
    mode: studioMode,
    model: v.string(),
    modelLabel: v.string(),
    kind: studioKind,
    prompt: v.string(),
    aspectRatio: v.optional(v.string()),
    duration: v.optional(v.string()),
    sourceAssetId: v.optional(v.id("designAssets")),
    params: v.optional(studioParams),
    parentId: v.optional(v.id("studioGenerations")),
    action: v.optional(v.string()),
    workflowRunId: v.optional(v.id("studioWorkflowRuns")),
    nodeId: v.optional(v.string()),
    /** A workflow step that only an Output node saves to Assets. */
    intermediate: v.optional(v.boolean()),
    status: studioStatus,
    /** fal's place in its queue while the generation waits. */
    queuePosition: v.optional(v.number()),
    error: v.optional(v.string()),
    /** fal's request id, so the member's app can resume polling after a restart. */
    falRequestId: v.optional(v.string()),
    outputs: v.array(studioOutput),
    saved: v.array(v.object({ index: v.number(), assetId: v.id("designAssets") })),
    /** Outputs picked for Broadcast; the post composer reads these asset ids. */
    broadcast: v.array(v.object({ index: v.number(), assetId: v.id("designAssets"), at: v.number() })),
    /** Only the member whose app runs the generation (with their own fal key) may record its progress. */
    createdBy: v.id("users"),
    createdByName: v.string(),
    agentName: v.optional(v.string()),
    branded: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  }).index("by_projectId_and_createdAt", ["projectId", "createdAt"]),

  studioWorkflows: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    graph: studioGraph,
    createdBy: v.id("users"),
    updatedByName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"]),

  studioWorkflowRuns: defineTable({
    projectId: v.id("projects"),
    workflowId: v.optional(v.id("studioWorkflows")),
    name: v.string(),
    /** The graph as it ran, inputs included. */
    graph: studioGraph,
    status: studioRunStatus,
    nodes: v.array(studioRunNode),
    /** Only the member whose app executes the run may record its progress. */
    createdBy: v.id("users"),
    createdByName: v.string(),
    agentName: v.optional(v.string()),
    /** The text of the Broadcast drafts its Output nodes fill. */
    caption: v.optional(v.string()),
    posts: v.optional(v.array(v.object({ group: v.string(), postId: v.id("broadcastPosts") }))),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_projectId_and_createdAt", ["projectId", "createdAt"]),

  /** A person, product or style saved from reference images, reused by people, workflows and agents. */
  studioCharacters: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    kind: studioCharacterKind,
    description: v.string(),
    referenceAssetIds: v.array(v.id("designAssets")),
    createdBy: v.id("users"),
    createdByName: v.string(),
    agentName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"]),

  /** A generation saved to make again: its model, settings and a prompt whose `[placeholders]` people fill in. */
  studioTemplates: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    description: v.string(),
    mode: studioMode,
    model: v.string(),
    prompt: v.string(),
    params: studioParams,
    /** Example inputs for the model's starting files, in order. */
    sourceAssetIds: v.array(v.id("designAssets")),
    coverAssetId: v.optional(v.id("designAssets")),
    /** fal's link when the cover was never copied into Assets. */
    coverUrl: v.optional(v.string()),
    coverKind: v.optional(studioKind),
    generationId: v.optional(v.id("studioGenerations")),
    createdBy: v.id("users"),
    createdByName: v.string(),
    agentName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"]),
};
