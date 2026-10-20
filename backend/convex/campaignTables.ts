import { defineTable } from "convex/server";
import { v } from "convex/values";
import { broadcastChannel } from "./broadcastTables";

export const campaignStatus = v.union(v.literal("planning"), v.literal("running"), v.literal("done"));

/** A published post's numbers on one channel, as the member's app last read them. */
export const campaignMetric = v.object({
  postId: v.id("broadcastPosts"),
  channel: broadcastChannel,
  likes: v.number(),
  reposts: v.number(),
  replies: v.number(),
  impressions: v.optional(v.number()),
  at: v.number(),
});

export const campaignTables = {
  campaigns: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    /** The campaign's `utm_campaign` value. */
    slug: v.string(),
    goal: v.string(),
    audience: v.string(),
    channels: v.array(broadcastChannel),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    budgetNote: v.optional(v.string()),
    status: campaignStatus,
    postIds: v.array(v.id("broadcastPosts")),
    generationIds: v.array(v.id("studioGenerations")),
    /** Known risk: holds links from existing rows to Sales leads; nothing reads it. */
    leadIds: v.array(v.id("pipelineLeads")),
    taskIds: v.array(v.id("tasks")),
    metrics: v.array(campaignMetric),
    metricsAt: v.optional(v.number()),
    createdBy: v.id("users"),
    agentName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"]),
};
