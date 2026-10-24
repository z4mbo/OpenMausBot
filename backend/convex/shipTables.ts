import { defineTable } from "convex/server";
import { v } from "convex/values";

export const shipProvider = v.union(v.literal("vercel"), v.literal("netlify"), v.literal("cloudflare"), v.literal("github-actions"));
export const shipReleaseStatus = v.union(v.literal("draft"), v.literal("publishing"), v.literal("published"), v.literal("failed"));

export const mergedPull = v.object({
  number: v.number(),
  title: v.string(),
  url: v.string(),
  author: v.optional(v.string()),
  mergedAt: v.number(),
  labels: v.array(v.string()),
});

export const shipTables = {
  shipTargets: defineTable({
    projectId: v.id("projects"),
    provider: shipProvider,
    name: v.string(),
    /** Vercel project id or name, Netlify site id, Cloudflare Pages project name, or the GitHub workflow file. */
    ref: v.string(),
    /** Vercel team id or Cloudflare account id. */
    account: v.optional(v.string()),
    branch: v.string(),
    siteUrl: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),
  shipReleases: defineTable({
    projectId: v.id("projects"),
    tag: v.string(),
    title: v.string(),
    notes: v.string(),
    status: shipReleaseStatus,
    baseTag: v.optional(v.string()),
    pulls: v.array(mergedPull),
    /** Deployed to production once the release is published. */
    targetId: v.optional(v.id("shipTargets")),
    /** Nothing reads this; new releases store false. */
    announce: v.boolean(),
    agentName: v.optional(v.string()),
    agentBotId: v.optional(v.string()),
    createdBy: v.id("users"),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    releaseUrl: v.optional(v.string()),
    deployNote: v.optional(v.string()),
    /** Nothing writes this; stored releases may still carry it. */
    broadcastPostId: v.optional(v.id("broadcastPosts")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    publishedAt: v.optional(v.number()),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"]),
};
