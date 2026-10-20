import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canEdit, requireAdmin, requireMember, touchProject } from "./lib/permissions";
import { cleanText, validDay } from "./lib/features";
import {
  actorOf, addActivity, findLead, inboxPatch, leadOf, newToken, requireEditor, settingsOf, siteUrl, sourcePatch, stagesOf, stopSequences, type PipelineActorValue as Actor, type PipelineCtx as Ctx,
} from "./lib/pipelineCore";
import { pipelineActor } from "./pipelineTables";
import { CLOSED_STAGES, PIPELINE_IMPORT_MAX, normalizeLeadEmail, normalizeLeadPhone } from "../../shared/origin-pipeline";

const LEADS_MAX = 2000;
const TIMELINE_MAX = 200;
const PENDING_MAX = 50;
const CAPTURE_WINDOW_MS = 10 * 60_000;
const CAPTURES_PER_WINDOW = 30;
const CAPTURES_PER_DAY = 500;

const scope = { projectId: v.id("projects"), sessionToken: v.string() };
const agentArg = v.optional(v.object({ name: v.string(), id: v.optional(v.string()) }));
const channel = v.union(v.literal("email"), v.literal("sms"), v.literal("whatsapp"), v.literal("call"), v.literal("ai_call"));
const leadFields = {
  name: v.optional(v.string()),
  company: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  source: v.optional(v.string()),
  stage: v.optional(v.string()),
  value: v.optional(v.union(v.number(), v.null())),
  owner: v.optional(v.union(pipelineActor, v.null())),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  nextStep: v.optional(v.string()),
  nextDue: v.optional(v.string()),
};

function stageIn(stages: readonly string[], wanted: string | undefined): string | undefined {
  const name = wanted?.trim().toLowerCase();
  return name ? stages.find((stage) => stage.toLowerCase() === name) : undefined;
}

const defined = <T extends Record<string, unknown>>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

const optionalText = (value: string | undefined, max: number) => {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
};

/** The fields of a lead from validated input; `undefined` leaves a field as it is, an empty string clears it. */
function leadPatch(input: { [K in keyof typeof leadFields]?: unknown }, stages: readonly string[]) {
  const patch: Partial<Pick<Doc<"pipelineLeads">, "name" | "company" | "email" | "phone" | "source" | "stage" | "value" | "owner" | "tags" | "notes" | "nextStep" | "nextDue">> & Record<string, unknown> = {};
  const clear = (key: string, value: unknown) => {
    if (typeof value !== "string" || value.trim()) return false;
    patch[key] = undefined;
    return true;
  };
  if (typeof input.name === "string") patch.name = cleanText(input.name, 200, "Name");
  for (const [key, max] of [["company", 200], ["source", 60], ["notes", 8000], ["nextStep", 300]] as const) {
    const value = input[key];
    if (typeof value === "string" && !clear(key, value)) patch[key] = value.trim().slice(0, max);
  }
  if (typeof input.email === "string" && !clear("email", input.email)) {
    patch.email = normalizeLeadEmail(input.email) ?? (() => { throw new Error("Enter a valid email address"); })();
  }
  if (typeof input.phone === "string" && !clear("phone", input.phone)) {
    patch.phone = normalizeLeadPhone(input.phone) ?? (() => { throw new Error("Enter a phone number with its country code, like +39 333 123 4567"); })();
  }
  if (typeof input.nextDue === "string" && !clear("nextDue", input.nextDue)) patch.nextDue = validDay(input.nextDue.trim());
  if (input.value === null) patch.value = undefined;
  else if (typeof input.value === "number") {
    if (!Number.isFinite(input.value) || input.value < 0 || input.value > 1e12) throw new Error("Value must be a positive amount");
    patch.value = Math.round(input.value * 100) / 100;
  }
  if (input.owner === null) patch.owner = undefined;
  else if (input.owner && typeof input.owner === "object") {
    const owner = input.owner as Actor;
    patch.owner = { kind: owner.kind, name: cleanText(owner.name, 80, "Owner"), ...(owner.id ? { id: owner.id.slice(0, 80) } : {}) };
  }
  if (Array.isArray(input.tags)) patch.tags = [...new Set(input.tags.map((tag) => String(tag).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
  if (typeof input.stage === "string") patch.stage = stageIn(stages, input.stage) ?? (() => { throw new Error(`Stage must be one of ${stages.join(", ")}`); })();
  return patch;
}

export async function topOrder(ctx: Ctx, projectId: Id<"projects">, stage: string) {
  let min = 0;
  for await (const lead of ctx.db.query("pipelineLeads").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", projectId))) {
    if (lead.stage === stage && lead.order < min) min = lead.order;
  }
  return min - 1;
}

async function findByEmail(ctx: Ctx, projectId: Id<"projects">, email: string | undefined) {
  if (!email) return null;
  return ctx.db.query("pipelineLeads").withIndex("by_projectId_and_email", (q) => q.eq("projectId", projectId).eq("email", email)).first();
}

export async function moveTo(ctx: MutationCtx, lead: Doc<"pipelineLeads">, stage: string, order: number, actor: Actor) {
  const now = Date.now();
  await ctx.db.patch(lead._id, { stage, order, updatedAt: now, ...(stage !== lead.stage ? { stageChangedAt: now } : {}) });
  if (stage === lead.stage) return;
  await addActivity(ctx, lead, { kind: "stage", status: "logged", actor, subject: lead.stage, body: stage });
  if (CLOSED_STAGES.includes(stage)) await stopSequences(ctx, lead._id, `Moved to ${stage}`);
}

async function activityOf(ctx: Ctx, projectId: Id<"projects">, activityId: Id<"pipelineActivities">) {
  const activity = await ctx.db.get(activityId);
  if (!activity || activity.projectId !== projectId) throw new Error("Activity not found");
  return activity;
}

const captureUrl = (token: string) => siteUrl(`/pipeline/capture?token=${token}`);

function inboundView(settings: Doc<"pipelineSettings">) {
  const twilioUrl = settings.inboundToken && siteUrl(`/pipeline/twilio?token=${settings.inboundToken}`);
  const brevoUrl = settings.inboundToken && siteUrl(`/pipeline/brevo?token=${settings.inboundToken}`);
  if (!twilioUrl || !brevoUrl || !settings.brevoSecret) return {};
  return { inbound: { twilioUrl, brevoUrl, brevoSecret: settings.brevoSecret, twilioSigning: Boolean(settings.twilioAuthToken), ...(settings.replyToEmail ? { replyToEmail: settings.replyToEmail } : {}) } };
}

export const board = query({
  args: scope,
  handler: async (ctx, args) => {
    const { member } = await requireMember(ctx, args.projectId, args.sessionToken);
    const settings = await settingsOf(ctx, args.projectId);
    const leads = await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).order("desc").take(LEADS_MAX);
    const pendingRows = await ctx.db.query("pipelineActivities").withIndex("by_projectId_and_status", (q) => q.eq("projectId", args.projectId).eq("status", "pending")).order("desc").take(PENDING_MAX);
    const names = new Map(leads.map((lead) => [lead._id, lead.name]));
    const pending = await Promise.all(pendingRows.map(async (row) => ({ ...row, leadName: names.get(row.leadId) ?? (await ctx.db.get(row.leadId))?.name ?? "Lead" })));
    const editor = canEdit(member);
    return {
      stages: stagesOf(settings),
      leads: leads.sort((a, b) => a.order - b.order || b.createdAt - a.createdAt),
      pending,
      settings: {
        configured: Boolean(settings),
        captureEnabled: settings?.captureEnabled ?? false,
        ...(editor && settings?.captureEnabled ? { captureUrl: captureUrl(settings.captureToken) } : {}),
        autoSend: settings?.autoSend ?? false,
        currency: settings?.currency ?? "EUR",
        ...(settings?.aiAgentId ? { aiAgentId: settings.aiAgentId } : {}),
        ...(settings?.aiPhoneNumberId ? { aiPhoneNumberId: settings.aiPhoneNumberId } : {}),
        inboundEnabled: settings?.inboundEnabled ?? false,
        ...(editor && settings?.inboundEnabled ? inboundView(settings) : {}),
        ...(editor && settings?.stripeToken ? { stripeWebhook: { url: siteUrl(`/pipeline/stripe?token=${settings.stripeToken}`) ?? "", signing: Boolean(settings.stripeSecret) } } : {}),
      },
    };
  },
});

export const lead = query({
  args: { ...scope, leadId: v.id("pipelineLeads") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.projectId !== args.projectId) return null;
    const activities = await ctx.db.query("pipelineActivities").withIndex("by_leadId_and_createdAt", (q) => q.eq("leadId", lead._id)).order("desc").take(TIMELINE_MAX);
    return { lead, activities };
  },
});

export const upsertLead = mutation({
  args: { ...scope, leadId: v.optional(v.id("pipelineLeads")), agent: agentArg, ...leadFields },
  returns: v.object({ leadId: v.id("pipelineLeads"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const stages = stagesOf(await settingsOf(ctx, args.projectId));
    const actor = actorOf(user, args.agent);
    const patch = leadPatch(args, stages);
    const existing = args.leadId ? await leadOf(ctx, args.projectId, args.leadId) : await findByEmail(ctx, args.projectId, patch.email);
    const now = Date.now();
    if (existing) {
      const { stage, ...rest } = patch;
      await ctx.db.patch(existing._id, { ...rest, updatedAt: now });
      if (stage && stage !== existing.stage) await moveTo(ctx, { ...existing, ...rest }, stage, await topOrder(ctx, args.projectId, stage), actor);
      await touchProject(ctx, args.projectId);
      return { leadId: existing._id, created: false };
    }
    if (!patch.name) throw new Error("A new lead needs a name");
    const stage = patch.stage ?? stages[0]!;
    const leadId = await ctx.db.insert("pipelineLeads", {
      ...defined(patch), projectId: args.projectId, name: patch.name, stage, source: patch.source || (args.agent ? "agent research" : "manual"), tags: patch.tags ?? [],
      order: await topOrder(ctx, args.projectId, stage), stageChangedAt: now, createdAt: now, updatedAt: now,
    });
    if (args.agent) {
      const created = (await ctx.db.get(leadId))!;
      await addActivity(ctx, created, { kind: "note", status: "logged", actor, body: `Added by ${actor.name}` });
    }
    await touchProject(ctx, args.projectId);
    return { leadId, created: true };
  },
});

export const moveLead = mutation({
  args: { ...scope, leadId: v.id("pipelineLeads"), stage: v.string(), beforeLeadId: v.optional(v.id("pipelineLeads")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const stages = stagesOf(await settingsOf(ctx, args.projectId));
    const stage = stageIn(stages, args.stage) ?? (() => { throw new Error("Unknown stage"); })();
    const lead = await leadOf(ctx, args.projectId, args.leadId);
    const lane: Doc<"pipelineLeads">[] = [];
    for await (const row of ctx.db.query("pipelineLeads").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId))) {
      if (row.stage === stage && row._id !== lead._id) lane.push(row);
    }
    lane.sort((a, b) => a.order - b.order);
    const index = args.beforeLeadId ? lane.findIndex((row) => row._id === args.beforeLeadId) : -1;
    const order = index < 0
      ? (lane[lane.length - 1]?.order ?? 0) + 1
      : index === 0 ? lane[0]!.order - 1 : (lane[index - 1]!.order + lane[index]!.order) / 2;
    await moveTo(ctx, lead, stage, order, actorOf(user));
    return null;
  },
});

export const removeLead = mutation({
  args: { ...scope, leadId: v.id("pipelineLeads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const lead = await leadOf(ctx, args.projectId, args.leadId);
    for await (const activity of ctx.db.query("pipelineActivities").withIndex("by_leadId_and_createdAt", (q) => q.eq("leadId", lead._id))) {
      await ctx.db.delete(activity._id);
    }
    for (const sequence of await ctx.db.query("pipelineSequences").withIndex("by_leadId", (q) => q.eq("leadId", lead._id)).take(50)) await ctx.db.delete(sequence._id);
    for (const deal of await ctx.db.query("pipelineDeals").withIndex("by_leadId", (q) => q.eq("leadId", lead._id)).take(100)) await ctx.db.delete(deal._id);
    await ctx.db.delete(lead._id);
    return null;
  },
});

export const importLeads = mutation({
  args: {
    ...scope,
    source: v.optional(v.string()),
    rows: v.array(v.object({
      name: v.string(), company: v.optional(v.string()), email: v.optional(v.string()), phone: v.optional(v.string()), source: v.optional(v.string()),
      value: v.optional(v.number()), tags: v.optional(v.array(v.string())), notes: v.optional(v.string()), stage: v.optional(v.string()),
    })),
  },
  returns: v.object({ created: v.number(), updated: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    if (args.rows.length > PIPELINE_IMPORT_MAX) throw new Error(`Import at most ${PIPELINE_IMPORT_MAX} leads at a time`);
    const stages = stagesOf(await settingsOf(ctx, args.projectId));
    const actor = actorOf(user);
    const source = optionalText(args.source, 60) ?? "import";
    let order = await topOrder(ctx, args.projectId, stages[0]!);
    let created = 0, updated = 0, skipped = 0;
    for (const row of args.rows) {
      let patch;
      try {
        patch = leadPatch({
          ...row, stage: stageIn(stages, row.stage) ?? stages[0]!,
          email: normalizeLeadEmail(row.email) ?? "", phone: normalizeLeadPhone(row.phone) ?? "",
        }, stages);
      } catch {
        skipped++;
        continue;
      }
      const now = Date.now();
      const existing = await findByEmail(ctx, args.projectId, patch.email);
      if (existing) {
        const { stage: _stage, source: _source, tags, ...rest } = patch;
        const gaps = Object.fromEntries(Object.entries(defined(rest)).filter(([key]) => existing[key as keyof typeof existing] === undefined));
        await ctx.db.patch(existing._id, { ...gaps, ...sourcePatch(existing, source), tags: [...new Set([...existing.tags, ...(tags ?? [])])].slice(0, 12), updatedAt: now });
        updated++;
        continue;
      }
      const stage = patch.stage ?? stages[0]!;
      const leadId = await ctx.db.insert("pipelineLeads", {
        ...defined(patch), projectId: args.projectId, name: patch.name ?? row.name, stage, source: patch.source || source, tags: patch.tags ?? [], order: stage === stages[0] ? order-- : 0, createdAt: now, updatedAt: now,
      });
      await addActivity(ctx, (await ctx.db.get(leadId))!, { kind: "import", status: "logged", actor, body: source });
      created++;
    }
    await touchProject(ctx, args.projectId);
    return { created, updated, skipped };
  },
});

export const logActivity = mutation({
  args: {
    ...scope, leadId: v.id("pipelineLeads"), agent: agentArg,
    kind: v.union(v.literal("note"), channel),
    subject: v.optional(v.string()), body: v.optional(v.string()), transcript: v.optional(v.string()), summary: v.optional(v.string()),
  },
  returns: v.id("pipelineActivities"),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const lead = await leadOf(ctx, args.projectId, args.leadId);
    const body = optionalText(args.body, 20_000);
    const summary = optionalText(args.summary, 8_000);
    if (!body && !summary && !args.transcript?.trim()) throw new Error("Write what happened");
    return addActivity(ctx, lead, {
      kind: args.kind, status: args.kind === "note" ? "logged" : "done", actor: actorOf(user, args.agent),
      ...(optionalText(args.subject, 300) ? { subject: optionalText(args.subject, 300) } : {}),
      ...(body ? { body } : {}), ...(summary ? { summary } : {}),
      ...(optionalText(args.transcript, 200_000) ? { transcript: optionalText(args.transcript, 200_000) } : {}),
    });
  },
});

/** A contact a person starts is cleared to send at once; one an agent drafts waits for a person's approval unless the project turned on auto-send. */
export const draftContact = mutation({
  args: { ...scope, leadId: v.id("pipelineLeads"), agent: agentArg, channel, subject: v.optional(v.string()), body: v.optional(v.string()), goal: v.optional(v.string()) },
  returns: v.object({ activityId: v.id("pipelineActivities"), status: v.union(v.literal("pending"), v.literal("approved")) }),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const lead = await leadOf(ctx, args.projectId, args.leadId);
    const subject = optionalText(args.subject, 300);
    const body = optionalText(args.body, 20_000);
    const goal = optionalText(args.goal, 8_000);
    if (args.channel === "email" && !lead.email) throw new Error(`${lead.name} has no email address`);
    if (args.channel !== "email" && !lead.phone) throw new Error(`${lead.name} has no phone number`);
    if (args.channel === "email" && (!subject || !body)) throw new Error("An email needs a subject and a message");
    if ((args.channel === "sms" || args.channel === "whatsapp") && !body) throw new Error("Write the message");
    if (args.channel === "ai_call" && !goal) throw new Error("Write the call's goal or script");
    const settings = await settingsOf(ctx, args.projectId);
    const status = args.agent && !settings?.autoSend ? "pending" as const : "approved" as const;
    const activityId = await addActivity(ctx, lead, {
      kind: args.channel, status, actor: actorOf(user, args.agent),
      ...(subject ? { subject } : {}), ...(body ? { body } : {}), ...(goal ? { goal } : {}),
      ...(status === "approved" && !args.agent ? { approvedBy: user.name || user.email } : {}),
    });
    return { activityId, status };
  },
});

export const reviewContact = mutation({
  args: { ...scope, activityId: v.id("pipelineActivities"), approve: v.boolean(), subject: v.optional(v.string()), body: v.optional(v.string()), goal: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const activity = await activityOf(ctx, args.projectId, args.activityId);
    if (activity.status !== "pending") throw new Error("This contact is no longer waiting for approval");
    const edits = Object.fromEntries((["subject", "body", "goal"] as const).flatMap((key) => {
      const value = optionalText(args[key], key === "subject" ? 300 : key === "body" ? 20_000 : 8_000);
      return value && activity[key] !== undefined ? [[key, value]] : [];
    }));
    await ctx.db.patch(activity._id, { ...edits, status: args.approve ? "approved" : "discarded", approvedBy: user.name || user.email, updatedAt: Date.now() });
    return null;
  },
});

/** The app server takes an approved contact to send it, or a failed one a person retries; a contact is never sent twice. */
export const claimContact = mutation({
  args: { ...scope, activityId: v.id("pipelineActivities") },
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const activity = await activityOf(ctx, args.projectId, args.activityId);
    if (activity.status !== "approved" && activity.status !== "failed") throw new Error(activity.status === "pending" ? "A person must approve this contact first" : "This contact was already handled");
    const lead = await leadOf(ctx, args.projectId, activity.leadId);
    const settings = await settingsOf(ctx, args.projectId);
    await ctx.db.patch(activity._id, { status: "sending", error: undefined, updatedAt: Date.now() });
    const statusCallback = settings?.inboundEnabled && settings.inboundToken && settings.twilioAuthToken ? siteUrl(`/pipeline/twilio?token=${settings.inboundToken}`) : undefined;
    return {
      activity: { ...activity, status: "sending" as const }, lead,
      ai: { agentId: settings?.aiAgentId, phoneNumberId: settings?.aiPhoneNumberId },
      ...(statusCallback ? { statusCallback } : {}),
      ...(settings?.inboundEnabled && settings.replyToEmail ? { replyTo: settings.replyToEmail } : {}),
    };
  },
});

export const finishContact = mutation({
  args: {
    ...scope, activityId: v.id("pipelineActivities"),
    status: v.union(v.literal("sent"), v.literal("in_progress"), v.literal("done"), v.literal("failed")),
    providerId: v.optional(v.string()), error: v.optional(v.string()), transcript: v.optional(v.string()), summary: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEditor(ctx, args.projectId, args.sessionToken);
    const activity = await activityOf(ctx, args.projectId, args.activityId);
    if (!["sending", "in_progress"].includes(activity.status)) throw new Error("This contact is not being sent");
    const now = Date.now();
    await ctx.db.patch(activity._id, {
      status: args.status, updatedAt: now,
      ...(args.providerId ? { providerId: args.providerId.slice(0, 200) } : {}),
      ...(args.error ? { error: args.error.slice(0, 1000) } : {}),
      ...(args.transcript ? { transcript: args.transcript.slice(0, 200_000) } : {}),
      ...(args.summary ? { summary: args.summary.slice(0, 8_000) } : {}),
    });
    const lead = await ctx.db.get(activity.leadId);
    if (!lead || args.status === "failed") return null;
    await ctx.db.patch(lead._id, { lastActivityAt: now, updatedAt: now, ...inboxPatch(lead, now, false) });
    const stages = stagesOf(await settingsOf(ctx, args.projectId));
    if (lead.stage === stages[0] && stages[1] && !CLOSED_STAGES.includes(stages[1])) {
      await moveTo(ctx, lead, stages[1], await topOrder(ctx, args.projectId, stages[1]), { kind: "system", name: "Origin" });
    }
    return null;
  },
});

/** Inbound webhooks carry secrets, so only project admins turn them on, rotate them or store the Twilio auth token. */
async function inboundPatch(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; sessionToken: string; inboundEnabled?: boolean; rotateInbound?: boolean; twilioAuthToken?: string; replyToEmail?: string },
  existing: Doc<"pipelineSettings"> | null,
  admin: boolean,
) {
  if (args.inboundEnabled === undefined && !args.rotateInbound && args.twilioAuthToken === undefined && args.replyToEmail === undefined) return {};
  if (!admin) await requireAdmin(ctx, args.projectId, args.sessionToken);
  const token = args.twilioAuthToken?.trim();
  if (token && !/^[A-Za-z0-9]{32}$/.test(token)) throw new Error("A Twilio auth token is 32 letters and digits");
  const replyTo = args.replyToEmail === undefined ? undefined : args.replyToEmail.trim() ? normalizeLeadEmail(args.replyToEmail) ?? (() => { throw new Error("Enter a valid reply-to address"); })() : "";
  const fresh = args.rotateInbound || (args.inboundEnabled && !existing?.inboundToken);
  return {
    ...(args.inboundEnabled !== undefined ? { inboundEnabled: args.inboundEnabled } : {}),
    ...(fresh ? { inboundToken: newToken(), brevoSecret: newToken() } : {}),
    ...(token !== undefined ? { twilioAuthToken: token || undefined } : {}),
    ...(replyTo !== undefined ? { replyToEmail: replyTo || undefined } : {}),
  };
}

export const configure = mutation({
  args: {
    ...scope,
    captureEnabled: v.optional(v.boolean()), rotateToken: v.optional(v.boolean()), autoSend: v.optional(v.boolean()),
    currency: v.optional(v.string()), aiAgentId: v.optional(v.string()), aiPhoneNumberId: v.optional(v.string()),
    inboundEnabled: v.optional(v.boolean()), rotateInbound: v.optional(v.boolean()), twilioAuthToken: v.optional(v.string()), replyToEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { member } = await requireEditor(ctx, args.projectId, args.sessionToken);
    if (args.autoSend !== undefined && member.role !== "owner" && member.role !== "admin") await requireAdmin(ctx, args.projectId, args.sessionToken);
    const existing = await settingsOf(ctx, args.projectId);
    const currency = args.currency?.trim().toUpperCase();
    if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter code like EUR");
    const id = (value: string | undefined) => value === undefined ? undefined : value.trim() ? /^[\w-]{1,120}$/.test(value.trim()) ? value.trim() : (() => { throw new Error("That ElevenLabs id is not valid"); })() : "";
    const agentId = id(args.aiAgentId);
    const phoneId = id(args.aiPhoneNumberId);
    const inbound = await inboundPatch(ctx, args, existing, member.role === "owner" || member.role === "admin");
    const patch = {
      ...inbound,
      ...(args.captureEnabled !== undefined ? { captureEnabled: args.captureEnabled } : {}),
      ...(args.rotateToken ? { captureToken: newToken() } : {}),
      ...(args.autoSend !== undefined ? { autoSend: args.autoSend } : {}),
      ...(currency ? { currency } : {}),
      ...(agentId !== undefined ? { aiAgentId: agentId || undefined } : {}),
      ...(phoneId !== undefined ? { aiPhoneNumberId: phoneId || undefined } : {}),
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("pipelineSettings", { projectId: args.projectId, captureToken: newToken(), captureEnabled: false, autoSend: false, ...patch });
    return null;
  },
});

/** Only the public capture endpoint calls this, with the token from the form's address. */
export const capture = internalMutation({
  args: {
    token: v.string(), name: v.optional(v.string()), email: v.optional(v.string()), phone: v.optional(v.string()), company: v.optional(v.string()),
    message: v.optional(v.string()), source: v.optional(v.string()), page: v.optional(v.string()),
  },
  returns: v.union(v.literal("ok"), v.literal("unknown"), v.literal("limited"), v.literal("invalid")),
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{48}$/.test(args.token)) return "unknown";
    const settings = await ctx.db.query("pipelineSettings").withIndex("by_captureToken", (q) => q.eq("captureToken", args.token)).unique();
    if (!settings?.captureEnabled) return "unknown";
    const projectId = settings.projectId;
    const now = Date.now();
    const recent = await ctx.db.query("pipelineActivities").withIndex("by_projectId_and_kind_and_createdAt", (q) => q.eq("projectId", projectId).eq("kind", "capture").gt("createdAt", now - 86_400_000)).order("desc").take(CAPTURES_PER_DAY);
    if (recent.length >= CAPTURES_PER_DAY || recent.filter((row) => row.createdAt > now - CAPTURE_WINDOW_MS).length >= CAPTURES_PER_WINDOW) return "limited";
    const email = normalizeLeadEmail(args.email);
    const phone = normalizeLeadPhone(args.phone);
    const name = optionalText(args.name, 200) ?? email?.split("@")[0] ?? phone;
    if (!name || (!email && !phone)) return "invalid";
    const stages = stagesOf(settings);
    const company = optionalText(args.company, 200);
    const message = optionalText(args.message, 4000);
    const source = optionalText(args.source, 60) ?? "form";
    const page = optionalText(args.page, 300);
    const existing = await findLead(ctx, projectId, { email, phone });
    let lead: Doc<"pipelineLeads">;
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(phone && !existing.phone ? { phone } : {}), ...(email && !existing.email ? { email } : {}), ...(company && !existing.company ? { company } : {}), ...sourcePatch(existing, source), updatedAt: now,
      });
      lead = existing;
    } else {
      const leadId = await ctx.db.insert("pipelineLeads", {
        projectId, name, source, stage: stages[0]!, order: await topOrder(ctx, projectId, stages[0]!), tags: [], createdAt: now, updatedAt: now,
        ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(company ? { company } : {}),
      });
      lead = (await ctx.db.get(leadId))!;
    }
    await addActivity(ctx, lead, { kind: "capture", status: "logged", actor: { kind: "system", name: source }, ...(page ? { subject: page } : {}), ...(message ? { body: message } : {}) });
    return "ok";
  },
});


export const markRead = mutation({
  args: { ...scope, leadId: v.id("pipelineLeads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const lead = await leadOf(ctx, args.projectId, args.leadId);
    if (lead.unreadReplies) await ctx.db.patch(lead._id, { unreadReplies: undefined });
    return null;
  },
});

const STAGES_MAX = 12;

/** Renames, adds, reorders and removes stages; Won and Lost stay, and leads in a removed stage move to `moveTo`. */
export const setStages = mutation({
  args: { ...scope, stages: v.array(v.object({ name: v.string(), was: v.optional(v.string()) })), moveTo: v.optional(v.string()) },
  returns: v.object({ moved: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const settings = await settingsOf(ctx, args.projectId);
    const current = stagesOf(settings);
    const next = args.stages.map((stage) => ({ name: cleanText(stage.name, 40, "Stage name"), was: stage.was === undefined ? undefined : stageIn(current, stage.was) ?? (() => { throw new Error(`Unknown stage ${stage.was}`); })() }));
    if (next.length < 3 || next.length > STAGES_MAX) throw new Error(`Keep between 3 and ${STAGES_MAX} stages`);
    if (new Set(next.map((stage) => stage.name.toLowerCase())).size !== next.length) throw new Error("Stage names must be different");
    if (new Set(next.flatMap((stage) => (stage.was ? [stage.was] : []))).size !== next.filter((stage) => stage.was).length) throw new Error("A stage can only be kept once");
    for (const closed of CLOSED_STAGES) {
      if (!next.some((stage) => stage.was === closed && stage.name === closed)) throw new Error(`${closed} stays; you can move it but not rename or remove it`);
    }
    const renamed = new Map(next.flatMap((stage) => (stage.was ? [[stage.was, stage.name] as const] : [])));
    const removed = current.filter((stage) => !renamed.has(stage));
    const names = next.map((stage) => stage.name);
    const target = args.moveTo === undefined ? names.find((name) => !CLOSED_STAGES.includes(name))! : stageIn(names, args.moveTo) ?? (() => { throw new Error("Choose a stage to move the leads to"); })();
    const actor = actorOf(user);
    const now = Date.now();
    let moved = 0;
    for (const lead of await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_updatedAt", (q) => q.eq("projectId", args.projectId)).take(LEADS_MAX)) {
      const rename = renamed.get(lead.stage);
      if (rename !== undefined) {
        if (rename !== lead.stage) await ctx.db.patch(lead._id, { stage: rename });
      } else if (removed.includes(lead.stage)) {
        await ctx.db.patch(lead._id, { stage: target, stageChangedAt: now, updatedAt: now });
        await addActivity(ctx, lead, { kind: "stage", status: "logged", actor, subject: lead.stage, body: target });
        moved++;
      }
    }
    if (settings) await ctx.db.patch(settings._id, { stages: names });
    else await ctx.db.insert("pipelineSettings", { projectId: args.projectId, captureToken: newToken(), captureEnabled: false, autoSend: false, stages: names });
    await touchProject(ctx, args.projectId);
    return { moved };
  },
});
