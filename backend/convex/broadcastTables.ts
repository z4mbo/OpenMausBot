import { defineTable } from "convex/server";
import { v } from "convex/values";

export const broadcastChannel = v.union(v.literal("x"), v.literal("bluesky"), v.literal("linkedin"), v.literal("facebook"), v.literal("instagram"), v.literal("tiktok"));

export const broadcastStatus = v.union(v.literal("draft"), v.literal("scheduled"), v.literal("publishing"), v.literal("published"), v.literal("failed"));

/** One channel of a post: its own text and, once tried, how publishing there went. */
export const broadcastVariant = v.object({
  channel: broadcastChannel,
  text: v.string(),
  result: v.optional(v.union(v.literal("published"), v.literal("failed"))),
  url: v.optional(v.string()),
  error: v.optional(v.string()),
  publishedAt: v.optional(v.number()),
});

export const broadcastTables = {
  broadcastPosts: defineTable({
    projectId: v.id("projects"),
    variants: v.array(broadcastVariant),
    assetIds: v.array(v.id("designAssets")),
    status: broadcastStatus,
    scheduledAt: v.optional(v.number()),
    authorUserId: v.id("users"),
    /** Set when an agent wrote or last changed the post; such a post publishes only after a person approves it. */
    agentName: v.optional(v.string()),
    agentBotId: v.optional(v.string()),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    /** The member whose app publishes the post with their own channel keys. */
    publisherUserId: v.optional(v.id("users")),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"])
    .index("by_status_and_scheduledAt", ["status", "scheduledAt"])
    .index("by_status_and_claimedAt", ["status", "claimedAt"]),
};
