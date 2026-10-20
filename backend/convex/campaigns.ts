import { v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireMember, touchProject } from "./lib/permissions";
import { cleanText, validDay } from "./lib/features";
import { broadcastChannel } from "./broadcastTables";
import { campaignMetric, campaignStatus } from "./campaignTables";
import { CAMPAIGN_LIMITS, CAMPAIGN_LINKS_MAX, campaignSlug, utmCampaignOf } from "../../shared/origin-campaigns";
import { PIPELINE_STAGES } from "../../shared/origin-pipeline";

type Ctx = QueryCtx | MutationCtx;
type Campaign = Doc<"campaigns">;

const CAMPAIGNS_SHOWN = 100;
const LEADS_SCANNED = 2_000;
const CAPTURES_SCANNED = 2_000;
const METRICS_MAX = 400;
const AGENT_NAME_MAX = 80;

const linkKind = v.union(v.literal("post"), v.literal("generation"), v.literal("lead"), v.literal("issue"));
const fields = {
  name: v.optional(v.string()),
  goal: v.optional(v.string()),
  audience: v.optional(v.string()),
  channels: v.optional(v.array(broadcastChannel)),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  budgetNote: v.optional(v.string()),
  status: v.optional(campaignStatus),
};

async function editorOf(ctx: Ctx, projectId: Id<"projects">, sessionToken: string) {
  const access = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  return access;
}

async function campaignOf(ctx: Ctx, projectId: Id<"projects">, campaignId: Id<"campaigns">) {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign || campaign.projectId !== projectId) throw new Error("Campaign not found");
  return campaign;
}

const optional = (value: string | undefined, max: number) => value === undefined ? undefined : value.trim().slice(0, max);
const day = (value: string | undefined) => value === undefined ? undefined : value.trim() ? validDay(value.trim()) : "";

/** The validated fields of a campaign; an empty string clears an optional field. */
function campaignPatch(input: { [K in keyof typeof fields]?: Infer<(typeof fields)[K]> }) {
  const patch: Partial<Pick<Campaign, "name" | "goal" | "audience" | "channels" | "startDate" | "endDate" | "budgetNote" | "status">> = {};
  if (input.name !== undefined) patch.name = cleanText(input.name, CAMPAIGN_LIMITS.name, "Name");
  if (input.goal !== undefined) patch.goal = optional(input.goal, CAMPAIGN_LIMITS.goal);
  if (input.audience !== undefined) patch.audience = optional(input.audience, CAMPAIGN_LIMITS.audience);
  if (input.channels) patch.channels = [...new Set(input.channels)];
  const start = day(input.startDate);
  const end = day(input.endDate);
  if (start !== undefined) patch.startDate = start || undefined;
  if (end !== undefined) patch.endDate = end || undefined;
  if (input.budgetNote !== undefined) patch.budgetNote = optional(input.budgetNote, CAMPAIGN_LIMITS.budget) || undefined;
  if (input.status) patch.status = input.status;
  return patch;
}

async function uniqueSlug(ctx: Ctx, projectId: Id<"projects">, name: string, except?: Id<"campaigns">) {
  const taken = new Set((await ctx.db.query("campaigns").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", projectId)).take(500))
    .filter((campaign) => campaign._id !== except).map((campaign) => campaign.slug));
  const base = campaignSlug(name);
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base.slice(0, CAMPAIGN_LIMITS.slug - String(n).length - 1)}-${n}`;
    if (!taken.has(slug)) return slug;
  }
}

/** Every lead of the project with the `utm_campaign` values of the pages it was captured on. */
async function leadsWithCaptures(ctx: Ctx, projectId: Id<"projects">) {
  const leads = await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", projectId)).order("desc").take(LEADS_SCANNED);
  const captures = await ctx.db.query("pipelineActivities").withIndex("by_projectId_and_kind_and_createdAt", (q) => q.eq("projectId", projectId).eq("kind", "capture")).order("desc").take(CAPTURES_SCANNED);
  const tagged = new Map<Id<"pipelineLeads">, Set<string>>();
  for (const capture of captures) {
    const utm = utmCampaignOf(capture.subject);
    if (!utm) continue;
    const set = tagged.get(capture.leadId) ?? new Set<string>();
    set.add(utm);
    tagged.set(capture.leadId, set);
  }
  return { leads, tagged };
}

function campaignLeads(campaign: Campaign, all: Awaited<ReturnType<typeof leadsWithCaptures>>) {
  const linked = new Set<string>(campaign.leadIds);
  return all.leads.filter((lead) => linked.has(lead._id) || lead.source.trim().toLowerCase() === campaign.slug || all.tagged.get(lead._id)?.has(campaign.slug))
    .map((lead) => ({ lead, linked: linked.has(lead._id) }));
}

async function present<T extends "broadcastPosts" | "studioGenerations" | "tasks">(ctx: Ctx, projectId: Id<"projects">, ids: readonly Id<T>[]) {
  const rows = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return rows.filter((row): row is NonNullable<typeof row> => Boolean(row && (row as { projectId: Id<"projects"> }).projectId === projectId));
}

async function summaryOf(ctx: Ctx, campaign: Campaign, all: Awaited<ReturnType<typeof leadsWithCaptures>>) {
  const posts = await present(ctx, campaign.projectId, campaign.postIds) as Doc<"broadcastPosts">[];
  const generations = await present(ctx, campaign.projectId, campaign.generationIds);
  const tasks = await present(ctx, campaign.projectId, campaign.taskIds) as Doc<"tasks">[];
  const leads = campaignLeads(campaign, all);
  return {
    _id: campaign._id, name: campaign.name, slug: campaign.slug, goal: campaign.goal, audience: campaign.audience, channels: campaign.channels,
    ...(campaign.startDate ? { startDate: campaign.startDate } : {}), ...(campaign.endDate ? { endDate: campaign.endDate } : {}),
    ...(campaign.budgetNote ? { budgetNote: campaign.budgetNote } : {}), ...(campaign.agentName ? { agentName: campaign.agentName } : {}),
    status: campaign.status, createdAt: campaign.createdAt, updatedAt: campaign.updatedAt,
    counts: {
      posts: posts.length, published: posts.filter((post) => post.status === "published").length, generations: generations.length,
      leads: leads.length, won: leads.filter(({ lead }) => lead.stage === "Won").length, openIssues: tasks.filter((task) => !task.done).length,
    },
  };
}

export const list = query({
  args: { sessionToken: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    const campaigns = await ctx.db.query("campaigns").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(CAMPAIGNS_SHOWN);
    const all = await leadsWithCaptures(ctx, args.projectId);
    return { canEdit: canEdit(member), campaigns: await Promise.all(campaigns.map((campaign) => summaryOf(ctx, campaign, all))) };
  },
});

export const get = query({
  args: { sessionToken: v.string(), projectId: v.id("projects"), campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign || campaign.projectId !== args.projectId) return null;
    const all = await leadsWithCaptures(ctx, args.projectId);
    const posts = await present(ctx, campaign.projectId, campaign.postIds) as Doc<"broadcastPosts">[];
    const generations = await present(ctx, campaign.projectId, campaign.generationIds) as Doc<"studioGenerations">[];
    const tasks = await present(ctx, campaign.projectId, campaign.taskIds) as Doc<"tasks">[];
    const columns = new Map<string, string>();
    for (const task of tasks) if (!columns.has(task.columnId)) columns.set(task.columnId, (await ctx.db.get(task.columnId))?.title ?? "");
    const settings = await ctx.db.query("pipelineSettings").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).unique();
    const stages = settings?.stages?.length ? settings.stages : [...PIPELINE_STAGES];
    const leads = campaignLeads(campaign, all);
    const postIds = new Set<string>(posts.map((post) => post._id));
    return {
      ...await summaryOf(ctx, campaign, all),
      currency: settings?.currency ?? "EUR",
      posts: posts.map((post) => ({
        _id: post._id, status: post.status, needsApproval: Boolean(post.agentName) && !post.approvedAt,
        ...(post.scheduledAt ? { scheduledAt: post.scheduledAt } : {}),
        excerpt: (post.variants[0]?.text ?? "").trim().slice(0, 280),
        variants: post.variants.map(({ text: _text, ...variant }) => variant),
      })),
      generations: generations.map((row) => ({
        _id: row._id, kind: row.kind, status: row.status, prompt: row.prompt.slice(0, 300), modelLabel: row.modelLabel, createdAt: row.createdAt,
        ...(row.outputs[0] ? { output: row.outputs[0].url } : {}),
      })),
      leads: leads.map(({ lead, linked }) => ({
        _id: lead._id, name: lead.name, stage: lead.stage, source: lead.source, linked, createdAt: lead.createdAt,
        ...(lead.company ? { company: lead.company } : {}), ...(lead.value !== undefined ? { value: lead.value } : {}),
      })),
      stages: stages.map((stage) => {
        const inStage = leads.filter(({ lead }) => lead.stage === stage);
        return { stage, count: inStage.length, value: inStage.reduce((sum, { lead }) => sum + (lead.value ?? 0), 0) };
      }),
      issues: tasks.map((task) => ({
        _id: task._id, title: task.title, done: task.done, column: columns.get(task.columnId) ?? "", priority: task.priority,
        ...(task.githubIssueNumber ? { githubIssueNumber: task.githubIssueNumber } : {}), ...(task.assignedToName || task.assignedToEmail ? { assignee: task.assignedToName || task.assignedToEmail } : {}),
      })),
      metrics: campaign.metrics.filter((metric) => postIds.has(metric.postId)),
      ...(campaign.metricsAt ? { metricsAt: campaign.metricsAt } : {}),
    };
  },
});

export const create = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), ...fields, name: v.string(), agentName: v.optional(v.string()) },
  returns: v.id("campaigns"),
  handler: async (ctx, args) => {
    const { user } = await editorOf(ctx, args.projectId, args.sessionToken);
    const { sessionToken: _token, projectId, agentName, ...input } = args;
    const patch = campaignPatch(input);
    const now = Date.now();
    const id = await ctx.db.insert("campaigns", {
      projectId, name: patch.name!, slug: await uniqueSlug(ctx, projectId, patch.name!), goal: patch.goal ?? "", audience: patch.audience ?? "", channels: patch.channels ?? [],
      ...(patch.startDate ? { startDate: patch.startDate } : {}), ...(patch.endDate ? { endDate: patch.endDate } : {}), ...(patch.budgetNote ? { budgetNote: patch.budgetNote } : {}),
      status: patch.status ?? "planning", postIds: [], generationIds: [], leadIds: [], taskIds: [], metrics: [],
      createdBy: user._id, ...(agentName?.trim() ? { agentName: agentName.trim().slice(0, AGENT_NAME_MAX) } : {}), createdAt: now, updatedAt: now,
    });
    await touchProject(ctx, projectId);
    return id;
  },
});

export const update = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), campaignId: v.id("campaigns"), ...fields },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    const campaign = await campaignOf(ctx, args.projectId, args.campaignId);
    const { sessionToken: _token, projectId: _project, campaignId: _id, ...input } = args;
    const patch = campaignPatch(input);
    const start = patch.startDate === undefined && input.startDate === undefined ? campaign.startDate : patch.startDate;
    const end = patch.endDate === undefined && input.endDate === undefined ? campaign.endDate : patch.endDate;
    if (start && end && end < start) throw new Error("The end date is before the start date");
    await ctx.db.patch(campaign._id, { ...patch, updatedAt: Date.now() });
    return null;
  },
});

/** Attaches an item of the same project to a campaign, or with `remove` detaches it. */
export const link = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), campaignId: v.id("campaigns"), kind: linkKind, itemId: v.string(), remove: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    const campaign = await campaignOf(ctx, args.projectId, args.campaignId);
    const table = ({ post: "broadcastPosts", generation: "studioGenerations", lead: "pipelineLeads", issue: "tasks" } as const)[args.kind];
    const field = ({ post: "postIds", generation: "generationIds", lead: "leadIds", issue: "taskIds" } as const)[args.kind];
    const id = ctx.db.normalizeId(table, args.itemId);
    const current = campaign[field] as string[];
    if (args.remove) {
      if (!id || !current.includes(id)) return null;
      await ctx.db.patch(campaign._id, { [field]: current.filter((item) => item !== id), updatedAt: Date.now() });
      return null;
    }
    const item = id ? await ctx.db.get(id) : null;
    if (!id || !item || item.projectId !== args.projectId) throw new Error(`No such ${args.kind} in this project`);
    if (current.includes(id)) return null;
    if (current.length >= CAMPAIGN_LINKS_MAX) throw new Error(`A campaign links up to ${CAMPAIGN_LINKS_MAX} of each kind`);
    await ctx.db.patch(campaign._id, { [field]: [...current, id], updatedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    const campaign = await campaignOf(ctx, args.projectId, args.campaignId);
    await ctx.db.delete(campaign._id);
    return null;
  },
});

/** Stores the numbers the member's app read from the channels; a post's earlier reading on a channel is replaced. */
export const recordMetrics = mutation({
  args: { sessionToken: v.string(), projectId: v.id("projects"), campaignId: v.id("campaigns"), metrics: v.array(campaignMetric) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await editorOf(ctx, args.projectId, args.sessionToken);
    const campaign = await campaignOf(ctx, args.projectId, args.campaignId);
    const linked = new Set<string>(campaign.postIds);
    const fresh = args.metrics.filter((metric) => linked.has(metric.postId));
    const key = (metric: { postId: string; channel: string }) => `${metric.postId}:${metric.channel}`;
    const replaced = new Set(fresh.map(key));
    const metrics = [...fresh, ...campaign.metrics.filter((metric) => !replaced.has(key(metric)) && linked.has(metric.postId))].slice(0, METRICS_MAX);
    if (!fresh.length) return null;
    await ctx.db.patch(campaign._id, { metrics, metricsAt: Date.now() });
    return null;
  },
});
