import { CLOSED_STAGES, formatLeadValue, type PipelineActor, type PipelineLead } from "../../../shared/origin-pipeline";

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
