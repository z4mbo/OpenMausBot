import { CLOSED_STAGES, formatLeadValue, type PipelineLead } from "./origin-pipeline.ts";

const DAY_MS = 86_400_000;

export type ScoreReason = { label: string; points: number };
export type LeadScore = { score: number; reasons: ScoreReason[] };
export type NextActionKind = "reply" | "approve" | "overdue" | "contact_info" | "first_touch" | "follow_up" | "close" | "set_value";
export type NextAction = { kind: NextActionKind; label: string; why: string };

export type ScoreContext = {
  stages: readonly string[];
  /** The highest value among open leads; a lead's value scores relative to it. */
  topValue: number;
  currency: string;
  pending: boolean;
  now: number;
};

type ScoredLead = Pick<PipelineLead, "stage" | "value" | "email" | "phone" | "nextStep" | "nextDue" | "lastActivityAt" | "lastReplyAt" | "unreadReplies" | "stageChangedAt" | "createdAt">;

const daysSince = (at: number | undefined, now: number) => (at === undefined ? Infinity : Math.floor((now - at) / DAY_MS));

export function topOpenValue(leads: readonly Pick<PipelineLead, "stage" | "value">[]): number {
  return leads.reduce((top, lead) => (CLOSED_STAGES.includes(lead.stage) ? top : Math.max(top, lead.value ?? 0)), 0);
}

/** A 0-100 score from a few visible rules; every point it gives or takes comes with its reason. */
export function scoreLead(lead: ScoredLead, context: ScoreContext): LeadScore {
  if (CLOSED_STAGES.includes(lead.stage)) return { score: 0, reasons: [{ label: `${lead.stage}`, points: 0 }] };
  const reasons: ScoreReason[] = [{ label: "Open lead", points: 20 }];
  const replied = daysSince(lead.lastReplyAt, context.now);
  if (replied <= 3) reasons.push({ label: replied === 0 ? "Replied today" : `Replied ${replied} ${replied === 1 ? "day" : "days"} ago`, points: 35 });
  else if (replied <= 14) reasons.push({ label: `Replied ${replied} days ago`, points: 20 });
  if (lead.value && context.topValue > 0) {
    const points = Math.max(1, Math.round((25 * lead.value) / context.topValue));
    reasons.push({ label: `Value ${formatLeadValue(lead.value, context.currency)}`, points });
  }
  const open = context.stages.filter((stage) => !CLOSED_STAGES.includes(stage));
  const index = open.indexOf(lead.stage);
  if (index > 0 && open.length > 1) reasons.push({ label: `In ${lead.stage}`, points: Math.round((20 * index) / (open.length - 1)) });
  const inStage = daysSince(lead.stageChangedAt ?? lead.createdAt, context.now);
  if (inStage > 30) reasons.push({ label: `${inStage} days in ${lead.stage}`, points: -25 });
  else if (inStage > 14) reasons.push({ label: `${inStage} days in ${lead.stage}`, points: -15 });
  const touched = daysSince(lead.lastActivityAt ?? lead.createdAt, context.now);
  if (touched >= 7) reasons.push({ label: `No touch for ${touched} days`, points: -10 });
  if (!lead.email && !lead.phone) reasons.push({ label: "No email or phone", points: -10 });
  const total = reasons.reduce((sum, reason) => sum + reason.points, 0);
  return { score: Math.max(0, Math.min(100, total)), reasons };
}

function overdue(day: string | undefined, now: number): boolean {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day < new Date(now).toISOString().slice(0, 10);
}

/** What to do next with a lead, most urgent first, at most two. */
export function nextActions(lead: ScoredLead, context: ScoreContext): NextAction[] {
  if (CLOSED_STAGES.includes(lead.stage)) return [];
  const actions: NextAction[] = [];
  const add = (action: NextAction) => { if (actions.length < 2) actions.push(action); };
  if (lead.unreadReplies) add({ kind: "reply", label: "Reply", why: `${lead.unreadReplies} unread ${lead.unreadReplies === 1 ? "reply" : "replies"}` });
  if (context.pending) add({ kind: "approve", label: "Approve draft", why: "A drafted contact waits for approval" });
  if (overdue(lead.nextDue, context.now)) add({ kind: "overdue", label: "Overdue", why: lead.nextStep ? `Next step was due ${lead.nextDue}: ${lead.nextStep}` : `Next step was due ${lead.nextDue}` });
  if (!lead.email && !lead.phone) add({ kind: "contact_info", label: "Add contact", why: "No email or phone to reach them" });
  const touched = daysSince(lead.lastActivityAt ?? lead.createdAt, context.now);
  if (lead.stage === context.stages[0]) add({ kind: "first_touch", label: "First touch", why: "Nobody has contacted them yet" });
  else if (touched >= 7) add({ kind: "follow_up", label: "Follow up", why: `No touch for ${touched} days` });
  const open = context.stages.filter((stage) => !CLOSED_STAGES.includes(stage));
  const late = open.indexOf(lead.stage) >= Math.max(1, open.length - 1);
  if (late && daysSince(lead.stageChangedAt ?? lead.createdAt, context.now) >= 14) add({ kind: "close", label: "Push to close", why: `${daysSince(lead.stageChangedAt ?? lead.createdAt, context.now)} days in ${lead.stage}` });
  if (!lead.value && open.indexOf(lead.stage) >= 2) add({ kind: "set_value", label: "Set value", why: "Qualified leads need a deal value to rank" });
  return actions;
}
