import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { canEdit, projectPeople, requireMember } from "./permissions";
import { PIPELINE_STAGES } from "../../../shared/origin-pipeline";

export type PipelineCtx = QueryCtx | MutationCtx;
export type PipelineActorValue = Doc<"pipelineLeads">["owner"] & {};
type ActivityFields = Omit<Doc<"pipelineActivities">, "_id" | "_creationTime" | "projectId" | "leadId" | "createdAt" | "updatedAt">;

export const DAY_MS = 86_400_000;

export async function requireEditor(ctx: PipelineCtx, projectId: Id<"projects">, sessionToken: string) {
  const access = await requireMember(ctx, projectId, sessionToken);
  if (!canEdit(access.member)) throw new Error("Edit role required");
  return access;
}

export function actorOf(user: Doc<"users">, agent?: { name: string; id?: string }): PipelineActorValue {
  if (agent) return { kind: "agent", name: agent.name.trim().slice(0, 80) || "Agent", ...(agent.id ? { id: agent.id.slice(0, 80) } : {}) };
  return { kind: "member", name: user.name || user.email, id: user._id };
}

export async function settingsOf(ctx: PipelineCtx, projectId: Id<"projects">) {
  return ctx.db.query("pipelineSettings").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).unique();
}

export function stagesOf(settings: Doc<"pipelineSettings"> | null): string[] {
  return settings?.stages?.length ? settings.stages : [...PIPELINE_STAGES];
}

export async function leadOf(ctx: PipelineCtx, projectId: Id<"projects">, leadId: Id<"pipelineLeads">) {
  const lead = await ctx.db.get(leadId);
  if (!lead || lead.projectId !== projectId) throw new Error("Lead not found");
  return lead;
}

const MESSAGE_KINDS: ReadonlySet<string> = new Set(["email", "sms", "whatsapp", "call", "ai_call"]);

/** A message the contact sends brings their conversation back to the open inbox; one the team sends keeps it where it is. */
export function inboxPatch(lead: Pick<Doc<"pipelineLeads">, "inbox">, at: number, inbound: boolean): Partial<Doc<"pipelineLeads">> {
  return inbound || !lead.inbox ? { inboxAt: at, inbox: "open", snoozedUntil: undefined } : { inboxAt: at };
}

export async function addActivity(ctx: MutationCtx, lead: Doc<"pipelineLeads">, fields: ActivityFields) {
  const now = Date.now();
  const id = await ctx.db.insert("pipelineActivities", { projectId: lead.projectId, leadId: lead._id, createdAt: now, updatedAt: now, ...fields });
  if (fields.status === "pending" || fields.status === "discarded") return id;
  const message = MESSAGE_KINDS.has(fields.kind) && fields.status !== "approved";
  await ctx.db.patch(lead._id, { lastActivityAt: now, updatedAt: now, ...(message ? inboxPatch(lead, now, fields.status === "received") : {}) });
  return id;
}

export function sourcePatch(lead: Pick<Doc<"pipelineLeads">, "source" | "sources">, source: string | undefined): { sources?: string[] } {
  const name = source?.trim().slice(0, 60);
  if (!name || name === lead.source || lead.sources?.includes(name)) return {};
  return { sources: [...(lead.sources ?? []), name].slice(-20) };
}

export async function findLead(ctx: PipelineCtx, projectId: Id<"projects">, contact: { email?: string; phone?: string }) {
  const byEmail = contact.email
    ? await ctx.db.query("pipelineLeads").withIndex("by_projectId_and_email", (q) => q.eq("projectId", projectId).eq("email", contact.email)).first()
    : null;
  if (byEmail || !contact.phone) return byEmail;
  return ctx.db.query("pipelineLeads").withIndex("by_projectId_and_phone", (q) => q.eq("projectId", projectId).eq("phone", contact.phone)).first();
}

export function newToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export function siteUrl(path: string): string | undefined {
  const site = (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
  return site ? `${site}${path}` : undefined;
}

/** Ends a lead's running sequence and withdraws the drafts it left waiting for approval. */
export async function stopSequences(ctx: MutationCtx, leadId: Id<"pipelineLeads">, reason: string) {
  const now = Date.now();
  for (const sequence of await ctx.db.query("pipelineSequences").withIndex("by_leadId", (q) => q.eq("leadId", leadId)).take(20)) {
    if (sequence.status === "stopped") continue;
    for (const step of sequence.steps) {
      const activity = step.activityId ? await ctx.db.get(step.activityId) : null;
      if (activity?.status === "pending") await ctx.db.patch(activity._id, { status: "discarded", error: reason, updatedAt: now });
    }
    if (sequence.status === "done") continue;
    await ctx.db.patch(sequence._id, {
      status: "stopped", stopReason: reason, nextDueAt: undefined, updatedAt: now,
      steps: sequence.steps.map((step) => (step.state === "waiting" ? { ...step, state: "skipped" as const } : step)),
    });
  }
}

/** The people an inbound reply concerns: the lead's owner when a member owns it, otherwise the project's admins. */
export async function leadWatchers(ctx: MutationCtx, project: Doc<"projects">, lead: Doc<"pipelineLeads">): Promise<Id<"users">[]> {
  const people = await projectPeople(ctx, project);
  const owner = lead.owner?.kind === "member" ? people.find((person) => person.userId === lead.owner?.id) : undefined;
  if (owner) return [owner.userId];
  return people.filter((person) => person.role === "owner" || person.role === "admin").map((person) => person.userId).slice(0, 10);
}

export async function notifyLeadReply(ctx: MutationCtx, lead: Doc<"pipelineLeads">, activityId: Id<"pipelineActivities">, preview: string) {
  const project = await ctx.db.get(lead.projectId);
  if (!project?.teamId || project.status !== "active") return;
  const teamId = project.teamId;
  for (const userId of await leadWatchers(ctx, project, lead)) {
    const preferences = await ctx.db.query("notificationPreferences").withIndex("by_teamId_and_userId", (q) => q.eq("teamId", teamId).eq("userId", userId)).unique();
    if (preferences?.mutedProjects.includes(project._id)) continue;
    const eventId = `pipeline-reply:${activityId}`;
    if (await ctx.db.query("notifications").withIndex("by_user_event", (q) => q.eq("userId", userId).eq("eventId", eventId)).first()) continue;
    await ctx.db.insert("notifications", {
      teamId, userId, actorId: userId, kind: "lead", eventId, projectId: project._id, leadId: lead._id,
      preview: `${lead.name}: ${preview.replace(/\s+/g, " ").trim()}`.slice(0, 200), read: false, createdAt: Date.now(),
    });
  }
}
