import { v } from "convex/values";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/permissions";
import { cleanText } from "./lib/features";
import { newToken, requireEditor, settingsOf } from "./lib/pipelineCore";
import { inboxState } from "./pipelineTables";
import { INBOX_PAGE_SIZE, SALES_TEMPLATES_MAX, type InboxPage, type InboxThread } from "../../shared/origin-sales";

const scope = { projectId: v.id("projects"), sessionToken: v.string() };
const KINDS = ["email", "sms", "whatsapp", "call", "ai_call"] as const;
const PER_KIND = 300;
const PENDING_MAX = 200;
const THREADS_MAX = 300;
const LEADS_MAX = 2000;
const DEALS_MAX = 500;

const INDEX_BATCH = 100;
const LAST_SCAN = 40;
const STATE_MAX = 50;
const SNOOZE_MAX_MS = 365 * 86_400_000;
const MESSAGE_KINDS: ReadonlySet<string> = new Set(KINDS);

const preview = (row: Doc<"pipelineActivities">) =>
  (row.summary ?? row.body ?? row.subject ?? row.goal ?? (row.kind === "call" ? "Call" : "")).replace(/\s+/g, " ").trim().slice(0, 160);

async function lastMessage(ctx: QueryCtx, leadId: Id<"pipelineLeads">, drafts: boolean) {
  const rows = await ctx.db.query("pipelineActivities").withIndex("by_leadId_and_createdAt", (q) => q.eq("leadId", leadId)).order("desc").take(LAST_SCAN);
  return rows.find((row) => MESSAGE_KINDS.has(row.kind) && row.status !== "discarded" && (drafts || (row.status !== "pending" && row.status !== "approved"))) ?? null;
}

async function attention(ctx: QueryCtx, projectId: Id<"projects">) {
  const pending = new Map<Id<"pipelineLeads">, number>();
  for (const row of await ctx.db.query("pipelineActivities").withIndex("by_projectId_and_status", (q) => q.eq("projectId", projectId).eq("status", "pending")).take(PENDING_MAX)) {
    pending.set(row.leadId, (pending.get(row.leadId) ?? 0) + 1);
  }
  const asking = new Set<Id<"pipelineLeads">>();
  for (const deal of await ctx.db.query("pipelineDeals").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", projectId)).order("desc").take(DEALS_MAX)) {
    if (deal.wonRequest) asking.add(deal.leadId);
  }
  return { pending, asking };
}

function threadOf(lead: Doc<"pipelineLeads">, last: Doc<"pipelineActivities"> | null, marks: Awaited<ReturnType<typeof attention>>): InboxThread {
  return {
    leadId: lead._id, name: lead.name, stage: lead.stage, unread: lead.unreadReplies ?? 0, pending: marks.pending.get(lead._id) ?? 0, wonRequest: marks.asking.has(lead._id),
    lastAt: last?.createdAt ?? lead.inboxAt ?? lead.lastReplyAt ?? lead.updatedAt,
    ...(lead.company ? { company: lead.company } : {}), ...(lead.owner ? { owner: lead.owner } : {}),
    ...(lead.inbox ? { inbox: lead.inbox } : {}), ...(lead.snoozedUntil ? { snoozedUntil: lead.snoozedUntil } : {}),
    ...(last ? { last: { kind: last.kind, inbound: last.status === "received", preview: preview(last), status: last.status } } : {}),
  };
}

export const page = query({
  args: { ...scope, folder: inboxState, cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<InboxPage> => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const settings = await settingsOf(ctx, args.projectId);
    const marks = await attention(ctx, args.projectId);
    if (!settings?.inboxIndexed) {
      const rows = await legacyThreads(ctx, args.projectId);
      return { threads: args.folder === "open" ? rows : [], cursor: "", isDone: true, indexed: false };
    }
    const now = Date.now();
    const result = await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_inbox_and_inboxAt", (q) => q.eq("projectId", args.projectId).eq("inbox", args.folder))
      .order("desc").paginate({ numItems: INBOX_PAGE_SIZE, cursor: args.cursor ?? null });
    const leads = result.page.filter((lead) => args.folder !== "snoozed" || (lead.snoozedUntil ?? 0) > now);
    if (args.folder === "open" && !args.cursor) {
      const seen = new Set(leads.map((lead) => lead._id));
      const woken = await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_inbox_and_inboxAt", (q) => q.eq("projectId", args.projectId).eq("inbox", "snoozed")).order("desc").take(PENDING_MAX);
      for (const lead of woken) if ((lead.snoozedUntil ?? 0) <= now && !seen.has(lead._id)) { leads.push(lead); seen.add(lead._id); }
      for (const leadId of [...marks.pending.keys(), ...marks.asking]) {
        if (seen.has(leadId)) continue;
        const lead = await ctx.db.get(leadId);
        if (lead?.projectId === args.projectId) { leads.push(lead); seen.add(leadId); }
      }
    }
    const threads: InboxThread[] = [];
    for (const lead of leads) threads.push(threadOf(lead, await lastMessage(ctx, lead._id, true), marks));
    return { threads: threads.sort((a, b) => b.lastAt - a.lastAt), cursor: result.continueCursor, isDone: result.isDone, indexed: true };
  },
});

/** Files a batch of the project's contacts in the inbox by their last message; the client calls it until it reports done. */
export const index = mutation({
  args: { ...scope, cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ done: v.boolean(), cursor: v.string() }),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const settings = await settingsOf(ctx, args.projectId);
    if (settings?.inboxIndexed) return { done: true, cursor: "" };
    const batch = await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).paginate({ numItems: INDEX_BATCH, cursor: args.cursor ?? null });
    for (const lead of batch.page) {
      if (lead.inbox) continue;
      const last = await lastMessage(ctx, lead._id, false);
      if (last) await ctx.db.patch(lead._id, { inbox: "open", inboxAt: last.createdAt });
    }
    if (!batch.isDone) return { done: false, cursor: batch.continueCursor };
    if (settings) await ctx.db.patch(settings._id, { inboxIndexed: true });
    else await ctx.db.insert("pipelineSettings", { projectId: args.projectId, captureToken: newToken(), captureEnabled: false, autoSend: false, inboxIndexed: true });
    return { done: true, cursor: "" };
  },
});

export const setState = mutation({
  args: { ...scope, leadIds: v.array(v.id("pipelineLeads")), state: inboxState, until: v.optional(v.number()) },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    if (args.leadIds.length > STATE_MAX) throw new Error(`Change at most ${STATE_MAX} conversations at a time`);
    const now = Date.now();
    const until = args.state === "snoozed" ? args.until ?? 0 : undefined;
    if (until !== undefined && (!Number.isFinite(until) || until <= now || until > now + SNOOZE_MAX_MS)) throw new Error("Snooze until a time within the next year");
    let updated = 0;
    for (const leadId of new Set(args.leadIds)) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.projectId !== args.projectId) throw new Error("Contact not found");
      await ctx.db.patch(lead._id, { inbox: args.state, snoozedUntil: until, inboxAt: lead.inboxAt ?? lead.lastActivityAt ?? lead.updatedAt });
      if (until !== undefined) await ctx.scheduler.runAt(until, internal.pipelineInbox.wake, { leadId: lead._id, until });
      updated++;
    }
    return { updated };
  },
});

export const wake = internalMutation({
  args: { leadId: v.id("pipelineLeads"), until: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (lead?.inbox === "snoozed" && lead.snoozedUntil === args.until) await ctx.db.patch(lead._id, { inbox: "open", snoozedUntil: undefined });
    return null;
  },
});

async function legacyThreads(ctx: QueryCtx, projectId: Id<"projects">): Promise<InboxThread[]> {
  const latest = new Map<Id<"pipelineLeads">, Doc<"pipelineActivities">>();
  for (const kind of KINDS) {
    const rows = await ctx.db.query("pipelineActivities").withIndex("by_projectId_and_kind_and_createdAt", (q) => q.eq("projectId", projectId).eq("kind", kind)).order("desc").take(PER_KIND);
    for (const row of rows) {
      if (row.status === "discarded") continue;
      const seen = latest.get(row.leadId);
      if (!seen || seen.createdAt < row.createdAt) latest.set(row.leadId, row);
    }
  }
  const marks = await attention(ctx, projectId);
  const leads = await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", projectId)).order("desc").take(LEADS_MAX);
  const rows: InboxThread[] = [];
  for (const lead of leads) {
    const last = latest.get(lead._id) ?? null;
    if (!last && !marks.pending.has(lead._id) && !lead.unreadReplies && !marks.asking.has(lead._id)) continue;
    rows.push(threadOf(lead, last, marks));
  }
  return rows.sort((a, b) => b.lastAt - a.lastAt).slice(0, THREADS_MAX);
}

export const threads = query({
  args: scope,
  handler: async (ctx, args): Promise<InboxThread[]> => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    return (await legacyThreads(ctx, args.projectId)).filter((row) => row.inbox !== "archived" && row.inbox !== "snoozed");
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
