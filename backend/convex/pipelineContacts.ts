import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember, touchProject } from "./lib/permissions";
import { cleanText } from "./lib/features";
import { actorOf, addActivity, leadOf, requireEditor, settingsOf, stagesOf } from "./lib/pipelineCore";
import { pipelineActor, salesViewFilters } from "./pipelineTables";
import { moveTo, topOrder } from "./pipeline";
import { SALES_BULK_MAX, SALES_VIEWS_MAX } from "../../shared/origin-sales";

const scope = { projectId: v.id("projects"), sessionToken: v.string() };
const MERGE_MAX = 10;
const HEALTH_WINDOW_MS = 30 * 86_400_000;
const HEALTH_ROWS = 1_000;

const CAMPAIGNS_MAX = 200;
const NOTIFICATIONS_PER_LEAD = 500;
const INBOX_RANK = { open: 2, snoozed: 1, archived: 0 } as const;

const later = (a: number | undefined, b: number | undefined) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

async function repoint(ctx: MutationCtx, projectId: Id<"projects">, from: ReadonlySet<Id<"pipelineLeads">>, to: Id<"pipelineLeads">) {
  for (const leadId of from) {
    for (const note of await ctx.db.query("notifications").withIndex("by_leadId", (q) => q.eq("leadId", leadId)).take(NOTIFICATIONS_PER_LEAD)) {
      await ctx.db.patch(note._id, { leadId: to });
    }
  }
  for (const campaign of await ctx.db.query("campaigns").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", projectId)).take(CAMPAIGNS_MAX)) {
    if (!campaign.leadIds.some((id) => from.has(id))) continue;
    await ctx.db.patch(campaign._id, { leadIds: [...new Set(campaign.leadIds.map((id) => (from.has(id) ? to : id)))] });
  }
}

export const merge = mutation({
  args: { ...scope, primaryId: v.id("pipelineLeads"), otherIds: v.array(v.id("pipelineLeads")) },
  returns: v.object({ merged: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const ids = [...new Set(args.otherIds)].filter((id) => id !== args.primaryId);
    if (!ids.length) throw new Error("Choose at least one other contact to merge");
    if (ids.length > MERGE_MAX) throw new Error(`Merge at most ${MERGE_MAX} contacts at a time`);
    const primary = await leadOf(ctx, args.projectId, args.primaryId);
    const others: Doc<"pipelineLeads">[] = [];
    for (const id of ids) others.push(await leadOf(ctx, args.projectId, id));
    const patch: Partial<Doc<"pipelineLeads">> = {};
    const sources = new Set(primary.sources ?? []);
    const tags = new Set(primary.tags);
    const notes = primary.notes ? [primary.notes] : [];
    let unread = primary.unreadReplies ?? 0;
    let createdAt = primary.createdAt;
    for (const other of others) {
      for (const key of ["company", "email", "phone", "value", "owner", "nextStep", "nextDue"] as const) {
        if (primary[key] === undefined && patch[key] === undefined && other[key] !== undefined) (patch as Record<string, unknown>)[key] = other[key];
      }
      for (const source of [other.source, ...(other.sources ?? [])]) if (source !== primary.source) sources.add(source);
      for (const tag of other.tags) tags.add(tag);
      if (other.notes && !notes.includes(other.notes)) notes.push(other.notes);
      unread += other.unreadReplies ?? 0;
      createdAt = Math.min(createdAt, other.createdAt);
      patch.lastActivityAt = later(patch.lastActivityAt ?? primary.lastActivityAt, other.lastActivityAt);
      patch.lastReplyAt = later(patch.lastReplyAt ?? primary.lastReplyAt, other.lastReplyAt);
      patch.inboxAt = later(patch.inboxAt ?? primary.inboxAt, other.inboxAt);
      const state = patch.inbox ?? primary.inbox;
      if (other.inbox && (!state || INBOX_RANK[other.inbox] > INBOX_RANK[state])) {
        patch.inbox = other.inbox;
        patch.snoozedUntil = other.snoozedUntil;
      }
      for await (const activity of ctx.db.query("pipelineActivities").withIndex("by_leadId_and_createdAt", (q) => q.eq("leadId", other._id))) {
        await ctx.db.patch(activity._id, { leadId: primary._id });
      }
      for (const sequence of await ctx.db.query("pipelineSequences").withIndex("by_leadId", (q) => q.eq("leadId", other._id)).take(50)) await ctx.db.patch(sequence._id, { leadId: primary._id });
      for (const deal of await ctx.db.query("pipelineDeals").withIndex("by_leadId", (q) => q.eq("leadId", other._id)).take(100)) await ctx.db.patch(deal._id, { leadId: primary._id });
      await ctx.db.delete(other._id);
    }
    await repoint(ctx, args.projectId, new Set(others.map((other) => other._id)), primary._id);
    await ctx.db.patch(primary._id, {
      ...patch, sources: [...sources].slice(-20), tags: [...tags].slice(0, 12), createdAt, updatedAt: Date.now(),
      ...(notes.length ? { notes: notes.join("\n\n").slice(0, 8000) } : {}), ...(unread ? { unreadReplies: unread } : {}),
    });
    await addActivity(ctx, primary, { kind: "note", status: "logged", actor: actorOf(user), body: `Merged ${others.map((other) => other.name).join(", ")} into this contact` });
    await touchProject(ctx, args.projectId);
    return { merged: others.length };
  },
});

export const bulkUpdate = mutation({
  args: {
    ...scope, leadIds: v.array(v.id("pipelineLeads")),
    owner: v.optional(v.union(pipelineActor, v.null())), addTags: v.optional(v.array(v.string())), stage: v.optional(v.string()),
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    if (args.leadIds.length > SALES_BULK_MAX) throw new Error(`Change at most ${SALES_BULK_MAX} contacts at a time`);
    const stages = stagesOf(await settingsOf(ctx, args.projectId));
    const stage = args.stage === undefined ? undefined : stages.find((name) => name.toLowerCase() === args.stage!.trim().toLowerCase()) ?? (() => { throw new Error(`Stage must be one of ${stages.join(", ")}`); })();
    const tags = (args.addTags ?? []).map((tag) => tag.trim().slice(0, 40)).filter(Boolean);
    const owner = args.owner ? { kind: args.owner.kind, name: cleanText(args.owner.name, 80, "Owner"), ...(args.owner.id ? { id: args.owner.id.slice(0, 80) } : {}) } : args.owner;
    const actor = actorOf(user);
    let order = stage ? await topOrder(ctx, args.projectId, stage) : 0;
    let updated = 0;
    for (const id of new Set(args.leadIds)) {
      const lead = await leadOf(ctx, args.projectId, id);
      const now = Date.now();
      await ctx.db.patch(lead._id, {
        updatedAt: now,
        ...(owner !== undefined ? { owner: owner ?? undefined } : {}),
        ...(tags.length ? { tags: [...new Set([...lead.tags, ...tags])].slice(0, 12) } : {}),
      });
      if (stage && stage !== lead.stage) await moveTo(ctx, lead, stage, order--, actor);
      updated++;
    }
    await touchProject(ctx, args.projectId);
    return { updated };
  },
});

export const views = query({
  args: scope,
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const rows = await ctx.db.query("pipelineViews").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(SALES_VIEWS_MAX);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const saveView = mutation({
  args: { ...scope, viewId: v.optional(v.id("pipelineViews")), name: v.string(), filters: salesViewFilters },
  returns: v.id("pipelineViews"),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const name = cleanText(args.name, 60, "View name");
    const filters = Object.fromEntries(Object.entries(args.filters).flatMap(([key, value]): [string, string | boolean][] => {
      if (typeof value === "string") return value.trim() ? [[key, value.trim().slice(0, 200)]] : [];
      return value ? [[key, value]] : [];
    })) as Doc<"pipelineViews">["filters"];
    if (!Object.keys(filters).length) throw new Error("Set a search or a filter to save");
    if (args.viewId) {
      const view = await ctx.db.get(args.viewId);
      if (!view || view.projectId !== args.projectId) throw new Error("View not found");
      await ctx.db.patch(view._id, { name, filters });
      return view._id;
    }
    const count = (await ctx.db.query("pipelineViews").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(SALES_VIEWS_MAX)).length;
    if (count >= SALES_VIEWS_MAX) throw new Error(`Keep at most ${SALES_VIEWS_MAX} views`);
    return ctx.db.insert("pipelineViews", { projectId: args.projectId, name, filters, createdBy: user.name || user.email, createdAt: Date.now() });
  },
});

export const removeView = mutation({
  args: { ...scope, viewId: v.id("pipelineViews") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const view = await ctx.db.get(args.viewId);
    if (view?.projectId === args.projectId) await ctx.db.delete(view._id);
    return null;
  },
});

export const captureHealth = query({
  args: scope,
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const now = Date.now();
    const rows = await ctx.db.query("pipelineActivities")
      .withIndex("by_projectId_and_kind_and_createdAt", (q) => q.eq("projectId", args.projectId).eq("kind", "capture").gt("createdAt", now - HEALTH_WINDOW_MS))
      .order("desc").take(HEALTH_ROWS);
    const sources = new Map<string, { source: string; count: number; lastAt: number }>();
    for (const row of rows) {
      const source = row.actor.name;
      const entry = sources.get(source) ?? { source, count: 0, lastAt: row.createdAt };
      entry.count += 1;
      sources.set(source, entry);
    }
    return {
      ...(rows[0] ? { lastCaptureAt: rows[0].createdAt } : {}),
      last24h: rows.filter((row) => row.createdAt > now - 86_400_000).length,
      last30d: rows.length,
      sources: [...sources.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 12),
    };
  },
});
