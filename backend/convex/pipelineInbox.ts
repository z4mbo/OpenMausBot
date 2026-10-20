import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/permissions";
import { cleanText } from "./lib/features";
import { requireEditor } from "./lib/pipelineCore";
import { SALES_TEMPLATES_MAX, type InboxThread } from "../../shared/origin-sales";

const scope = { projectId: v.id("projects"), sessionToken: v.string() };
const KINDS = ["email", "sms", "whatsapp", "call", "ai_call"] as const;
const PER_KIND = 300;
const PENDING_MAX = 200;
const THREADS_MAX = 300;
const LEADS_MAX = 2000;
const DEALS_MAX = 500;

const preview = (row: Doc<"pipelineActivities">) =>
  (row.summary ?? row.body ?? row.subject ?? row.goal ?? (row.kind === "call" ? "Call" : "")).replace(/\s+/g, " ").trim().slice(0, 160);

export const threads = query({
  args: scope,
  handler: async (ctx, args): Promise<InboxThread[]> => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const latest = new Map<Id<"pipelineLeads">, Doc<"pipelineActivities">>();
    for (const kind of KINDS) {
      const rows = await ctx.db.query("pipelineActivities").withIndex("by_projectId_and_kind_and_createdAt", (q) => q.eq("projectId", args.projectId).eq("kind", kind)).order("desc").take(PER_KIND);
      for (const row of rows) {
        if (row.status === "discarded") continue;
        const seen = latest.get(row.leadId);
        if (!seen || seen.createdAt < row.createdAt) latest.set(row.leadId, row);
      }
    }
    const pending = new Map<Id<"pipelineLeads">, number>();
    for (const row of await ctx.db.query("pipelineActivities").withIndex("by_projectId_and_status", (q) => q.eq("projectId", args.projectId).eq("status", "pending")).take(PENDING_MAX)) {
      pending.set(row.leadId, (pending.get(row.leadId) ?? 0) + 1);
    }
    const asking = new Set<Id<"pipelineLeads">>();
    for (const deal of await ctx.db.query("pipelineDeals").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(DEALS_MAX)) {
      if (deal.wonRequest) asking.add(deal.leadId);
    }
    const leads = await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(LEADS_MAX);
    const rows: InboxThread[] = [];
    for (const lead of leads) {
      const last = latest.get(lead._id);
      const drafts = pending.get(lead._id) ?? 0;
      if (!last && !drafts && !lead.unreadReplies && !asking.has(lead._id)) continue;
      rows.push({
        leadId: lead._id, name: lead.name, stage: lead.stage, unread: lead.unreadReplies ?? 0, pending: drafts, wonRequest: asking.has(lead._id),
        lastAt: last?.createdAt ?? lead.lastReplyAt ?? lead.updatedAt,
        ...(lead.company ? { company: lead.company } : {}), ...(lead.owner ? { owner: lead.owner } : {}),
        ...(last ? { last: { kind: last.kind, inbound: last.status === "received", preview: preview(last), status: last.status } } : {}),
      });
    }
    return rows.sort((a, b) => b.lastAt - a.lastAt).slice(0, THREADS_MAX);
  },
});

export const templates = query({
  args: scope,
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const rows = await ctx.db.query("pipelineTemplates").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(SALES_TEMPLATES_MAX);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const saveTemplate = mutation({
  args: {
    ...scope, templateId: v.optional(v.id("pipelineTemplates")), name: v.string(),
    channel: v.optional(v.union(v.literal("email"), v.literal("sms"), v.literal("whatsapp"))), subject: v.optional(v.string()), body: v.string(),
  },
  returns: v.id("pipelineTemplates"),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const fields = {
      name: cleanText(args.name, 80, "Template name"), body: cleanText(args.body, 20_000, "Template text"), updatedBy: user.name || user.email, updatedAt: Date.now(),
      channel: args.channel, subject: args.channel !== "sms" && args.channel !== "whatsapp" && args.subject?.trim() ? args.subject.trim().slice(0, 300) : undefined,
    };
    if (args.templateId) {
      const row = await ctx.db.get(args.templateId);
      if (!row || row.projectId !== args.projectId) throw new Error("Template not found");
      await ctx.db.patch(row._id, fields);
      return row._id;
    }
    const count = (await ctx.db.query("pipelineTemplates").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(SALES_TEMPLATES_MAX)).length;
    if (count >= SALES_TEMPLATES_MAX) throw new Error(`Keep at most ${SALES_TEMPLATES_MAX} templates`);
    return ctx.db.insert("pipelineTemplates", { projectId: args.projectId, ...fields });
  },
});

export const removeTemplate = mutation({
  args: { ...scope, templateId: v.id("pipelineTemplates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const row = await ctx.db.get(args.templateId);
    if (row?.projectId === args.projectId) await ctx.db.delete(row._id);
    return null;
  },
});
