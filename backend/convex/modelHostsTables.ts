import { defineTable } from "convex/server";
import { v } from "convex/values";

export const modelSourceBilling = v.union(v.literal("subscription"), v.literal("metered"), v.literal("unknown"));
export const modelExecutionStatus = v.union(v.literal("pending"), v.literal("claimed"), v.literal("running"), v.literal("refused"), v.literal("succeeded"), v.literal("failed"), v.literal("interrupted"), v.literal("superseded"));
export const hostedModelTarget = v.object({ sourceId: v.id("modelHostSources"), model: v.string(), allowMetered: v.optional(v.boolean()) });
export const modelHostsTables = {
  modelHostSources: defineTable({
    teamId: v.id("teams"), hostId: v.id("agentHosts"), sourceKey: v.string(), provider: v.string(), label: v.string(),
    billing: modelSourceBilling, enabled: v.boolean(), projectIds: v.array(v.id("projects")), workspaceHead: v.boolean(), capacity: v.number(),
    models: v.array(v.string()), availableModels: v.array(v.string()), available: v.boolean(), availabilityAt: v.number(), updatedAt: v.number(),
  }).index("by_hostId_and_sourceKey", ["hostId", "sourceKey"]).index("by_teamId_and_enabled", ["teamId", "enabled"]).index("by_hostId", ["hostId"]),
  modelHostExecutions: defineTable({
    teamId: v.id("teams"), runId: v.id("workspaceAgentRuns"), hostId: v.id("agentHosts"), sourceId: v.id("modelHostSources"), model: v.string(),
    requestKey: v.string(), status: modelExecutionStatus, activityObserved: v.boolean(), safeToRetry: v.boolean(), allowMetered: v.optional(v.boolean()),
    claimId: v.optional(v.string()), leaseHash: v.optional(v.string()), leaseUntil: v.optional(v.number()), startedAt: v.optional(v.number()),
    refusal: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_runId", ["runId"]).index("by_hostId_and_status_and_leaseUntil", ["hostId", "status", "leaseUntil"]).index("by_sourceId_and_status_and_leaseUntil", ["sourceId", "status", "leaseUntil"]),
};
