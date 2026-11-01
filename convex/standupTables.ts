import { defineTable } from "convex/server";
import { v } from "convex/values";

export const standupIssue = v.object({ taskId: v.id("tasks"), title: v.string(), column: v.string() });
export const standupPull = v.object({ number: v.number(), url: v.string(), taskId: v.id("tasks"), title: v.string(), checks: v.string() });
export const standupBlocker = v.object({
  kind: v.union(v.literal("approval"), v.literal("failed_run")),
  text: v.string(),
  taskId: v.optional(v.id("tasks")),
  agentName: v.optional(v.string()),
});

export const standupTables = {
  /** A project Chief's daily standup: one per project and UTC day, linked from each member's Inbox. */
  standupDigests: defineTable({
    teamId: v.id("teams"),
    projectId: v.id("projects"),
    day: v.string(),
    chiefName: v.string(),
    since: v.number(),
    completed: v.array(standupIssue),
    moved: v.array(standupIssue),
    waiting: v.array(standupPull),
    blockers: v.array(standupBlocker),
    createdAt: v.number(),
  }).index("by_projectId_and_day", ["projectId", "day"]),
};
