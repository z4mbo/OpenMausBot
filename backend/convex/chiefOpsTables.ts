import { defineTable } from "convex/server";
import { v } from "convex/values";

export const callActionItem = v.object({ title: v.string(), owner: v.optional(v.string()), taskId: v.optional(v.id("tasks")) });
export const heartbeatClaim = v.object({ id: v.string(), userId: v.id("users"), until: v.number(), key: v.string() });

export const chiefOpsTables = {
  /** A monthly spend cap in US dollars on one agent or one project. Past it, the agent's next run is refused. */
  agentBudgets: defineTable({
    teamId: v.id("teams"),
    agentId: v.optional(v.id("workspaceAgents")),
    projectId: v.optional(v.id("projects")),
    monthlyUsd: v.number(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_teamId", ["teamId"]).index("by_agentId", ["agentId"]).index("by_projectId", ["projectId"]),
  /** What finished runs reported spending, per agent or per project and UTC month (`YYYY-MM`). */
  budgetSpend: defineTable({
    teamId: v.id("teams"),
    month: v.string(),
    agentId: v.optional(v.id("workspaceAgents")),
    projectId: v.optional(v.id("projects")),
    costUsd: v.number(),
    runs: v.number(),
    updatedAt: v.number(),
  }).index("by_agentId_and_month", ["agentId", "month"]).index("by_projectId_and_month", ["projectId", "month"]).index("by_teamId_and_month", ["teamId", "month"]),
  /** A project's opt-in Chief self-check, run by a member's desktop while the app is open. */
  chiefHeartbeats: defineTable({
    teamId: v.id("teams"),
    projectId: v.id("projects"),
    enabled: v.boolean(),
    intervalHours: v.number(),
    staleDays: v.number(),
    lastRunAt: v.optional(v.number()),
    lastKey: v.optional(v.string()),
    threadId: v.optional(v.id("agentThreads")),
    claim: v.optional(heartbeatClaim),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]).index("by_teamId", ["teamId"]),
  /** A call's summary and action items; the transcript only when the people in the call kept it. */
  callNotes: defineTable({
    teamId: v.id("teams"),
    projectId: v.id("projects"),
    callName: v.string(),
    createdBy: v.id("users"),
    startedAt: v.number(),
    minutes: v.number(),
    keyPoints: v.array(v.string()),
    decisions: v.array(v.string()),
    actionItems: v.array(callActionItem),
    transcript: v.optional(v.string()),
    dismissedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_projectId_and_createdAt", ["projectId", "createdAt"]),
};
