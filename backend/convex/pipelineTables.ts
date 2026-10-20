import { defineTable } from "convex/server";
import { v } from "convex/values";

export const pipelineActor = v.object({ kind: v.union(v.literal("member"), v.literal("agent"), v.literal("system")), name: v.string(), id: v.optional(v.string()) });

export const pipelineActivityKind = v.union(
  v.literal("email"), v.literal("sms"), v.literal("whatsapp"), v.literal("call"), v.literal("ai_call"),
  v.literal("note"), v.literal("stage"), v.literal("capture"), v.literal("import"), v.literal("deal"),
);

/** pending: an agent drafted it and a person must approve it; approved: cleared for the app server to send; received: the lead wrote in. */
export const pipelineActivityStatus = v.union(
  v.literal("logged"), v.literal("pending"), v.literal("approved"), v.literal("sending"), v.literal("sent"),
  v.literal("in_progress"), v.literal("done"), v.literal("failed"), v.literal("discarded"), v.literal("received"),
);

export const sequenceChannel = v.union(v.literal("email"), v.literal("sms"), v.literal("whatsapp"), v.literal("ai_call"), v.literal("call_task"));
export const sequenceStep = v.object({
  day: v.number(),
  channel: sequenceChannel,
  subject: v.optional(v.string()),
  body: v.optional(v.string()),
  goal: v.optional(v.string()),
  state: v.union(v.literal("waiting"), v.literal("drafted"), v.literal("done"), v.literal("skipped")),
  activityId: v.optional(v.id("pipelineActivities")),
});

export const salesLineItem = v.object({ name: v.string(), quantity: v.number(), unitPrice: v.number() });
export const salesViewFilters = v.object({
  query: v.optional(v.string()), stage: v.optional(v.string()), owner: v.optional(v.string()), source: v.optional(v.string()), tag: v.optional(v.string()),
  unread: v.optional(v.boolean()), reach: v.optional(v.union(v.literal("email"), v.literal("phone"))),
});

export const pipelineTables = {
  pipelineLeads: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    company: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    source: v.string(),
    sources: v.optional(v.array(v.string())),
    stage: v.string(),
    order: v.number(),
    value: v.optional(v.number()),
    owner: v.optional(pipelineActor),
    tags: v.array(v.string()),
    notes: v.optional(v.string()),
    nextStep: v.optional(v.string()),
    nextDue: v.optional(v.string()),
    lastActivityAt: v.optional(v.number()),
    unreadReplies: v.optional(v.number()),
    lastReplyAt: v.optional(v.number()),
    stageChangedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"]).index("by_projectId_and_email", ["projectId", "email"])
    .index("by_projectId_and_phone", ["projectId", "phone"]),
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
    sequenceId: v.optional(v.id("pipelineSequences")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_leadId_and_createdAt", ["leadId", "createdAt"])
    .index("by_providerId", ["providerId"])
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
    inboundEnabled: v.optional(v.boolean()),
    inboundToken: v.optional(v.string()),
    /** Security: kept only to check X-Twilio-Signature on inbound webhooks; no query ever returns it. */
    twilioAuthToken: v.optional(v.string()),
    brevoSecret: v.optional(v.string()),
    replyToEmail: v.optional(v.string()),
  }).index("by_projectId", ["projectId"]).index("by_captureToken", ["captureToken"]).index("by_inboundToken", ["inboundToken"]),
  pipelineSequences: defineTable({
    projectId: v.id("projects"),
    leadId: v.id("pipelineLeads"),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("stopped"), v.literal("done")),
    steps: v.array(sequenceStep),
    startedAt: v.number(),
    pausedAt: v.optional(v.number()),
    nextDueAt: v.optional(v.number()),
    createdBy: pipelineActor,
    stopReason: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_leadId", ["leadId"]).index("by_status_and_nextDueAt", ["status", "nextDueAt"]),
  pipelineDeals: defineTable({
    projectId: v.id("projects"),
    leadId: v.id("pipelineLeads"),
    title: v.string(),
    value: v.number(),
    currency: v.string(),
    stage: v.string(),
    closeDate: v.optional(v.string()),
    lineItems: v.array(salesLineItem),
    notes: v.optional(v.string()),
    wonAmount: v.optional(v.number()),
    reason: v.optional(v.string()),
    closedAt: v.optional(v.number()),
    closedBy: v.optional(pipelineActor),
    wonRequest: v.optional(v.object({ amount: v.number(), reason: v.optional(v.string()), by: pipelineActor, at: v.number() })),
    payment: v.optional(v.object({
      url: v.string(), linkId: v.string(), amount: v.number(), createdAt: v.number(), paidAt: v.optional(v.number()), paidAmount: v.optional(v.number()),
    })),
    createdBy: pipelineActor,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId_and_updatedAt", ["projectId", "updatedAt"]).index("by_leadId", ["leadId"]),
  pipelineViews: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    filters: salesViewFilters,
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"]),
  pipelineTemplates: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    channel: v.optional(v.union(v.literal("email"), v.literal("sms"), v.literal("whatsapp"))),
    subject: v.optional(v.string()),
    body: v.string(),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),
};
