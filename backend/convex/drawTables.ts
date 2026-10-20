import { defineTable } from "convex/server";
import { v } from "convex/values";

const mention = v.object({ kind: v.union(v.literal("member"), v.literal("agent")), id: v.string(), name: v.string() });

export const drawTables = {
  /** A comment pinned to a canvas spot or a node (x, y relative to the node), or a reply when `parentId` is set. */
  canvasComments: defineTable({
    teamId: v.id("teams"),
    canvasId: v.id("canvases"),
    parentId: v.optional(v.id("canvasComments")),
    nodeId: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    authorId: v.id("users"),
    authorName: v.string(),
    agentName: v.optional(v.string()),
    body: v.string(),
    mentions: v.array(mention),
    resolved: v.boolean(),
    createdAt: v.number(),
  }).index("by_canvas", ["canvasId", "createdAt"]),
  /** A named snapshot of a canvas; its rows live in canvasVersionChunks. */
  canvasVersions: defineTable({
    teamId: v.id("teams"),
    canvasId: v.id("canvases"),
    name: v.string(),
    nodeCount: v.number(),
    authorName: v.string(),
    agentName: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_canvas", ["canvasId", "createdAt"]),
  canvasVersionChunks: defineTable({ versionId: v.id("canvasVersions"), order: v.number(), rows: v.array(v.string()) }).index("by_version", ["versionId", "order"]),
  /** An issue designed on a canvas frame. */
  designLinks: defineTable({
    projectId: v.id("projects"),
    taskId: v.id("tasks"),
    canvasId: v.id("canvases"),
    frameId: v.string(),
    frameName: v.string(),
    agentName: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("review"), v.literal("approved")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_task", ["taskId"]).index("by_canvas", ["canvasId"]),
};
