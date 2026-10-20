import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/permissions";
import { DAY_MS, actorOf, addActivity, leadOf, requireEditor, stopSequences } from "./lib/pipelineCore";
import { sequenceChannel } from "./pipelineTables";
import { CLOSED_STAGES, SEQUENCE_DAYS_MAX, SEQUENCE_STEPS_MAX, fillLeadTemplate } from "../../shared/origin-pipeline";

type Step = Doc<"pipelineSequences">["steps"][number];
type Sequence = Doc<"pipelineSequences">;

const scope = { projectId: v.id("projects"), sessionToken: v.string() };
const agentArg = v.optional(v.object({ name: v.string(), id: v.optional(v.string()) }));
const stepInput = v.object({ day: v.number(), channel: sequenceChannel, subject: v.optional(v.string()), body: v.optional(v.string()), goal: v.optional(v.string()) });
const TICK_BATCH = 50;

const clip = (value: string | undefined, max: number) => {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
};

function cleanSteps(input: readonly { day: number; channel: Step["channel"]; subject?: string; body?: string; goal?: string }[], lead: Doc<"pipelineLeads">): Step[] {
  if (!input.length || input.length > SEQUENCE_STEPS_MAX) throw new Error(`A sequence has 1 to ${SEQUENCE_STEPS_MAX} steps`);
  let last = -1;
  return input.map((raw, index) => {
    const label = `Step ${index + 1}`;
    if (!Number.isInteger(raw.day) || raw.day < 0 || raw.day > SEQUENCE_DAYS_MAX) throw new Error(`${label}: the day is a whole number from 0 to ${SEQUENCE_DAYS_MAX}`);
    if (raw.day < last) throw new Error(`${label}: steps go in day order`);
    last = raw.day;
    const subject = clip(raw.subject, 300);
    const body = clip(raw.body, 20_000);
    const goal = clip(raw.goal, 8_000);
    if (raw.channel === "email" && (!subject || !body)) throw new Error(`${label}: an email needs a subject and a message`);
    if ((raw.channel === "sms" || raw.channel === "whatsapp") && !body) throw new Error(`${label}: write the message`);
    if (raw.channel === "ai_call" && !goal) throw new Error(`${label}: write the call's goal`);
    if (raw.channel === "email" && !lead.email) throw new Error(`${lead.name} has no email address`);
    if ((raw.channel === "sms" || raw.channel === "whatsapp" || raw.channel === "ai_call") && !lead.phone) throw new Error(`${lead.name} has no phone number`);
    return {
      day: raw.day, channel: raw.channel, state: "waiting" as const,
      ...(subject && raw.channel === "email" ? { subject } : {}), ...(body && raw.channel !== "ai_call" ? { body } : {}), ...(goal && raw.channel === "ai_call" ? { goal } : {}),
    };
  });
}

const dueAt = (sequence: Pick<Sequence, "startedAt">, step: Step) => sequence.startedAt + step.day * DAY_MS;

/** Drafts every step that has come due; contact steps wait for a person's approval, call steps become the lead's next step. */
async function advance(ctx: MutationCtx, sequence: Sequence, now: number) {
  const lead = await ctx.db.get(sequence.leadId);
  if (!lead) {
    await ctx.db.delete(sequence._id);
    return 0;
  }
  let drafted = 0;
  const steps: Step[] = [];
  for (const step of sequence.steps) {
    if (step.state !== "waiting" || dueAt(sequence, step) > now) { steps.push(step); continue; }
    const fill = (value: string | undefined) => (value === undefined ? undefined : fillLeadTemplate(value, lead));
    if (step.channel === "call_task") {
      const nextStep = (fill(step.body) ?? `Call ${lead.name}`).slice(0, 300);
      await ctx.db.patch(lead._id, { nextStep, nextDue: new Date(now).toISOString().slice(0, 10) });
      await addActivity(ctx, lead, { kind: "note", status: "logged", actor: { kind: "system", name: "Sequence" }, body: `Call task due today: ${nextStep}`, sequenceId: sequence._id });
      steps.push({ ...step, state: "done" });
      continue;
    }
    const reachable = step.channel === "email" ? lead.email : lead.phone;
    if (!reachable) { steps.push({ ...step, state: "skipped" }); continue; }
    const activityId = await addActivity(ctx, lead, {
      kind: step.channel, status: "pending", actor: sequence.createdBy, sequenceId: sequence._id,
      ...(step.subject ? { subject: fill(step.subject) } : {}), ...(step.body ? { body: fill(step.body) } : {}), ...(step.goal ? { goal: fill(step.goal) } : {}),
    });
    steps.push({ ...step, state: "drafted", activityId });
    drafted++;
  }
  const waiting = steps.filter((step) => step.state === "waiting").map((step) => dueAt(sequence, step));
  await ctx.db.patch(sequence._id, {
    steps, updatedAt: now,
    ...(waiting.length ? { nextDueAt: Math.min(...waiting) } : { nextDueAt: undefined, status: "done" as const }),
  });
  return drafted;
}

async function currentSequence(ctx: MutationCtx, leadId: Id<"pipelineLeads">) {
  const rows = await ctx.db.query("pipelineSequences").withIndex("by_leadId", (q) => q.eq("leadId", leadId)).order("desc").take(5);
  return rows.find((row) => row.status === "active" || row.status === "paused") ?? null;
}

export const forLead = query({
  args: { ...scope, leadId: v.id("pipelineLeads") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.projectId, args.sessionToken);
    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.projectId !== args.projectId) return null;
    return (await ctx.db.query("pipelineSequences").withIndex("by_leadId", (q) => q.eq("leadId", lead._id)).order("desc").first()) ?? null;
  },
});

export const start = mutation({
  args: { ...scope, leadId: v.id("pipelineLeads"), agent: agentArg, steps: v.array(stepInput) },
  returns: v.object({ sequenceId: v.id("pipelineSequences"), drafted: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const lead = await leadOf(ctx, args.projectId, args.leadId);
    if (CLOSED_STAGES.includes(lead.stage)) throw new Error(`${lead.name} is in ${lead.stage}; move them back to an open stage first`);
    const steps = cleanSteps(args.steps, lead);
    await stopSequences(ctx, lead._id, "Replaced by a new sequence");
    const now = Date.now();
    const sequenceId = await ctx.db.insert("pipelineSequences", {
      projectId: args.projectId, leadId: lead._id, status: "active", steps, startedAt: now, nextDueAt: now, createdBy: actorOf(user, args.agent), updatedAt: now,
    });
    const drafted = await advance(ctx, (await ctx.db.get(sequenceId))!, now);
    return { sequenceId, drafted };
  },
});

export const control = mutation({
  args: { ...scope, leadId: v.id("pipelineLeads"), action: v.union(v.literal("pause"), v.literal("resume"), v.literal("stop")), agent: agentArg },
  returns: v.union(v.literal("active"), v.literal("paused"), v.literal("stopped")),
  handler: async (ctx, args) => {
    const { user } = await requireEditor(ctx, args.projectId, args.sessionToken);
    const lead = await leadOf(ctx, args.projectId, args.leadId);
    const sequence = await currentSequence(ctx, lead._id) ?? (() => { throw new Error(`${lead.name} has no running sequence`); })();
    const now = Date.now();
    if (args.action === "stop") {
      await stopSequences(ctx, lead._id, `Stopped by ${actorOf(user, args.agent).name}`);
      return "stopped";
    }
    if (args.action === "pause") {
      if (sequence.status === "active") await ctx.db.patch(sequence._id, { status: "paused", pausedAt: now, nextDueAt: undefined, updatedAt: now });
      return "paused";
    }
    if (sequence.status === "paused") {
      const startedAt = sequence.startedAt + (now - (sequence.pausedAt ?? now));
      const waiting = sequence.steps.filter((step) => step.state === "waiting").map((step) => startedAt + step.day * DAY_MS);
      await ctx.db.patch(sequence._id, { status: "active", startedAt, pausedAt: undefined, nextDueAt: waiting.length ? Math.min(...waiting) : now, updatedAt: now });
    }
    return "active";
  },
});

export const tick = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db.query("pipelineSequences").withIndex("by_status_and_nextDueAt", (q) => q.eq("status", "active").gt("nextDueAt", 0).lte("nextDueAt", now)).take(TICK_BATCH);
    let drafted = 0;
    for (const sequence of due) drafted += await advance(ctx, sequence, now);
    return drafted;
  },
});
