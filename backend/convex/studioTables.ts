import { defineTable } from "convex/server";
import { v } from "convex/values";

export const studioMode = v.union(v.literal("image"), v.literal("video"), v.literal("audio"), v.literal("edit"));
export const studioKind = v.union(v.literal("image"), v.literal("video"), v.literal("audio"));
export const studioStatus = v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("failed"));
export const studioOutput = v.object({ url: v.string(), kind: studioKind, contentType: v.optional(v.string()) });

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
    status: studioStatus,
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
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  }).index("by_projectId_and_createdAt", ["projectId", "createdAt"]),
};
