import { CLOSED_STAGES, formatLeadValue, type PipelineActor, type PipelineLead, type PipelineSequenceChannel } from "../../../shared/origin-pipeline";
import type { LeadScore, NextAction } from "../../../shared/origin-pipeline-score";

export type LeadInsight = LeadScore & { actions: NextAction[] };

export type PendingMove = { stage: string; order: number };

export function matchesLead(lead: PipelineLead, needle: string): boolean {
  if (!needle) return true;
  return [lead.name, lead.company, lead.email, lead.phone, lead.source, lead.notes, lead.nextStep, lead.owner?.name, ...lead.tags]
    .filter(Boolean).join(" ").toLowerCase().includes(needle.toLowerCase());
}

export const ownerKey = (owner: PipelineActor | undefined): string => (owner ? `${owner.kind}:${owner.id ?? owner.name}` : "");

export function inStage(leads: readonly PipelineLead[], stage: string): PipelineLead[] {
  return leads.filter((lead) => lead.stage === stage).sort((a, b) => a.order - b.order);
}

/** Where a dropped lead sits until the server's order arrives: just before `beforeLeadId`, or last. */
export function orderForDrop(leads: readonly PipelineLead[], leadId: string, stage: string, beforeLeadId?: string): number {
  const lane = inStage(leads, stage).filter((lead) => lead._id !== leadId);
  const index = beforeLeadId ? lane.findIndex((lead) => lead._id === beforeLeadId) : -1;
  if (index < 0) return (lane[lane.length - 1]?.order ?? 0) + 1;
  if (index === 0) return lane[0]!.order - 1;
  return (lane[index - 1]!.order + lane[index]!.order) / 2;
}

export function withPendingMoves(leads: readonly PipelineLead[], pending: ReadonlyMap<string, PendingMove>): PipelineLead[] {
  if (!pending.size) return [...leads];
  return leads.map((lead) => {
    const move = pending.get(lead._id);
    return move ? { ...lead, ...move } : lead;
  });
}

export function dueTone(day: string | undefined, today = new Date()): { label: string; tone: "late" | "soon" | "later" } | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const due = new Date(year!, month! - 1, date!);
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - start.getTime()) / 86_400_000);
  const label = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { label, tone: days < 0 ? "late" : days <= 1 ? "soon" : "later" };
}

export function pipelineValue(leads: readonly PipelineLead[]): { open: number; won: number } {
  let open = 0;
  let won = 0;
  for (const lead of leads) {
    if (lead.stage === "Won") won += lead.value ?? 0;
    else if (!CLOSED_STAGES.includes(lead.stage)) open += lead.value ?? 0;
  }
  return { open, won };
}

/** What the Plan action sends to the project's Chief: the leads in brief, and how to work with them. */
export function planBrief(input: { projectName: string; leads: readonly PipelineLead[]; currency: string; direction: string }): string {
  const lines = input.leads.slice(0, 40).map((lead) => {
    const parts = [
      `${lead.name}${lead.company ? ` (${lead.company})` : ""}`, lead.stage,
      lead.value ? formatLeadValue(lead.value, input.currency) : "",
      [lead.email && "email", lead.phone && "phone"].filter(Boolean).join(" + ") || "no contact details",
      lead.nextStep ? `next: ${lead.nextStep}${lead.nextDue ? ` by ${lead.nextDue}` : ""}` : "",
      `id ${lead._id}`,
    ];
    return `- ${parts.filter(Boolean).join(" · ")}`;
  });
  const more = input.leads.length > lines.length ? `\n- …and ${input.leads.length - lines.length} more (list them with origin_pipeline_list_leads)` : "";
  return [
    `Plan an outreach strategy for ${input.leads.length === 1 ? "this lead" : `these ${input.leads.length} leads`} in ${input.projectName}'s Pipeline:`,
    `${lines.join("\n")}${more}`,
    input.direction.trim() ? `My direction: ${input.direction.trim()}` : "",
    "Read each lead's timeline with origin_pipeline_list_leads (lead_id) first. Then propose, per lead, the channel, timing and angle of each touch, and who on the team takes it. "
      + "Hand research to your agents where it helps. Draft the first touches with origin_pipeline_contact: they wait for my approval in Pipeline, so tell me when they are ready. "
      + "Record the plan as each lead's next step with origin_pipeline_upsert_lead.",
  ].filter(Boolean).join("\n\n");
}

export type SequenceDraftStep = { key: string; day: number; channel: PipelineSequenceChannel; subject: string; body: string; goal: string };

/** Day 0 email, day 3 text, day 7 call task; steps the lead cannot receive fall back to a call task. */
export function defaultSequence(lead: Pick<PipelineLead, "email" | "phone">): SequenceDraftStep[] {
  const step = (day: number, channel: PipelineSequenceChannel, subject: string, body: string): SequenceDraftStep => ({ key: `${day}-${channel}`, day, channel, subject, body, goal: "" });
  return [
    lead.email
      ? step(0, "email", "A quick idea for {company}", "Hi {first_name},\n\nI would love to show you how we could help {company}. Do you have 20 minutes this week?")
      : step(0, "call_task", "", "Call {name} to introduce us"),
    lead.phone ? step(3, "sms", "", "Hi {first_name}, did you get a chance to look at my note? Happy to find a time that suits you.") : step(3, "call_task", "", "Follow up with {name}"),
    step(7, "call_task", "", "Call {name}"),
  ];
}

/** What "Ask the Chief" sends to write a follow-up sequence for one lead. */
export function sequenceBrief(input: { projectName: string; lead: PipelineLead; currency: string }): string {
  const { lead } = input;
  return [
    `Write a follow-up sequence for ${lead.name}${lead.company ? ` (${lead.company})` : ""} in ${input.projectName}'s Pipeline (lead id ${lead._id}, stage ${lead.stage}${lead.value ? `, ${formatLeadValue(lead.value, input.currency)}` : ""}).`,
    "Read the lead's timeline with origin_pipeline_list_leads (lead_id) first. Then start it with origin_pipeline_sequence: about three steps over a week, such as a day 0 email, a day 3 text and a day 7 call task, "
      + "each written for this lead. Only use channels they can receive. Each contact step waits for my approval on its day, and the sequence stops when they reply.",
  ].join("\n\n");
}
