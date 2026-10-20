import { useState, type FormEvent } from "react";
import { AudioLines, Check, CircleDashed, Loader2, Mail, MessageCircle, MessageSquareText, Pause, Phone, Play, Plus, Sparkles, Square, Trash2, Undo2 } from "lucide-react";
import type { Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { Notice, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import {
  SEQUENCE_DAYS_MAX, SEQUENCE_STEPS_MAX, fillLeadTemplate, type PipelineLead, type PipelineSequence, type PipelineSequenceChannel, type PipelineSequenceStep,
} from "../../../shared/origin-pipeline";
import { defaultSequence, type SequenceDraftStep } from "./pipeline-model";

const DAY_MS = 86_400_000;

const CHANNELS: readonly { value: PipelineSequenceChannel; label: string; icon: typeof Mail }[] = [
  { value: "email", label: "Email", icon: Mail },
  { value: "sms", label: "Text", icon: MessageSquareText },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { value: "ai_call", label: "AI call", icon: AudioLines },
  { value: "call_task", label: "Call task", icon: Phone },
];
const channelOf = (value: PipelineSequenceChannel) => CHANNELS.find((channel) => channel.value === value) ?? CHANNELS[0]!;

const STATE_LABEL: Record<PipelineSequenceStep["state"], string> = { waiting: "Due", drafted: "Drafted for approval", done: "Done", skipped: "Skipped" };
const STATUS_LABEL: Record<PipelineSequence["status"], string> = { active: "Running", paused: "Paused", stopped: "Stopped", done: "Finished" };

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function SequencePanel({ projectId, lead, canEdit, chief, onAsk }: { projectId: string; lead: PipelineLead; canEdit: boolean; chief: Bot; onAsk(): void }) {
  const sequence = useCloudQuery<PipelineSequence | null>("pipelineSequences:forLead", { projectId, leadId: lead._id });
  const [editing, setEditing] = useState(false);
  const action = useAction();
  const running = sequence?.status === "active" || sequence?.status === "paused";
  const control = (verb: "pause" | "resume" | "stop") => void action.run(() => cloudMutation("pipelineSequences:control", { projectId, leadId: lead._id, action: verb }), "Could not change the sequence");
  if (sequence === undefined) return null;
  return (
    <section className="border-t border-hairline/40 px-5 py-4" aria-label="Follow-up sequence">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold text-ink">Sequence</h3>
        {sequence && (
          <span className={cn("rounded-full px-1.5 py-px text-[11px]", sequence.status === "active" ? "bg-accent/15 text-accent-text" : "bg-raised text-ink-secondary")}>
            {STATUS_LABEL[sequence.status]}{sequence.stopReason ? `: ${sequence.stopReason}` : ""}
          </span>
        )}
        {canEdit && !editing && (
          <div className="ml-auto flex items-center gap-1">
            {running ? <>
              {sequence.status === "active"
                ? <button type="button" className={cn(ghostButton, "h-7 min-h-7 rounded-full px-2.5 text-[12px]")} disabled={action.busy} onClick={() => control("pause")}><Pause size={12} />Pause</button>
                : <button type="button" className={cn(ghostButton, "h-7 min-h-7 rounded-full px-2.5 text-[12px]")} disabled={action.busy} onClick={() => control("resume")}><Play size={12} />Resume</button>}
              <button type="button" className={cn(ghostButton, "h-7 min-h-7 rounded-full px-2.5 text-[12px]")} disabled={action.busy}
                onClick={() => { if (window.confirm("Stop the sequence? Drafts it left for approval are discarded.")) control("stop"); }}><Square size={11} />Stop</button>
            </> : <>
              <button type="button" className={cn(ghostButton, "h-7 min-h-7 rounded-full px-2.5 text-[12px]")} title={`Ask ${chief.name} to write a sequence for ${lead.name}`} onClick={onAsk}><Sparkles size={12} />Ask {chief.name}</button>
              <button type="button" className={cn(ghostButton, "h-7 min-h-7 rounded-full px-2.5 text-[12px]")} onClick={() => setEditing(true)}><Plus size={12} />New</button>
            </>}
          </div>
        )}
      </header>
      {!sequence && !editing && <p className="mt-1 text-[12.5px] text-ink-tertiary">Follow-ups on a schedule. Each one is drafted for approval on its day and the sequence stops when {lead.name} replies or the lead closes.</p>}
      {sequence && !editing && <Steps sequence={sequence} lead={lead} />}
      {action.error && <div className="mt-2"><Notice tone="danger">{action.error}</Notice></div>}
      {editing && <SequenceEditor projectId={projectId} lead={lead} onDone={() => setEditing(false)} />}
    </section>
  );
}

function Steps({ sequence, lead }: { sequence: PipelineSequence; lead: PipelineLead }) {
  const base = sequence.status === "paused" && sequence.pausedAt ? sequence.startedAt + (Date.now() - sequence.pausedAt) : sequence.startedAt;
  return (
    <ol className="mt-2 flex flex-col gap-1.5">
      {sequence.steps.map((step, index) => {
        const { icon: Icon, label } = channelOf(step.channel);
        return (
          <li key={index} className={cn("flex min-w-0 items-center gap-2 text-[12.5px]", (step.state === "skipped" || step.state === "done") && "text-ink-tertiary")}>
            <span className="w-12 shrink-0 tabular-nums text-ink-tertiary">Day {step.day}</span>
            <Icon size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />
            <span className="shrink-0 text-ink">{label}</span>
            <span className="min-w-0 flex-1 truncate text-ink-secondary">{fillLeadTemplate(step.subject ?? step.goal ?? step.body ?? "", lead)}</span>
            <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink-tertiary">
              {step.state === "waiting" ? <CircleDashed size={11} aria-hidden="true" /> : step.state === "skipped" ? <Undo2 size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}
              {step.state === "waiting" && sequence.status === "active" ? `Due ${day(base + step.day * DAY_MS)}` : STATE_LABEL[step.state]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SequenceEditor({ projectId, lead, onDone }: { projectId: string; lead: PipelineLead; onDone(): void }) {
  const [steps, setSteps] = useState<SequenceDraftStep[]>(() => defaultSequence(lead));
  const action = useAction();
  const set = (index: number, patch: Partial<SequenceDraftStep>) => setSteps((current) => current.map((step, at) => (at === index ? { ...step, ...patch } : step)));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (action.busy) return;
    const ordered = [...steps].sort((a, b) => a.day - b.day);
    const payload = ordered.map(({ day: at, channel, subject, body, goal }) => ({
      day: at, channel,
      ...(channel === "email" && subject.trim() ? { subject } : {}),
      ...(channel !== "ai_call" && body.trim() ? { body } : {}),
      ...(channel === "ai_call" && goal.trim() ? { goal } : {}),
    }));
    if (await action.run(() => cloudMutation("pipelineSequences:start", { projectId, leadId: lead._id, steps: payload }), "Could not start the sequence")) onDone();
  };
  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 motion-safe:animate-[pop-in_var(--motion-fast)_var(--ease-out)]">
      <p className="text-[12px] text-ink-tertiary">{"{first_name}"}, {"{name}"} and {"{company}"} fill in when a step is drafted.</p>
      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => (
          <li key={step.key} className="flex flex-col gap-1.5 rounded-xl border border-hairline/40 p-2.5">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary">Day
                <input type="number" min={0} max={SEQUENCE_DAYS_MAX} className={cn(inputClass, "w-16 tabular-nums")} value={step.day}
                  onChange={(event) => set(index, { day: Math.max(0, Math.min(SEQUENCE_DAYS_MAX, Math.round(Number(event.target.value) || 0))) })} />
              </label>
              <Select size="sm" aria-label={`Step ${index + 1} channel`} value={step.channel} onChange={(event) => set(index, { channel: event.target.value as PipelineSequenceChannel })}>
                {CHANNELS.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
              </Select>
              <button type="button" className={cn(iconButton, "ml-auto size-7 hover:text-danger")} aria-label={`Remove step ${index + 1}`} disabled={steps.length === 1}
                onClick={() => setSteps((current) => current.filter((_, at) => at !== index))}><Trash2 size={13} /></button>
            </div>
            {step.channel === "email" && <input className={inputClass} aria-label={`Step ${index + 1} subject`} placeholder="Subject" value={step.subject} maxLength={300} onChange={(event) => set(index, { subject: event.target.value })} />}
            {step.channel === "ai_call"
              ? <textarea className={cn(inputClass, "min-h-[64px] resize-y")} aria-label={`Step ${index + 1} call goal`} placeholder="What the AI call should achieve" value={step.goal} maxLength={8000} onChange={(event) => set(index, { goal: event.target.value })} />
              : <textarea className={cn(inputClass, "min-h-[56px] resize-y")} aria-label={`Step ${index + 1} ${step.channel === "call_task" ? "task" : "message"}`}
                placeholder={step.channel === "call_task" ? `Call ${lead.name}` : "Message"} value={step.body} maxLength={step.channel === "email" ? 20000 : 1600} onChange={(event) => set(index, { body: event.target.value })} />}
          </li>
        ))}
      </ol>
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={cn(ghostButton, "h-8 rounded-full")} disabled={steps.length >= SEQUENCE_STEPS_MAX}
          onClick={() => setSteps((current) => [...current, { key: crypto.randomUUID(), day: (current[current.length - 1]?.day ?? 0) + 3, channel: "email", subject: "", body: "", goal: "" }])}>
          <Plus size={13} />Step
        </button>
        <button type="button" className={cn(ghostButton, "ml-auto h-8 rounded-full")} onClick={onDone}>Cancel</button>
        <button className={cn(primaryButton, "h-8 rounded-full px-4")} disabled={action.busy}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />}Start</button>
      </div>
    </form>
  );
}
