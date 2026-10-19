import { defineTable } from "convex/server";
import { v } from "convex/values";

export const pipelineActor = v.object({ kind: v.union(v.literal("member"), v.literal("agent"), v.literal("system")), name: v.string(), id: v.optional(v.string()) });

export const pipelineActivityKind = v.union(
  v.literal("email"), v.literal("sms"), v.literal("whatsapp"), v.literal("call"), v.literal("ai_call"),
  v.literal("note"), v.literal("stage"), v.literal("capture"), v.literal("import"),
);

/** pending: an agent drafted it and a person must approve it; approved: cleared for the app server to send. */
export const pipelineActivityStatus = v.union(
  v.literal("logged"), v.literal("pending"), v.literal("approved"), v.literal("sending"), v.literal("sent"),
  v.literal("in_progress"), v.literal("done"), v.literal("failed"), v.literal("discarded"),
);

export const pipelineTables = {
  pipelineLeads: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    company: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    source: v.string(),
    stage: v.string(),
    order: v.number(),
    value: v.optional(v.number()),
    owner: v.optional(pipelineActor),
    tags: v.array(v.string()),
    notes: v.optional(v.string()),
    nextStep: v.optional(v.string()),
    nextDue: v.optional(v.string()),
    lastActivityAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"]).index("by_projectId_and_email", ["projectId", "email"]),
  pipelineActivities: defineTable({
    projectId: v.id("projects"),
    leadId: v.id("pipelineLeads"),
    kind: pipelineActivityKind,
    status: pipelineActivityStatus,
    actor: pipelineActor,
    subject: v.optional(v.string()),
    body: v.optional(v.string()),
    goal: v.optional(v.string()),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
    providerId: v.optional(v.string()),
    error: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_leadId_and_createdAt", ["leadId", "createdAt"])
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_projectId_and_kind_and_createdAt", ["projectId", "kind", "createdAt"]),
  pipelineSettings: defineTable({
    projectId: v.id("projects"),
    captureToken: v.string(),
    captureEnabled: v.boolean(),
    autoSend: v.boolean(),
    stages: v.optional(v.array(v.string())),
    currency: v.optional(v.string()),
    aiAgentId: v.optional(v.string()),
    aiPhoneNumberId: v.optional(v.string()),
  }).index("by_projectId", ["projectId"]).index("by_captureToken", ["captureToken"]),
};
